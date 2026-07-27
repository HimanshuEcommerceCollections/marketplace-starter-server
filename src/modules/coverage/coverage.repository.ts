import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import { GeoStatus } from "../../enums";
import type { CoverageEffect } from "../../enums";
import type {
  AreaRuleRow,
  AreaZipCountRow,
  AvailableServiceRow,
  CoverageResolutionRow,
  CoverageServiceIdentity,
  ZipRuleRow,
} from "./coverage.types";

/** Either the shared client or an interactive-transaction client. */
type DbClient = Prisma.TransactionClient | typeof prisma;

/** The columns the resolver reads off `Service`. */
const SERVICE_IDENTITY_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  locationMode: true,
  locationModes: true,
  coverageVersion: true,
} as const;

const AREA_REF_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
} as const;

const LISTED_ZIP_SELECT = {
  id: true,
  zipCode: true,
  city: true,
  status: true,
} as const;

/**
 * Thin Prisma passthroughs. Every business rule — precedence, gates, canonical
 * form, version conflict — lives in coverage.service.ts.
 */
export class CoverageRepository {
  // ── Resolution (the hot path) ──────────────────────────────────────────────

  /**
   * THE resolution query. ONE statement, four index probes, zero Seq Scans:
   *
   *   WHERE z."zipCode" = $2          -> ZipCode_zipCode_key                (1 row)
   *   JOIN "Area"                     -> Area_pkey                          (1 row)
   *   LEFT JOIN ServiceZipCoverage    -> ServiceZipCoverage_serviceId_zipCodeId_key (0-1)
   *   LEFT JOIN ServiceAreaCoverage   -> ServiceAreaCoverage_serviceId_areaId_key   (0-1)
   *
   * All four indexes are created by `@unique`/`@@unique`/`@id` attributes — no
   * hand-written `@@index` on the hot path. Verify with
   * `EXPLAIN (ANALYZE, BUFFERS)`: four `Index Scan using …_key` nodes.
   *
   * Written as literal `$queryRaw` rather than a nested Prisma `select` on
   * purpose. `relationJoins` is a preview feature and the generator block
   * declares no `previewFeatures`, so a nested select decomposes into 2-3
   * SEQUENTIAL statements. That costs extra round trips AND opens a timing side
   * channel: an unknown ZIP would return measurably faster than a
   * known-but-excluded one, which is exactly the distinction the deny response
   * is engineered not to leak.
   *
   * `$queryRaw` (tagged template, values parameterised) — never
   * `$queryRawUnsafe`. When provider-coverage-by-ZIP lands, write a SECOND
   * literal query in its own repository and share only the pure
   * `decideCoverage()`; do not parameterise the owner column here.
   */
  async resolveZip(
    serviceId: string,
    zip5: string,
  ): Promise<CoverageResolutionRow | null> {
    const rows = await prisma.$queryRaw<CoverageResolutionRow[]>`
      SELECT z.id                                                            AS "zipCodeId",
             z."zipCode"                                                     AS "zip",
             z.status::text                                                  AS "zipStatus",
             z."areaId"                                                      AS "areaId",
             a.name                                                          AS "areaName",
             a.slug                                                          AS "areaSlug",
             a.status::text                                                  AS "areaStatus",
             sac.effect::text                                                AS "areaEffect",
             sac.id                                                          AS "areaRuleId",
             szc.effect::text                                                AS "zipEffect",
             szc.id                                                          AS "zipRuleId",
             COALESCE(szc.effect, sac.effect, 'DENY'::"CoverageEffect")::text AS "effect"
      FROM "ZipCode" z
      JOIN "Area" a
        ON a.id = z."areaId"
      LEFT JOIN "ServiceZipCoverage" szc
        ON szc."zipCodeId" = z.id       AND szc."serviceId" = ${serviceId}
      LEFT JOIN "ServiceAreaCoverage" sac
        ON sac."areaId"    = z."areaId" AND sac."serviceId" = ${serviceId}
      WHERE z."zipCode" = ${zip5}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * "Every ACTIVE service bookable at this ZIP" — the set-returning sibling of
   * `resolveZip`, used when the public check names no service. A SECOND literal
   * statement rather than a parameterised-identifier rewrite of the first; the
   * shared precedence expression is the same `COALESCE`.
   *
   * Bounded by the service count (8 seeded, ~500 ceiling) and only ever called
   * after the ZIP and area gates have already passed.
   */
  availableServicesAtZip(
    zipCodeId: string,
    areaId: string,
  ): Promise<AvailableServiceRow[]> {
    return prisma.$queryRaw<AvailableServiceRow[]>`
      SELECT s.id                     AS "id",
             s.slug                   AS "slug",
             s.name                   AS "name",
             (szc.effect IS NOT NULL) AS "byZip"
      FROM "Service" s
      LEFT JOIN "ServiceZipCoverage" szc
        ON szc."serviceId" = s.id AND szc."zipCodeId" = ${zipCodeId}
      LEFT JOIN "ServiceAreaCoverage" sac
        ON sac."serviceId" = s.id AND sac."areaId"    = ${areaId}
      WHERE s.status = 'ACTIVE'
        AND COALESCE(szc.effect, sac.effect, 'DENY'::"CoverageEffect") = 'ALLOW'
      ORDER BY s.name ASC
    `;
  }

  findServiceById(id: string): Promise<CoverageServiceIdentity | null> {
    return prisma.service.findUnique({
      where: { id },
      select: SERVICE_IDENTITY_SELECT,
    });
  }

  findServiceBySlug(slug: string): Promise<CoverageServiceIdentity | null> {
    return prisma.service.findUnique({
      where: { slug },
      select: SERVICE_IDENTITY_SELECT,
    });
  }

  /** ZIP + its market, with no service in the picture. Powers the no-service check. */
  findZipWithArea(zip5: string) {
    return prisma.zipCode.findUnique({
      where: { zipCode: zip5 },
      select: { ...LISTED_ZIP_SELECT, area: { select: AREA_REF_SELECT } },
    });
  }

  /**
   * Phase F support: an area plus this service's rule for it, for the
   * unknown-ZIP fallback. The relation filter is bounded to at most one row by
   * `@@unique([serviceId, areaId])`.
   */
  findAreaWithRule(areaId: string, serviceId: string) {
    return prisma.area.findUnique({
      where: { id: areaId },
      select: {
        ...AREA_REF_SELECT,
        serviceCoverage: {
          where: { serviceId },
          select: { id: true, effect: true, autoIncludeNewZips: true },
        },
      },
    });
  }

  // ── Admin document reads ───────────────────────────────────────────────────

  /**
   * Service-INDEPENDENT ACTIVE-ZIP census. Index-only scan over
   * `ZipCode_areaId_status_idx`; ~one row per area even at 10k ZIPs.
   * `count(*)::int` because an uncast `count(*)` comes back as a JS BigInt.
   */
  activeZipCountsByArea(client: DbClient = prisma): Promise<AreaZipCountRow[]> {
    return client.$queryRaw<AreaZipCountRow[]>`
      SELECT "areaId"      AS "areaId",
             count(*)::int AS "zipCount"
      FROM "ZipCode"
      WHERE status = 'ACTIVE'
      GROUP BY "areaId"
    `;
  }

  countActiveZipsInArea(areaId: string, client: DbClient = prisma) {
    return client.zipCode.count({
      where: { areaId, status: GeoStatus.ACTIVE },
    });
  }

  findAreaRules(
    serviceId: string,
    client: DbClient = prisma,
  ): Promise<AreaRuleRow[]> {
    return client.serviceAreaCoverage.findMany({
      where: { serviceId },
      select: {
        id: true,
        areaId: true,
        effect: true,
        autoIncludeNewZips: true,
        area: { select: AREA_REF_SELECT },
      },
    });
  }

  findAreaRule(serviceId: string, areaId: string, client: DbClient = prisma) {
    return client.serviceAreaCoverage.findUnique({
      where: { serviceId_areaId: { serviceId, areaId } },
      select: { id: true, effect: true, autoIncludeNewZips: true },
    });
  }

  /**
   * Every ZIP-level exception for one service — SPARSE by design (exceptions
   * only, tens of rows). Never joined against the full ZipCode table.
   */
  findZipRules(
    serviceId: string,
    client: DbClient = prisma,
  ): Promise<ZipRuleRow[]> {
    return client.serviceZipCoverage.findMany({
      where: { serviceId },
      select: {
        id: true,
        areaId: true,
        effect: true,
        zipCode: { select: LISTED_ZIP_SELECT },
      },
      orderBy: { zipCode: { zipCode: "asc" } },
    });
  }

  findZipRulesForArea(
    serviceId: string,
    areaId: string,
    client: DbClient = prisma,
  ): Promise<ZipRuleRow[]> {
    return client.serviceZipCoverage.findMany({
      where: { serviceId, areaId },
      select: {
        id: true,
        areaId: true,
        effect: true,
        zipCode: { select: LISTED_ZIP_SELECT },
      },
      orderBy: { zipCode: { zipCode: "asc" } },
    });
  }

  /**
   * EVERY market in display order, ARCHIVED included. The coverage document
   * filters archived markets out of `uncoveredAreas` but still has to be able
   * to name one that carries stale rules — dropping them from this read is how
   * an archived area's rules become invisible and unfixable.
   */
  findAreas(client: DbClient = prisma) {
    return client.area.findMany({
      select: AREA_REF_SELECT,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  findAreaById(areaId: string, client: DbClient = prisma) {
    return client.area.findUnique({
      where: { id: areaId },
      select: AREA_REF_SELECT,
    });
  }

  /** ZIPs by id, with their REAL market, for the area-mismatch error message. */
  findZipCodesByIds(zipCodeIds: string[], client: DbClient = prisma) {
    return client.zipCode.findMany({
      where: { id: { in: zipCodeIds } },
      select: {
        ...LISTED_ZIP_SELECT,
        areaId: true,
        area: { select: { id: true, name: true } },
      },
    });
  }

  // ── Coverage write (all callers pass a transaction client) ─────────────────

  /**
   * `SELECT … FOR UPDATE` on the Service row. This is the concurrency anchor:
   * it serialises two coordinators editing different areas of the same service,
   * so the version check below cannot be won by both of them.
   */
  async lockServiceCoverageVersion(
    serviceId: string,
    client: DbClient,
  ): Promise<{ coverageVersion: number } | null> {
    const rows = await client.$queryRaw<{ coverageVersion: number }[]>`
      SELECT "coverageVersion" AS "coverageVersion"
      FROM "Service"
      WHERE id = ${serviceId}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  deleteZipRules(serviceId: string, areaId: string, client: DbClient) {
    return client.serviceZipCoverage.deleteMany({ where: { serviceId, areaId } });
  }

  /** deleteMany, not delete: idempotent when the area row is already absent. */
  deleteAreaRule(serviceId: string, areaId: string, client: DbClient) {
    return client.serviceAreaCoverage.deleteMany({ where: { serviceId, areaId } });
  }

  /**
   * `effect` is deliberately typed NON-nullable even though the column is
   * nullable. `update: { effect: undefined }` is a Prisma no-op, so accepting
   * `undefined` here would let a caller silently keep the previous effect while
   * believing it had written a new one. Removing an area's coverage goes through
   * `deleteAreaRule`, never through a null effect.
   */
  upsertAreaRule(
    data: {
      serviceId: string;
      areaId: string;
      effect: CoverageEffect;
      autoIncludeNewZips: boolean;
    },
    client: DbClient,
  ) {
    const { serviceId, areaId, effect, autoIncludeNewZips } = data;
    return client.serviceAreaCoverage.upsert({
      where: { serviceId_areaId: { serviceId, areaId } },
      update: { effect, autoIncludeNewZips },
      create: { serviceId, areaId, effect, autoIncludeNewZips },
    });
  }

  createZipRules(
    rows: Prisma.ServiceZipCoverageCreateManyInput[],
    client: DbClient,
  ) {
    return client.serviceZipCoverage.createMany({ data: rows });
  }

  bumpCoverageVersion(serviceId: string, client: DbClient) {
    return client.service.update({
      where: { id: serviceId },
      data: { coverageVersion: { increment: 1 } },
      select: { coverageVersion: true },
    });
  }
}

export const coverageRepository = new CoverageRepository();
