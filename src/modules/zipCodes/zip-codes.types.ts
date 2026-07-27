import type { z } from "zod";
import type { CoverageEffect, GeoStatus } from "../../enums";
import type {
  bulkImportZipCodesSchema,
  bulkMoveZipCodesSchema,
  bulkZipCodeStatusSchema,
  createZipCodeSchema,
  listZipCodesSchema,
  updateZipCodeSchema,
  updateZipCodeStatusSchema,
  zipCodeSortFields,
  zipImportConflictModes,
} from "./zip-codes.validation";

export type ListZipCodesQuery = z.infer<typeof listZipCodesSchema>;
export type CreateZipCodeDto = z.infer<typeof createZipCodeSchema>;
export type UpdateZipCodeDto = z.infer<typeof updateZipCodeSchema>;
export type UpdateZipCodeStatusDto = z.infer<typeof updateZipCodeStatusSchema>;
export type BulkZipCodeStatusDto = z.infer<typeof bulkZipCodeStatusSchema>;
export type BulkMoveZipCodesDto = z.infer<typeof bulkMoveZipCodesSchema>;
export type BulkImportZipCodesDto = z.infer<typeof bulkImportZipCodesSchema>;

export type ZipCodeSortField = (typeof zipCodeSortFields)[number];
export type ZipImportConflictMode = (typeof zipImportConflictModes)[number];

/**
 * A status the staff toggle endpoints may set. ARCHIVED is excluded at the type
 * level so a future caller cannot reintroduce the archive/un-archive bypass that
 * `/:id/status` used to offer around the admin-only `/archive` + `/restore`.
 */
export type LiveGeoStatus = Exclude<GeoStatus, "ARCHIVED">;

/**
 * Machine-readable error codes for this module.
 *
 * `ApiError` has no top-level `code` field yet — §5.5 lists that edit
 * (`ApiError.coded` + `error-handler` emitting `code`) plus a shared
 * `src/constants/error-codes.ts` as wiring owned outside this module. Until it
 * lands, the code travels inside `ApiError.details`, which the global handler
 * emits as `errors`. Call sites do not change when the wiring arrives; only
 * `codedError()` in zip-codes.service.ts does.
 */
export const ZipCodeErrorCode = {
  ZIP_CODE_NOT_FOUND: "ZIP_CODE_NOT_FOUND",
  ZIP_CODE_EXISTS: "ZIP_CODE_EXISTS",
  /** Design catalogue name. The assignment brief calls this ZIP_ARCHIVED_EXISTS. */
  ZIP_CODE_ARCHIVED_EXISTS: "ZIP_CODE_ARCHIVED_EXISTS",
  ZIP_CODE_ARCHIVED: "ZIP_CODE_ARCHIVED",
  ZIP_CODE_NOT_ARCHIVED: "ZIP_CODE_NOT_ARCHIVED",
  ZIP_CODE_STATUS_TRANSITION_INVALID: "ZIP_CODE_STATUS_TRANSITION_INVALID",
  ZIP_CODE_AREA_ARCHIVED: "ZIP_CODE_AREA_ARCHIVED",
  ZIP_MOVE_BLOCKED_BY_COVERAGE: "ZIP_MOVE_BLOCKED_BY_COVERAGE",
  AREA_NOT_FOUND: "AREA_NOT_FOUND",
  ZIP_IMPORT_TOO_MANY_ROWS: "ZIP_IMPORT_TOO_MANY_ROWS",
} as const;

export type ZipCodeErrorCode =
  (typeof ZipCodeErrorCode)[keyof typeof ZipCodeErrorCode];

/**
 * Per-ROW codes for the bulk importer. These never set the HTTP status — the
 * import always answers 200 and reports them inside `data.failed[]`.
 */
export const ZipImportRowErrorCode = {
  ZIP_CODE_INVALID: "ZIP_CODE_INVALID",
  ZIP_CODE_DUPLICATE_IN_PAYLOAD: "ZIP_CODE_DUPLICATE_IN_PAYLOAD",
  ZIP_CODE_EXISTS_OTHER_AREA: "ZIP_CODE_EXISTS_OTHER_AREA",
  ZIP_CODE_EXISTS_ARCHIVED: "ZIP_CODE_EXISTS_ARCHIVED",
  ZIP_CODE_AREA_MISSING: "ZIP_CODE_AREA_MISSING",
  ZIP_CODE_AREA_NOT_FOUND: "ZIP_CODE_AREA_NOT_FOUND",
  ZIP_CODE_AREA_ARCHIVED: "ZIP_CODE_AREA_ARCHIVED",
  ZIP_CODE_STATE_INVALID: "ZIP_CODE_STATE_INVALID",
  ZIP_MOVE_BLOCKED_BY_COVERAGE: "ZIP_MOVE_BLOCKED_BY_COVERAGE",
  /** A chunk transaction rolled back; none of its rows were written. */
  ZIP_IMPORT_CHUNK_FAILED: "ZIP_IMPORT_CHUNK_FAILED",
} as const;

export type ZipImportRowErrorCode =
  (typeof ZipImportRowErrorCode)[keyof typeof ZipImportRowErrorCode];

/** The parent market, inlined on every ZIP row so admin tables need no N+1. */
export interface ZipCodeAreaRef {
  id: string;
  name: string;
  slug: string;
  status: GeoStatus;
}

/**
 * Serialized ZIP code.
 *
 * `serviceOverrideCount` is the number of ServiceZipCoverage rows pinned to this
 * ZIP — i.e. how many services carry an explicit per-ZIP rule. It is NOT "how
 * many services are available here": that is a coverage rollup, and §4.8 bans
 * rollups from paginated list responses. This count is a single batched query per
 * page and is exactly the number that predicts whether a MOVE will be refused.
 * (§5.2 named the field `serviceCount`; renamed because the Areas module's
 * `serviceCount` means availability, and two different meanings under one name is
 * how an admin ends up archiving a market that is still selling.)
 */
export interface ZipCodeResponse {
  id: string;
  zipCode: string;
  city: string | null;
  stateCode: string;
  countryCode: string;
  status: GeoStatus;
  area: ZipCodeAreaRef;
  serviceOverrideCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * POST /zip-codes/bulk/status.
 *
 * `notFound` and `archived` are additive to §5.2's `{ updated, unchanged }` for
 * the same reason `bulkMove` reports `notFound`: folding a missing id or a frozen
 * ARCHIVED row into `unchanged` tells the admin "nothing to do" about rows that
 * were in fact refused. `unchanged` now means exactly "already at that status".
 */
export interface BulkZipCodeStatusResult {
  updated: number;
  /** Requested ZIPs that were already at the target status. */
  unchanged: number;
  /** Requested ids with no ZipCode row. */
  notFound: string[];
  /** Ids refused by the mutation freeze — ARCHIVED rows must be restored first. */
  archived: string[];
}

/** One service whose zip-level rule pins a ZIP to its current market. */
export interface BlockingCoverageService {
  id: string;
  name: string;
  effect: CoverageEffect | null;
}

/** A ZIP the composite FK refuses to move, and the rules responsible. */
export interface BlockedZipCodeMove {
  zipCodeId: string;
  zipCode: string;
  areaId: string;
  areaName: string;
  services: BlockingCoverageService[];
}

/**
 * POST /zip-codes/bulk/move. Partial success is the DESIGNED outcome: the movable
 * ZIPs commit and the pinned ones come back in `blocked` (§5.2).
 */
export interface BulkMoveZipCodesResult {
  moved: number;
  /** Requested ZIPs already in the target market. */
  unchanged: number;
  /** Requested ids with no ZipCode row. */
  notFound: string[];
  blocked: BlockedZipCodeMove[];
}

export interface BulkImportRowError {
  /** 1-based index into the SUBMITTED rows array, stable regardless of filtering. */
  row: number;
  zipCode: string;
  code: ZipImportRowErrorCode;
  message: string;
}

/** A multi-chunk import is not atomic, so the client is told what committed. */
export interface BulkImportChunkResult {
  index: number;
  rows: number;
  committed: boolean;
  error?: string;
}

export interface BulkImportSummary {
  received: number;
  created: number;
  updated: number;
  moved: number;
  skipped: number;
  failed: number;
}

/**
 * POST /zip-codes/bulk/import. Always HTTP 200, even with row failures — partial
 * success is the normal outcome of a real import and a 4xx would make every
 * client error boundary treat a successful 970-row import as a failure.
 */
export interface BulkImportZipCodesResult {
  dryRun: boolean;
  created: number;
  updated: number;
  moved: number;
  skipped: number;
  summary: BulkImportSummary;
  /** Per-row failures, capped at MAX_BULK_IMPORT_ERRORS. */
  failed: BulkImportRowError[];
  /** Alias of `failed` — §5.6 calls this key `errors`. Drop one once the client is written. */
  errors: BulkImportRowError[];
  errorsTruncated: boolean;
  chunks: BulkImportChunkResult[];
  /**
   * Services that inherit coverage in the markets that gained ZIPs — the blast
   * radius the confirm dialog shows ("this will make 8 services bookable in 812
   * new ZIP codes").
   */
  newlyCoveredServiceCount: number;
}
