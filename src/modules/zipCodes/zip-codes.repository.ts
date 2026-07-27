import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import type { CoverageEffect, GeoStatus } from "../../enums";

/**
 * The one relation this module loads eagerly. §5.2: the admin table must render
 * the market name without an N+1, so `area` is included on every serialized row.
 */
export const zipCodeWithAreaInclude = {
  area: { select: { id: true, name: true, slug: true, status: true } },
} satisfies Prisma.ZipCodeInclude;

export type ZipCodeWithArea = Prisma.ZipCodeGetPayload<{
  include: typeof zipCodeWithAreaInclude;
}>;

/** A DENY row the ZIP-create hook must write alongside a new ZIP (§4.3). */
export interface AutoExclusion {
  serviceId: string;
  effect: CoverageEffect;
}

/** One INSERT the importer will attempt. */
export interface ImportCreateRow {
  zipCode: string;
  areaId: string;
  city: string | null;
  stateCode: string | null;
  countryCode: string | null;
}

/** One row the importer will patch, keyed on the natural key. `null` = leave alone. */
export interface ImportUpdateRow {
  zipCode: string;
  city: string | null;
  stateCode: string | null;
  countryCode: string | null;
}

/** One ZIP the importer will re-home. */
export interface ImportMoveRow {
  id: string;
  areaId: string;
}

export interface ImportChunkInput {
  creates: ImportCreateRow[];
  updates: ImportUpdateRow[];
  moves: ImportMoveRow[];
  /** areaId -> the exclusions to write for every ZIP created in that area. */
  autoExclusionsByArea: Map<string, AutoExclusion[]>;
}

export interface ImportChunkOutcome {
  created: number;
  updated: number;
  moved: number;
  exclusionsCreated: number;
}

/**
 * Explicit transaction options. NO other `$transaction` call in `src` passes
 * options, so Prisma's defaults (maxWait 2s, timeout 5s) apply everywhere else —
 * far too tight for a 500-row chunk through the Supavisor pooler, which is how
 * you get P2028 (§5.6).
 */
const IMPORT_TX_OPTIONS = { timeout: 20_000, maxWait: 5_000 } as const;

export class ZipCodesRepository {
  // ── Reads ──────────────────────────────────────────────────────────────────
  findManyWithArea(args: {
    where: Prisma.ZipCodeWhereInput;
    orderBy: Prisma.ZipCodeOrderByWithRelationInput;
    skip: number;
    take: number;
  }): Promise<ZipCodeWithArea[]> {
    return prisma.zipCode.findMany({ ...args, include: zipCodeWithAreaInclude });
  }

  count(where?: Prisma.ZipCodeWhereInput): Promise<number> {
    return prisma.zipCode.count({ where });
  }

  findByIdWithArea(id: string): Promise<ZipCodeWithArea | null> {
    return prisma.zipCode.findUnique({
      where: { id },
      include: zipCodeWithAreaInclude,
    });
  }

  findByCodeWithArea(zipCode: string): Promise<ZipCodeWithArea | null> {
    return prisma.zipCode.findUnique({
      where: { zipCode },
      include: zipCodeWithAreaInclude,
    });
  }

  findManyByIdsWithArea(ids: string[]): Promise<ZipCodeWithArea[]> {
    return prisma.zipCode.findMany({
      where: { id: { in: ids } },
      include: zipCodeWithAreaInclude,
    });
  }

  /** id + status only — all `bulk/status` needs; no relation load, no N+1 bait. */
  findManyByIdsLean(ids: string[]) {
    return prisma.zipCode.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });
  }

  /** Existing rows for a set of natural keys — the importer's single lookup. */
  findManyByCodes(codes: string[]) {
    return prisma.zipCode.findMany({
      where: { zipCode: { in: codes } },
      select: {
        id: true,
        zipCode: true,
        areaId: true,
        status: true,
        city: true,
        stateCode: true,
        countryCode: true,
        area: { select: { id: true, name: true, slug: true, status: true } },
      },
    });
  }

  // ── Areas (read-only; this module never writes them) ───────────────────────
  // Queried directly rather than through the areas module so the two modules stay
  // independently deployable.
  findAreaById(id: string) {
    return prisma.area.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, status: true },
    });
  }

  findAreasByIds(ids: string[]) {
    return prisma.area.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, slug: true, status: true },
    });
  }

  // ── Coverage (read-only here; the coverage module owns writes) ─────────────
  /** Area-tier rules. The caller supplies the business filter. */
  findAreaCoverage(where: Prisma.ServiceAreaCoverageWhereInput) {
    return prisma.serviceAreaCoverage.findMany({
      where,
      select: {
        serviceId: true,
        areaId: true,
        effect: true,
        autoIncludeNewZips: true,
      },
    });
  }

  /** Zip-tier rules with their service, for ZIP_MOVE_BLOCKED_BY_COVERAGE details. */
  findZipCoverageWithService(zipCodeIds: string[]) {
    return prisma.serviceZipCoverage.findMany({
      where: { zipCodeId: { in: zipCodeIds } },
      select: {
        zipCodeId: true,
        effect: true,
        service: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Per-ZIP override COUNTS for a page of list rows, aggregated in the database.
   * Deliberately `groupBy` and not `findMany({ select: { zipCodeId } })`: at
   * MAX_LIMIT = 100 rows a service that overrides widely would ship up to
   * 100 x <service count> rows over the wire just to be tallied in JS.
   */
  countZipCoverageByZip(zipCodeIds: string[]) {
    return prisma.serviceZipCoverage.groupBy({
      by: ["zipCodeId"],
      where: { zipCodeId: { in: zipCodeIds } },
      _count: { _all: true },
    });
  }

  // ── Writes ─────────────────────────────────────────────────────────────────
  /**
   * Create a ZIP and, in the SAME transaction, write the zip-level DENY rows the
   * `autoIncludeNewZips = false` hook demands (§4.3). One transaction, because a
   * ZIP that exists without its exclusions is silently bookable.
   */
  createWithAutoExclusions(
    data: Prisma.ZipCodeUncheckedCreateInput,
    autoExclusions: AutoExclusion[],
  ): Promise<ZipCodeWithArea> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.zipCode.create({
        data,
        include: zipCodeWithAreaInclude,
      });
      if (autoExclusions.length > 0) {
        await tx.serviceZipCoverage.createMany({
          data: autoExclusions.map((exclusion) => ({
            serviceId: exclusion.serviceId,
            zipCodeId: created.id,
            areaId: created.areaId,
            effect: exclusion.effect,
          })),
          skipDuplicates: true,
        });
      }
      return created;
    });
  }

  update(
    id: string,
    data: Prisma.ZipCodeUncheckedUpdateInput,
  ): Promise<ZipCodeWithArea> {
    return prisma.zipCode.update({
      where: { id },
      data,
      include: zipCodeWithAreaInclude,
    });
  }

  updateStatusMany(ids: string[], status: GeoStatus): Promise<number> {
    return prisma.zipCode
      .updateMany({ where: { id: { in: ids } }, data: { status } })
      .then((result) => result.count);
  }

  /** Re-home many ZIPs at once. Raises a composite-FK error if any is pinned. */
  moveMany(ids: string[], areaId: string): Promise<number> {
    return prisma.zipCode
      .updateMany({ where: { id: { in: ids } }, data: { areaId } })
      .then((result) => result.count);
  }

  /** Re-home one ZIP. Used to isolate FK failures after a batch move is refused. */
  moveOne(id: string, areaId: string): Promise<{ id: string }> {
    return prisma.zipCode.update({
      where: { id },
      data: { areaId },
      select: { id: true },
    });
  }

  /**
   * One import chunk, one transaction. Creates go through a single `createMany`
   * (`ON CONFLICT DO NOTHING`), updates through ONE `UPDATE … FROM (VALUES …)`
   * statement, moves through one `updateMany` per target area. Never per row:
   * thousands of individual statements through the pooler is a guaranteed P2028.
   */
  runImportChunk(input: ImportChunkInput): Promise<ImportChunkOutcome> {
    const { creates, updates, moves, autoExclusionsByArea } = input;
    return prisma.$transaction(async (tx) => {
      let created = 0;
      let exclusionsCreated = 0;

      if (creates.length > 0) {
        const result = await tx.zipCode.createMany({
          data: creates.map((row) => ({
            zipCode: row.zipCode,
            areaId: row.areaId,
            ...(row.city !== null ? { city: row.city } : {}),
            ...(row.stateCode !== null ? { stateCode: row.stateCode } : {}),
            ...(row.countryCode !== null ? { countryCode: row.countryCode } : {}),
          })),
          skipDuplicates: true,
        });
        created = result.count;

        // createMany returns no ids, and the hook needs them. Re-read by natural
        // key inside the transaction. Re-writing an exclusion that a concurrent
        // import already wrote is harmless: skipDuplicates + the
        // (serviceId, zipCodeId) unique key make the hook idempotent.
        const hookAreas = [...autoExclusionsByArea.keys()];
        if (hookAreas.length > 0) {
          const inserted = await tx.zipCode.findMany({
            where: {
              zipCode: { in: creates.map((row) => row.zipCode) },
              areaId: { in: hookAreas },
            },
            select: { id: true, areaId: true },
          });
          const exclusionRows: Prisma.ServiceZipCoverageCreateManyInput[] = [];
          for (const row of inserted) {
            for (const exclusion of autoExclusionsByArea.get(row.areaId) ?? []) {
              exclusionRows.push({
                serviceId: exclusion.serviceId,
                zipCodeId: row.id,
                areaId: row.areaId,
                effect: exclusion.effect,
              });
            }
          }
          if (exclusionRows.length > 0) {
            const hookResult = await tx.serviceZipCoverage.createMany({
              data: exclusionRows,
              skipDuplicates: true,
            });
            exclusionsCreated = hookResult.count;
          }
        }
      }

      let updated = 0;
      if (updates.length > 0) {
        updated = await tx.$executeRaw(buildBatchUpdate(updates));
      }

      let moved = 0;
      const movesByArea = new Map<string, string[]>();
      for (const move of moves) {
        const bucket = movesByArea.get(move.areaId);
        if (bucket) bucket.push(move.id);
        else movesByArea.set(move.areaId, [move.id]);
      }
      for (const [areaId, ids] of movesByArea) {
        const result = await tx.zipCode.updateMany({
          where: { id: { in: ids } },
          data: { areaId },
        });
        moved += result.count;
      }

      return { created, updated, moved, exclusionsCreated };
    }, IMPORT_TX_OPTIONS);
  }
}

/**
 * ONE statement for N updates, keyed on the natural key. Every parameter carries
 * an explicit `::text` cast so Postgres can type the VALUES list even when a
 * whole column is NULL, and each column COALESCEs against its current value so
 * "not supplied in the CSV" means "leave it alone" rather than "erase it".
 * `updatedAt` is set explicitly because raw SQL bypasses Prisma's `@updatedAt`.
 */
function buildBatchUpdate(rows: ImportUpdateRow[]): Prisma.Sql {
  const tuples = rows.map(
    (row) =>
      Prisma.sql`(${row.zipCode}::text, ${row.city}::text, ${row.stateCode}::text, ${row.countryCode}::text)`,
  );
  return Prisma.sql`
    UPDATE "ZipCode" AS z
       SET "city"        = COALESCE(v."city", z."city"),
           "stateCode"   = COALESCE(v."stateCode", z."stateCode"),
           "countryCode" = COALESCE(v."countryCode", z."countryCode"),
           "updatedAt"   = now()
      FROM (VALUES ${Prisma.join(tuples)})
        AS v("zipCode", "city", "stateCode", "countryCode")
     WHERE z."zipCode" = v."zipCode"`;
}

export const zipCodesRepository = new ZipCodesRepository();
