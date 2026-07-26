import { Prisma } from "@prisma/client";
import { ApiError } from "../../utils/api-error";
import { buildMeta, buildPagination } from "../../utils/pagination";
import { logger } from "../../utils/logger";
import { isStaffRole } from "../../constants/roles";
import { HttpStatus } from "../../constants/http-status";
import { CoverageEffect, GeoStatus } from "../../enums";
import type { UserRole } from "../../enums";
import type { PaginationMeta } from "../../types/common.types";
import {
  zipCodesRepository,
  type AutoExclusion,
  type ImportCreateRow,
  type ImportMoveRow,
  type ImportUpdateRow,
  type ZipCodeWithArea,
} from "./zip-codes.repository";
import {
  BULK_IMPORT_CHUNK_SIZE,
  MAX_BULK_IMPORT_ERRORS,
  MAX_BULK_IMPORT_ROWS,
  normalizeZip,
} from "./zip-codes.validation";
import {
  ZipCodeErrorCode,
  ZipImportRowErrorCode,
  type BlockedZipCodeMove,
  type BlockingCoverageService,
  type BulkImportChunkResult,
  type BulkImportRowError,
  type BulkImportZipCodesDto,
  type BulkImportZipCodesResult,
  type BulkMoveZipCodesDto,
  type BulkMoveZipCodesResult,
  type BulkZipCodeStatusDto,
  type BulkZipCodeStatusResult,
  type CreateZipCodeDto,
  type ListZipCodesQuery,
  type LiveGeoStatus,
  type UpdateZipCodeDto,
  type ZipCodeResponse,
} from "./zip-codes.types";

/**
 * Allowed lifecycle transitions. ARCHIVED has exactly one way out (restore to
 * ACTIVE) — that is what keeps the state space at three instead of six.
 */
const ALLOWED_TRANSITIONS: Record<GeoStatus, GeoStatus[]> = {
  [GeoStatus.ACTIVE]: [GeoStatus.INACTIVE, GeoStatus.ARCHIVED],
  [GeoStatus.INACTIVE]: [GeoStatus.ACTIVE, GeoStatus.ARCHIVED],
  [GeoStatus.ARCHIVED]: [GeoStatus.ACTIVE],
};

/** Statuses a non-staff caller may ever see on the public list. */
const PUBLIC_STATUS = GeoStatus.ACTIVE;

/**
 * ApiError carrying a machine-readable code.
 *
 * `ApiError` has no `code` field yet (§5.5 assigns that edit, plus
 * `src/constants/error-codes.ts`, to the shared wiring outside this module), so
 * the code rides inside `details` — which the global error handler emits as
 * `errors`. When `ApiError.coded()` lands, this function body is the only thing
 * that changes.
 */
function codedError(
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(statusCode, message, { code, ...(details ?? {}) });
}

function isKnownPrismaError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError;
}

/**
 * Composite-FK refusal. `ServiceZipCoverage (zipCodeId, areaId) -> ZipCode
 * (id, areaId) ON UPDATE RESTRICT` makes Postgres reject `UPDATE "ZipCode" SET
 * "areaId" = …` while any service rule references the ZIP under its old area.
 * Prisma surfaces that as P2003; a raw statement surfaces the SQLSTATE (23503)
 * wrapped in P2010. Both are the same fact and neither may reach the client as a
 * 500 or as the error handler's generic 400 "Database request error".
 */
function isForeignKeyViolation(err: unknown): boolean {
  if (!isKnownPrismaError(err)) return false;
  if (err.code === "P2003") return true;
  const meta = err.meta as { code?: string } | undefined;
  return err.code === "P2010" && meta?.code === "23503";
}

function isUniqueViolation(err: unknown): boolean {
  return isKnownPrismaError(err) && err.code === "P2002";
}

function isRecordNotFound(err: unknown): boolean {
  return isKnownPrismaError(err) && err.code === "P2025";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown database error";
}

/** Bounded work unit for the importer, tagged so chunks stay in submitted order. */
type ImportWorkItem =
  | { kind: "create"; row: number; zipCode: string; create: ImportCreateRow }
  | { kind: "update"; row: number; zipCode: string; update: ImportUpdateRow }
  | {
      kind: "move";
      row: number;
      zipCode: string;
      move: ImportMoveRow;
      patch: ImportUpdateRow | null;
    };

/** A row that survived in-memory normalisation and area resolution. */
interface PlannedImportRow {
  row: number;
  zipCode: string;
  areaId: string;
  city: string | null;
  stateCode: string | null;
  countryCode: string | null;
}

export class ZipCodesService {
  // ── Serialization ──────────────────────────────────────────────────────────
  private serialize(
    row: ZipCodeWithArea,
    serviceOverrideCount: number,
  ): ZipCodeResponse {
    return {
      id: row.id,
      zipCode: row.zipCode,
      city: row.city,
      stateCode: row.stateCode,
      countryCode: row.countryCode,
      status: row.status,
      area: {
        id: row.area.id,
        name: row.area.name,
        slug: row.area.slug,
        status: row.area.status,
      },
      serviceOverrideCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Zip-level override counts for a whole page in ONE query. Never per row: the
   * repo's per-row `serialize()` idiom makes an N+1 at MAX_LIMIT=100 the path of
   * least resistance (§4.8).
   */
  private async countOverrides(zipCodeIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (zipCodeIds.length === 0) return counts;
    const rows = await zipCodesRepository.countZipCoverageByZip(zipCodeIds);
    for (const row of rows) {
      counts.set(row.zipCodeId, row._count._all);
    }
    return counts;
  }

  private async countOverridesFor(zipCodeId: string): Promise<number> {
    const counts = await this.countOverrides([zipCodeId]);
    return counts.get(zipCodeId) ?? 0;
  }

  // ── Reads ──────────────────────────────────────────────────────────────────
  /**
   * List ZIPs. Role-aware exactly like `GET /services`: staff may filter by any
   * status and opt ARCHIVED rows in; everyone else sees ACTIVE ZIPs in ACTIVE
   * markets only, because gate I4 makes anything else unbookable anyway.
   * ARCHIVED is excluded by default even for staff.
   */
  async list(
    query: ListZipCodesQuery,
    viewerRole?: UserRole,
  ): Promise<{ items: ZipCodeResponse[]; meta: PaginationMeta }> {
    const { skip, take, page, limit } = buildPagination(query);
    const staff = viewerRole !== undefined && isStaffRole(viewerRole);
    const where = this.buildListWhere(query, staff);

    const [rows, total] = await Promise.all([
      zipCodesRepository.findManyWithArea({
        where,
        orderBy: this.buildOrderBy(query),
        skip,
        take,
      }),
      zipCodesRepository.count(where),
    ]);

    // `serviceOverrideCount` is admin-table furniture: it says how many services
    // carry a per-ZIP exception here, i.e. how much of the coverage matrix is
    // hand-edited. Anonymous callers have no use for it and should not be told,
    // so non-staff get 0 and are spared the extra aggregate entirely.
    const counts = staff
      ? await this.countOverrides(rows.map((row) => row.id))
      : new Map<string, number>();
    return {
      items: rows.map((row) => this.serialize(row, counts.get(row.id) ?? 0)),
      meta: buildMeta(page, limit, total),
    };
  }

  /**
   * Search is split on the input's SHAPE, never an OR: an `OR` of `LIKE 'x%'`
   * and `ILIKE '%x%'` can never use a btree, so both branches would seq-scan the
   * `text_pattern_ops` indexes into uselessness (§5.2). Digits -> zipCode prefix,
   * anything else -> city prefix. `startsWith`, never `contains`.
   */
  private buildListWhere(
    query: ListZipCodesQuery,
    staff: boolean,
  ): Prisma.ZipCodeWhereInput {
    const search = query.search;
    return {
      ...(query.areaId ? { areaId: query.areaId } : {}),
      ...(staff
        ? query.status
          ? { status: query.status }
          : query.includeArchived
            ? {}
            : { status: { in: [GeoStatus.ACTIVE, GeoStatus.INACTIVE] } }
        : { status: PUBLIC_STATUS, area: { status: PUBLIC_STATUS } }),
      ...(search
        ? /^\d+$/.test(search)
          ? { zipCode: { startsWith: search } }
          : { city: { startsWith: search, mode: "insensitive" } }
        : {}),
    };
  }

  private buildOrderBy(
    query: ListZipCodesQuery,
  ): Prisma.ZipCodeOrderByWithRelationInput {
    switch (query.sortBy) {
      case "city":
        return { city: query.sort };
      case "createdAt":
        return { createdAt: query.sort };
      case "updatedAt":
        return { updatedAt: query.sort };
      default:
        return { zipCode: query.sort };
    }
  }

  async getById(id: string): Promise<ZipCodeResponse> {
    const row = await this.requireZipCode(id);
    return this.serialize(row, await this.countOverridesFor(row.id));
  }

  /** `zipCode` is already normalised to 5 digits by the param schema. */
  async getByCode(zipCode: string): Promise<ZipCodeResponse> {
    const row = await zipCodesRepository.findByCodeWithArea(zipCode);
    if (!row) {
      throw codedError(
        HttpStatus.NOT_FOUND,
        ZipCodeErrorCode.ZIP_CODE_NOT_FOUND,
        `ZIP code ${zipCode} not found`,
      );
    }
    return this.serialize(row, await this.countOverridesFor(row.id));
  }

  // ── Create / update ────────────────────────────────────────────────────────
  async create(dto: CreateZipCodeDto): Promise<ZipCodeResponse> {
    const area = await this.requireAssignableArea(dto.areaId);
    await this.assertZipCodeAvailable(dto.zipCode);
    const autoExclusions = await this.loadAutoExclusions(area.id);

    try {
      const created = await zipCodesRepository.createWithAutoExclusions(
        {
          areaId: area.id,
          zipCode: dto.zipCode,
          ...(dto.city !== undefined ? { city: dto.city } : {}),
          ...(dto.stateCode !== undefined ? { stateCode: dto.stateCode } : {}),
          ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
        autoExclusions,
      );
      if (autoExclusions.length > 0) {
        logger.info("zipCode.autoExcluded", {
          zipCode: created.zipCode,
          areaId: area.id,
          services: autoExclusions.length,
        });
      }
      return this.serialize(created, autoExclusions.length);
    } catch (err) {
      // A brand-new ZIP has no coverage rules, so the only FK that can fire here
      // is areaId -> Area.id: the market was deleted under us.
      throw this.toApiError(err, { zipCode: dto.zipCode, fkAs: "area" });
    }
  }

  /**
   * Patch editable fields. `areaId` is a MOVE and is pre-checked against the
   * zip-tier rules, because the alternative is a Postgres FK error the admin
   * cannot act on.
   */
  async update(id: string, dto: UpdateZipCodeDto): Promise<ZipCodeResponse> {
    const existing = await this.requireZipCode(id);
    this.assertNotArchived(existing);

    if (dto.zipCode !== undefined && dto.zipCode !== existing.zipCode) {
      await this.assertZipCodeAvailable(dto.zipCode, id);
    }

    const data: Prisma.ZipCodeUncheckedUpdateInput = {};
    if (dto.zipCode !== undefined) data.zipCode = dto.zipCode;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.stateCode !== undefined) data.stateCode = dto.stateCode;
    if (dto.countryCode !== undefined) data.countryCode = dto.countryCode;

    let targetAreaName: string | undefined;
    if (dto.areaId !== undefined && dto.areaId !== existing.areaId) {
      const target = await this.requireAssignableArea(dto.areaId);
      await this.assertMovable(existing, target.name);
      data.areaId = target.id;
      targetAreaName = target.name;
    }

    try {
      const updated = await zipCodesRepository.update(id, data);
      return this.serialize(updated, await this.countOverridesFor(id));
    } catch (err) {
      throw this.toApiError(err, {
        zipCode: dto.zipCode ?? existing.zipCode,
        areaName: existing.area.name,
        targetAreaName,
        // Only an areaId change can trip either FK; a city/state/zipCode edit
        // cannot, so it must not be reported as a blocked move.
        ...(data.areaId !== undefined ? { fkAs: "move" as const } : {}),
      });
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  /**
   * The ACTIVE <-> INACTIVE toggle, subject to the transition map.
   *
   * `to` cannot be ARCHIVED (see `liveStatusSchema`) and an ARCHIVED row is
   * refused outright. Without both halves this staff route was a complete bypass
   * of the admin-only `/archive` and `/restore`: ARCHIVED is a legal target from
   * ACTIVE/INACTIVE, and ARCHIVED -> ACTIVE is a legal transition, so a
   * coordinator could archive and un-archive at will through here.
   */
  async setStatus(id: string, to: LiveGeoStatus): Promise<ZipCodeResponse> {
    const existing = await this.requireZipCode(id);
    this.assertNotArchived(existing);
    return this.applyStatus(existing, to);
  }

  async activate(id: string): Promise<ZipCodeResponse> {
    const existing = await this.requireZipCode(id);
    this.assertNotArchived(existing);
    return this.applyStatus(existing, GeoStatus.ACTIVE);
  }

  async deactivate(id: string): Promise<ZipCodeResponse> {
    const existing = await this.requireZipCode(id);
    this.assertNotArchived(existing);
    return this.applyStatus(existing, GeoStatus.INACTIVE);
  }

  /**
   * Archive. NOT blocked by bookings or by coverage rules: `Booking`'s Restrict
   * FKs make deletion impossible, so retirement must always be available, and
   * coverage rows are preserved so restore is lossless.
   */
  async archive(id: string): Promise<ZipCodeResponse> {
    const existing = await this.requireZipCode(id);
    // Named explicitly rather than falling through to the transition map, whose
    // message for this case would be the unhelpful "ARCHIVED -> ARCHIVED".
    if (existing.status === GeoStatus.ARCHIVED) {
      throw codedError(
        HttpStatus.CONFLICT,
        ZipCodeErrorCode.ZIP_CODE_ARCHIVED,
        `${existing.zipCode} is already archived.`,
        { archivedId: existing.id },
      );
    }
    return this.applyStatus(existing, GeoStatus.ARCHIVED);
  }

  async restore(id: string): Promise<ZipCodeResponse> {
    const existing = await this.requireZipCode(id);
    if (existing.status !== GeoStatus.ARCHIVED) {
      throw codedError(
        HttpStatus.CONFLICT,
        ZipCodeErrorCode.ZIP_CODE_NOT_ARCHIVED,
        `${existing.zipCode} is not archived, so it cannot be restored.`,
      );
    }
    return this.applyStatus(existing, GeoStatus.ACTIVE);
  }

  private async applyStatus(
    existing: ZipCodeWithArea,
    to: GeoStatus,
  ): Promise<ZipCodeResponse> {
    if (!ALLOWED_TRANSITIONS[existing.status].includes(to)) {
      throw codedError(
        HttpStatus.CONFLICT,
        ZipCodeErrorCode.ZIP_CODE_STATUS_TRANSITION_INVALID,
        `Invalid status transition: ${existing.status} -> ${to}`,
      );
    }
    try {
      const updated = await zipCodesRepository.update(existing.id, { status: to });
      return this.serialize(updated, await this.countOverridesFor(existing.id));
    } catch (err) {
      throw this.toApiError(err, { zipCode: existing.zipCode });
    }
  }

  // ── Bulk status ────────────────────────────────────────────────────────────
  /**
   * Permissive by design (§5.2 gives this endpoint 200/422 only): nothing here
   * fails a batch the admin cannot easily repair. But every requested id is
   * ACCOUNTED FOR rather than swept into `unchanged` — a missing id and an
   * ARCHIVED row were both refused, and calling that "unchanged" tells the admin
   * there was nothing to do.
   *
   * The mutation freeze applies: ARCHIVED rows are reported, never toggled. `to`
   * cannot be ARCHIVED, so this route can no longer archive in bulk behind the
   * admin-only `/:id/archive`.
   */
  async bulkSetStatus(dto: BulkZipCodeStatusDto): Promise<BulkZipCodeStatusResult> {
    const ids = [...new Set(dto.zipCodeIds)];
    const rows = await zipCodesRepository.findManyByIdsLean(ids);
    const found = new Set(rows.map((row) => row.id));

    const notFound = ids.filter((id) => !found.has(id));
    const archived: string[] = [];
    const pending: string[] = [];
    let unchanged = 0;

    for (const row of rows) {
      if (row.status === GeoStatus.ARCHIVED) archived.push(row.id);
      else if (row.status === dto.status) unchanged += 1;
      else pending.push(row.id);
    }

    const updated =
      pending.length > 0
        ? await zipCodesRepository.updateStatusMany(pending, dto.status)
        : 0;
    return { updated, unchanged, notFound, archived };
  }

  // ── Bulk move ──────────────────────────────────────────────────────────────
  /**
   * Re-home many ZIPs. PARTIAL SUCCESS IS THE DESIGN: the composite FK refuses
   * any ZIP whose service rules were authored under its current market, those
   * come back in `blocked`, and the rest still commit (§5.2).
   */
  async bulkMove(dto: BulkMoveZipCodesDto): Promise<BulkMoveZipCodesResult> {
    const target = await this.requireAssignableArea(dto.targetAreaId);
    // Deduped so a payload that repeats an id cannot inflate `notFound` or make
    // the reported buckets stop summing to the number of distinct ZIPs asked for.
    const ids = [...new Set(dto.zipCodeIds)];
    const rows = await zipCodesRepository.findManyByIdsWithArea(ids);
    const found = new Set(rows.map((row) => row.id));
    const notFound = ids.filter((id) => !found.has(id));

    const candidates = rows.filter((row) => row.areaId !== target.id);
    const unchanged = rows.length - candidates.length;

    const overridesByZip = await this.loadOverridesByZip(
      candidates.map((row) => row.id),
    );

    const blocked: BlockedZipCodeMove[] = [];
    const movable: ZipCodeWithArea[] = [];
    for (const row of candidates) {
      const services = overridesByZip.get(row.id);
      if (services && services.length > 0) blocked.push(this.toBlockedMove(row, services));
      else movable.push(row);
    }

    let moved = 0;
    if (movable.length > 0) {
      try {
        moved = await zipCodesRepository.moveMany(
          movable.map((row) => row.id),
          target.id,
        );
      } catch (err) {
        if (!isForeignKeyViolation(err)) throw err;
        // A rule was written between the pre-check and the UPDATE, so the whole
        // updateMany rolled back. Retry one at a time so the admin still gets the
        // ZIPs that can move, plus an exact list of the ones that cannot.
        logger.warn("zipCode.bulkMoveFellBackToPerRow", {
          targetAreaId: target.id,
          candidates: movable.length,
        });
        for (const row of movable) {
          try {
            await zipCodesRepository.moveOne(row.id, target.id);
            moved += 1;
          } catch (rowErr) {
            if (!isForeignKeyViolation(rowErr)) throw rowErr;
            blocked.push(this.toBlockedMove(row, overridesByZip.get(row.id) ?? []));
          }
        }
      }
    }

    return { moved, unchanged, notFound, blocked };
  }

  private toBlockedMove(
    row: ZipCodeWithArea,
    services: BlockingCoverageService[],
  ): BlockedZipCodeMove {
    return {
      zipCodeId: row.id,
      zipCode: row.zipCode,
      areaId: row.areaId,
      areaName: row.area.name,
      services,
    };
  }

  private async loadOverridesByZip(
    zipCodeIds: string[],
  ): Promise<Map<string, BlockingCoverageService[]>> {
    const byZip = new Map<string, BlockingCoverageService[]>();
    if (zipCodeIds.length === 0) return byZip;
    const rows = await zipCodesRepository.findZipCoverageWithService(zipCodeIds);
    for (const row of rows) {
      const list = byZip.get(row.zipCodeId) ?? [];
      list.push({ id: row.service.id, name: row.service.name, effect: row.effect });
      byZip.set(row.zipCodeId, list);
    }
    return byZip;
  }

  // ── Bulk import ────────────────────────────────────────────────────────────
  /**
   * JSON rows only — the browser parses the CSV (§5.6). Chunked and deliberately
   * NOT all-or-nothing: idempotency on the natural key (`zipCode`) is what makes
   * a partial commit safe and a retry a no-op, and `chunks[]` tells the client
   * exactly which batches landed.
   *
   * Always answers 200. Per-row problems are DATA, not transport failures.
   */
  async bulkImport(dto: BulkImportZipCodesDto): Promise<BulkImportZipCodesResult> {
    // The zod schema already caps this at 422; this is the belt-and-braces guard
    // for internal callers that skip validation.
    if (dto.rows.length > MAX_BULK_IMPORT_ROWS) {
      throw codedError(
        HttpStatus.BAD_REQUEST,
        ZipCodeErrorCode.ZIP_IMPORT_TOO_MANY_ROWS,
        `Import at most ${MAX_BULK_IMPORT_ROWS} ZIP codes per request.`,
        { received: dto.rows.length, max: MAX_BULK_IMPORT_ROWS },
      );
    }

    const received = dto.rows.length;
    const failures: BulkImportRowError[] = [];
    let failedCount = 0;
    const fail = (
      row: number,
      zipCode: string,
      code: (typeof ZipImportRowErrorCode)[keyof typeof ZipImportRowErrorCode],
      message: string,
    ): void => {
      failedCount += 1;
      if (failures.length < MAX_BULK_IMPORT_ERRORS) {
        failures.push({ row, zipCode, code, message });
      }
    };

    // ── Step 1: normalise every row in memory. No DB, no throwing. ──
    const planned: PlannedImportRow[] = [];
    const firstSeenAt = new Map<string, number>();
    const referencedAreaIds = new Set<string>();

    dto.rows.forEach((raw, index) => {
      const rowNumber = index + 1;
      const zip = normalizeZip(raw.zipCode);
      if (zip === null) {
        fail(
          rowNumber,
          raw.zipCode,
          ZipImportRowErrorCode.ZIP_CODE_INVALID,
          "ZIP code must be exactly 5 digits",
        );
        return;
      }

      const firstRow = firstSeenAt.get(zip);
      if (firstRow !== undefined) {
        fail(
          rowNumber,
          zip,
          ZipImportRowErrorCode.ZIP_CODE_DUPLICATE_IN_PAYLOAD,
          `${zip} also appears at row ${firstRow}; only the first occurrence is considered`,
        );
        return;
      }
      // NOTE: the ZIP is claimed at the BOTTOM of this block, not here. A row that
      // fails its own validation must not consume the ZIP, or a CSV holding
      // "75001,,XX" followed by the corrected "75001,Addison,TX" imports nothing
      // and blames the good row for being a duplicate.

      const areaId = raw.areaId ?? dto.areaId;
      if (areaId === undefined) {
        fail(
          rowNumber,
          zip,
          ZipImportRowErrorCode.ZIP_CODE_AREA_MISSING,
          "No market for this row: supply a top-level areaId or an areaId on the row",
        );
        return;
      }

      const rawState =
        raw.state !== undefined && raw.state.length > 0 ? raw.state : dto.defaultState;
      let stateCode: string | null = null;
      if (rawState !== undefined) {
        const upper = rawState.trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(upper)) {
          fail(
            rowNumber,
            zip,
            ZipImportRowErrorCode.ZIP_CODE_STATE_INVALID,
            `"${rawState}" is not a 2-letter USPS state code`,
          );
          return;
        }
        stateCode = upper;
      }

      firstSeenAt.set(zip, rowNumber);
      referencedAreaIds.add(areaId);
      planned.push({
        row: rowNumber,
        zipCode: zip,
        areaId,
        city: raw.city !== undefined && raw.city.length > 0 ? raw.city : null,
        stateCode,
        countryCode: dto.defaultCountry ?? null,
      });
    });

    // ── Step 2: resolve every referenced market in ONE query. ──
    const areas =
      referencedAreaIds.size > 0
        ? await zipCodesRepository.findAreasByIds([...referencedAreaIds])
        : [];
    const areaById = new Map(areas.map((area) => [area.id, area]));

    const usable: PlannedImportRow[] = [];
    for (const row of planned) {
      const area = areaById.get(row.areaId);
      if (!area) {
        fail(
          row.row,
          row.zipCode,
          ZipImportRowErrorCode.ZIP_CODE_AREA_NOT_FOUND,
          "That market does not exist",
        );
        continue;
      }
      if (area.status === GeoStatus.ARCHIVED) {
        fail(
          row.row,
          row.zipCode,
          ZipImportRowErrorCode.ZIP_CODE_AREA_ARCHIVED,
          `Cannot assign a ZIP code to the archived market "${area.name}".`,
        );
        continue;
      }
      usable.push(row);
    }

    // ── Step 3: ONE lookup for every existing row. ──
    const existingRows =
      usable.length > 0
        ? await zipCodesRepository.findManyByCodes(usable.map((row) => row.zipCode))
        : [];
    const existingByCode = new Map(existingRows.map((row) => [row.zipCode, row]));

    // ── Step 4: classify. ──
    const work: ImportWorkItem[] = [];
    const moveCandidates: Array<{
      row: number;
      zipCode: string;
      id: string;
      fromAreaName: string;
      toAreaId: string;
      patch: ImportUpdateRow | null;
    }> = [];
    let skipped = 0;

    for (const row of usable) {
      const patch = this.toFieldPatch(row);
      const existing = existingByCode.get(row.zipCode);

      if (!existing) {
        work.push({
          kind: "create",
          row: row.row,
          zipCode: row.zipCode,
          create: {
            zipCode: row.zipCode,
            areaId: row.areaId,
            city: row.city,
            stateCode: row.stateCode,
            countryCode: row.countryCode,
          },
        });
        continue;
      }

      if (existing.status === GeoStatus.ARCHIVED) {
        fail(
          row.row,
          row.zipCode,
          ZipImportRowErrorCode.ZIP_CODE_EXISTS_ARCHIVED,
          `${row.zipCode} exists but is archived in "${existing.area.name}". Restore it instead.`,
        );
        continue;
      }

      if (existing.areaId === row.areaId) {
        if (dto.conflictMode === "SKIP" || patch === null) {
          skipped += 1;
          continue;
        }
        work.push({
          kind: "update",
          row: row.row,
          zipCode: row.zipCode,
          update: patch,
        });
        continue;
      }

      if (dto.conflictMode !== "MOVE") {
        fail(
          row.row,
          row.zipCode,
          ZipImportRowErrorCode.ZIP_CODE_EXISTS_OTHER_AREA,
          `${row.zipCode} already belongs to "${existing.area.name}". Re-run with conflictMode MOVE to reassign it.`,
        );
        continue;
      }

      moveCandidates.push({
        row: row.row,
        zipCode: row.zipCode,
        id: existing.id,
        fromAreaName: existing.area.name,
        toAreaId: row.areaId,
        patch,
      });
    }

    // ── Step 4b: pre-check the composite FK for every move, in ONE query. ──
    if (moveCandidates.length > 0) {
      const overridesByZip = await this.loadOverridesByZip(
        moveCandidates.map((candidate) => candidate.id),
      );
      for (const candidate of moveCandidates) {
        const services = overridesByZip.get(candidate.id);
        if (services && services.length > 0) {
          fail(
            candidate.row,
            candidate.zipCode,
            ZipImportRowErrorCode.ZIP_MOVE_BLOCKED_BY_COVERAGE,
            `${candidate.zipCode} has coverage rules under "${candidate.fromAreaName}" (${services
              .map((service) => service.name)
              .join(", ")}). Clear that ZIP's service overrides before moving it.`,
          );
          continue;
        }
        work.push({
          kind: "move",
          row: candidate.row,
          zipCode: candidate.zipCode,
          move: { id: candidate.id, areaId: candidate.toAreaId },
          patch: candidate.patch,
        });
      }
    }

    work.sort((a, b) => a.row - b.row);

    // ── Blast radius + the ZIP-create hook's payload, computed before any write
    //    so dryRun reports the identical numbers. ──
    const createAreaIds = [
      ...new Set(
        work.flatMap((item) => (item.kind === "create" ? [item.create.areaId] : [])),
      ),
    ];
    // A MOVE grows the destination market by one ZIP just as much as a create
    // does, and (because the ZIP-create hook does not fire on moves) every service
    // with ALLOW + autoIncludeNewZips there inherits it. Counting only creates
    // under-reports the blast radius the confirm dialog exists to show.
    const gainingAreaIds = [
      ...new Set([
        ...createAreaIds,
        ...work.flatMap((item) => (item.kind === "move" ? [item.move.areaId] : [])),
      ]),
    ];
    const [autoExclusionsByArea, newlyCoveredServiceCount] = await Promise.all([
      this.loadAutoExclusionsByArea(createAreaIds),
      this.countNewlyCoveredServices(gainingAreaIds),
    ]);

    const plannedCreates = work.filter((item) => item.kind === "create").length;
    const plannedUpdates = work.filter((item) => item.kind === "update").length;
    const plannedMoves = work.filter((item) => item.kind === "move").length;

    // ── Step 5: dryRun stops here — steps 1–4 with zero writes. ──
    if (dto.dryRun) {
      return this.buildImportResult({
        dryRun: true,
        received,
        created: plannedCreates,
        updated: plannedUpdates,
        moved: plannedMoves,
        skipped,
        failures,
        failedCount,
        chunks: [],
        newlyCoveredServiceCount,
      });
    }

    // ── Step 6: execute in chunks, each in its OWN transaction. ──
    const chunks: BulkImportChunkResult[] = [];
    let created = 0;
    let updated = 0;
    let moved = 0;

    for (let offset = 0; offset < work.length; offset += BULK_IMPORT_CHUNK_SIZE) {
      const slice = work.slice(offset, offset + BULK_IMPORT_CHUNK_SIZE);
      const index = chunks.length;
      const creates: ImportCreateRow[] = [];
      const updates: ImportUpdateRow[] = [];
      const moves: ImportMoveRow[] = [];
      let sliceUpdates = 0;

      for (const item of slice) {
        if (item.kind === "create") creates.push(item.create);
        else if (item.kind === "update") {
          updates.push(item.update);
          sliceUpdates += 1;
        } else {
          moves.push(item.move);
          // A MOVE also refreshes city/state when the CSV supplied them; the row
          // still counts as `moved`, never as both.
          if (item.patch) updates.push(item.patch);
        }
      }

      try {
        const outcome = await zipCodesRepository.runImportChunk({
          creates,
          updates,
          moves,
          autoExclusionsByArea,
        });
        created += outcome.created;
        moved += outcome.moved;
        updated += sliceUpdates;
        if (outcome.exclusionsCreated > 0) {
          logger.info("zipCode.autoExcluded", {
            chunk: index,
            exclusions: outcome.exclusionsCreated,
          });
        }
        chunks.push({ index, rows: slice.length, committed: true });
      } catch (err) {
        logger.error("zipCode.importChunkFailed", {
          chunk: index,
          rows: slice.length,
          error: errorMessage(err),
        });
        chunks.push({
          index,
          rows: slice.length,
          committed: false,
          error: errorMessage(err),
        });
        for (const item of slice) {
          fail(
            item.row,
            item.zipCode,
            ZipImportRowErrorCode.ZIP_IMPORT_CHUNK_FAILED,
            "This row's batch did not commit; re-run the import for these rows.",
          );
        }
      }
    }

    return this.buildImportResult({
      dryRun: false,
      received,
      created,
      updated,
      moved,
      skipped,
      failures,
      failedCount,
      chunks,
      newlyCoveredServiceCount,
    });
  }

  /** null when the CSV supplied nothing to write — the row is then a pure skip. */
  private toFieldPatch(row: PlannedImportRow): ImportUpdateRow | null {
    if (row.city === null && row.stateCode === null && row.countryCode === null) {
      return null;
    }
    return {
      zipCode: row.zipCode,
      city: row.city,
      stateCode: row.stateCode,
      countryCode: row.countryCode,
    };
  }

  private buildImportResult(input: {
    dryRun: boolean;
    received: number;
    created: number;
    updated: number;
    moved: number;
    skipped: number;
    failures: BulkImportRowError[];
    failedCount: number;
    chunks: BulkImportChunkResult[];
    newlyCoveredServiceCount: number;
  }): BulkImportZipCodesResult {
    const { created, updated, moved, skipped } = input;
    return {
      dryRun: input.dryRun,
      created,
      updated,
      moved,
      skipped,
      summary: {
        received: input.received,
        created,
        updated,
        moved,
        skipped,
        failed: input.failedCount,
      },
      failed: input.failures,
      errors: input.failures,
      errorsTruncated: input.failedCount > input.failures.length,
      chunks: input.chunks,
      newlyCoveredServiceCount: input.newlyCoveredServiceCount,
    };
  }

  // ── Shared guards ──────────────────────────────────────────────────────────
  private async requireZipCode(id: string): Promise<ZipCodeWithArea> {
    const row = await zipCodesRepository.findByIdWithArea(id);
    if (!row) {
      throw codedError(
        HttpStatus.NOT_FOUND,
        ZipCodeErrorCode.ZIP_CODE_NOT_FOUND,
        "ZIP code not found",
      );
    }
    return row;
  }

  /**
   * Mutation freeze: an ARCHIVED row rejects every mutation except restore. This
   * is what keeps the state space at three instead of six.
   */
  private assertNotArchived(row: ZipCodeWithArea): void {
    if (row.status === GeoStatus.ARCHIVED) {
      throw codedError(
        HttpStatus.CONFLICT,
        ZipCodeErrorCode.ZIP_CODE_ARCHIVED,
        `${row.zipCode} is archived. Restore it before making changes.`,
        { archivedId: row.id },
      );
    }
  }

  /** The target market must exist and must not be archived. */
  private async requireAssignableArea(areaId: string): Promise<{
    id: string;
    name: string;
    slug: string;
    status: GeoStatus;
  }> {
    const area = await zipCodesRepository.findAreaById(areaId);
    if (!area) {
      throw codedError(
        HttpStatus.NOT_FOUND,
        ZipCodeErrorCode.AREA_NOT_FOUND,
        "Area not found",
      );
    }
    if (area.status === GeoStatus.ARCHIVED) {
      throw codedError(
        HttpStatus.CONFLICT,
        ZipCodeErrorCode.ZIP_CODE_AREA_ARCHIVED,
        "Cannot assign a ZIP code to an archived area.",
        { areaId: area.id, areaName: area.name },
      );
    }
    return area;
  }

  /**
   * `zipCode` is unique GLOBALLY, not per area. An ARCHIVED collision reports its
   * own code + `details.archivedId` so the admin can restore-and-move instead of
   * being told "already exists" about a row no list shows them.
   */
  private async assertZipCodeAvailable(
    zipCode: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await zipCodesRepository.findByCodeWithArea(zipCode);
    if (!existing || existing.id === exceptId) return;

    if (existing.status === GeoStatus.ARCHIVED) {
      throw codedError(
        HttpStatus.CONFLICT,
        ZipCodeErrorCode.ZIP_CODE_ARCHIVED_EXISTS,
        `ZIP code ${zipCode} exists but is archived. Restore it instead.`,
        {
          archivedId: existing.id,
          areaId: existing.areaId,
          areaName: existing.area.name,
        },
      );
    }

    throw codedError(
      HttpStatus.CONFLICT,
      ZipCodeErrorCode.ZIP_CODE_EXISTS,
      `ZIP code ${zipCode} already belongs to "${existing.area.name}". Move it, or edit it there.`,
      {
        existingId: existing.id,
        areaId: existing.areaId,
        areaName: existing.area.name,
      },
    );
  }

  /**
   * Pre-check the composite FK. Postgres would refuse the UPDATE anyway (that is
   * the whole point of ON UPDATE RESTRICT), but the FK error names a constraint,
   * not the services an admin has to go clear.
   */
  private async assertMovable(
    row: ZipCodeWithArea,
    targetAreaName: string,
  ): Promise<void> {
    const overridesByZip = await this.loadOverridesByZip([row.id]);
    const services = overridesByZip.get(row.id);
    if (!services || services.length === 0) return;
    throw this.moveBlockedError(row.zipCode, row.area.name, targetAreaName, services);
  }

  private moveBlockedError(
    zipCode: string,
    fromAreaName: string,
    targetAreaName: string | undefined,
    services: BlockingCoverageService[],
  ): ApiError {
    const destination =
      targetAreaName !== undefined ? ` to "${targetAreaName}"` : "";
    return codedError(
      HttpStatus.CONFLICT,
      ZipCodeErrorCode.ZIP_MOVE_BLOCKED_BY_COVERAGE,
      `${zipCode} has coverage rules under "${fromAreaName}". Clear that ZIP's service overrides before moving it${destination}.`,
      { services },
    );
  }

  /**
   * The `autoIncludeNewZips = false` hook (§4.3). A service that has excluded a
   * ZIP in this market has demonstrated the market is not uniformly serviceable,
   * so a newly-created ZIP must NOT silently expand its coverage: write an
   * explicit DENY instead. Bounded at one row per opted-out service, and the
   * resolver stays a clean two-tier COALESCE with no third bit.
   */
  private async loadAutoExclusions(areaId: string): Promise<AutoExclusion[]> {
    const byArea = await this.loadAutoExclusionsByArea([areaId]);
    return byArea.get(areaId) ?? [];
  }

  private async loadAutoExclusionsByArea(
    areaIds: string[],
  ): Promise<Map<string, AutoExclusion[]>> {
    const byArea = new Map<string, AutoExclusion[]>();
    if (areaIds.length === 0) return byArea;
    const rules = await zipCodesRepository.findAreaCoverage({
      areaId: { in: areaIds },
      effect: CoverageEffect.ALLOW,
      autoIncludeNewZips: false,
    });
    for (const rule of rules) {
      const list = byArea.get(rule.areaId) ?? [];
      list.push({ serviceId: rule.serviceId, effect: CoverageEffect.DENY });
      byArea.set(rule.areaId, list);
    }
    return byArea;
  }

  /**
   * Blast radius for the import confirm dialog: services that inherit coverage
   * automatically in the markets about to gain ZIPs.
   */
  private async countNewlyCoveredServices(areaIds: string[]): Promise<number> {
    if (areaIds.length === 0) return 0;
    const rules = await zipCodesRepository.findAreaCoverage({
      areaId: { in: areaIds },
      effect: CoverageEffect.ALLOW,
      autoIncludeNewZips: true,
    });
    return new Set(rules.map((rule) => rule.serviceId)).size;
  }

  /**
   * Translate the Prisma failures this module can provoke. Nothing here may fall
   * through to the global handler's generic 400 "Database request error" or to a
   * 500.
   *
   * `fkAs` says what a foreign-key refusal MEANS at this call site, because the
   * ZipCode table has two of them and they are opposite facts:
   *   - `"move"`  -> the composite `(zipCodeId, areaId)` FK on ServiceZipCoverage
   *                  refused an areaId change. Only reachable when areaId moves.
   *   - `"area"`  -> `ZipCode.areaId -> Area.id` refused, i.e. the market was
   *                  deleted between the pre-check and the write.
   * Omit it and an FK error is re-thrown untranslated: a status-only write cannot
   * violate either FK, and guessing there is how "75001 has coverage rules under
   * its current market" ends up on a request that never touched an area.
   */
  private toApiError(
    err: unknown,
    ctx: {
      zipCode: string;
      areaName?: string;
      targetAreaName?: string;
      fkAs?: "move" | "area";
    },
  ): unknown {
    if (isForeignKeyViolation(err)) {
      if (ctx.fkAs === "move") {
        return this.moveBlockedError(
          ctx.zipCode,
          ctx.areaName ?? "its current market",
          ctx.targetAreaName,
          [],
        );
      }
      if (ctx.fkAs === "area") {
        return codedError(
          HttpStatus.NOT_FOUND,
          ZipCodeErrorCode.AREA_NOT_FOUND,
          "Area not found",
        );
      }
      return err;
    }
    if (isUniqueViolation(err)) {
      return codedError(
        HttpStatus.CONFLICT,
        ZipCodeErrorCode.ZIP_CODE_EXISTS,
        `ZIP code ${ctx.zipCode} already exists.`,
      );
    }
    if (isRecordNotFound(err)) {
      return codedError(
        HttpStatus.NOT_FOUND,
        ZipCodeErrorCode.ZIP_CODE_NOT_FOUND,
        "ZIP code not found",
      );
    }
    return err;
  }
}

export const zipCodesService = new ZipCodesService();
