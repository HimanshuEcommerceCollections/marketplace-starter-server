import type { z } from "zod";
import type {
  CoverageEffect,
  CoverageSource,
  GeoStatus,
  LocationMode,
  ServiceStatus,
} from "../../enums";
import type {
  coverageCheckQuerySchema,
  putAreaCoverageSchema,
  serviceCoverageAreaParamsSchema,
  serviceCoverageCheckQuerySchema,
  serviceCoverageParamsSchema,
} from "./coverage.validation";

// ────────────────────────────────────────────────────────────────────────────
// DTOs inferred from the zod schemas (repo convention: types mirror validation)
// ────────────────────────────────────────────────────────────────────────────

export type CoverageCheckQuery = z.infer<typeof coverageCheckQuerySchema>;
export type ServiceCoverageParams = z.infer<typeof serviceCoverageParamsSchema>;
export type ServiceCoverageAreaParams = z.infer<
  typeof serviceCoverageAreaParamsSchema
>;
export type ServiceCoverageCheckQuery = z.infer<
  typeof serviceCoverageCheckQuerySchema
>;
export type PutAreaCoverageDto = z.infer<typeof putAreaCoverageSchema>;

// ────────────────────────────────────────────────────────────────────────────
// App-only enums (no database column). These would normally live in
// src/enums/app.enums.ts beside SortOrder/TokenType, but that file is owned
// elsewhere; see the wiring notes in the module report. They are `as const`
// objects rather than TS `enum`s so `z.nativeEnum()` accepts them exactly the
// way it accepts the generated Prisma enums.
// ────────────────────────────────────────────────────────────────────────────

/**
 * The admin editor's 4-mode per-area control. A **projection computed by the
 * server**, never a stored column — storage is the two `effect` values:
 *
 * | mode         | ServiceAreaCoverage | ServiceZipCoverage | scenario |
 * |--------------|---------------------|--------------------|----------|
 * | `ALL`        | row, `ALLOW`        | none               | S2       |
 * | `ALL_EXCEPT` | row, `ALLOW`        | >=1 `DENY`         | S1       |
 * | `ONLY`       | row, `DENY`         | >=1 `ALLOW`        | S3       |
 * | `NONE`       | no row              | none               | uncovered|
 */
export const CoverageMode = {
  ALL: "ALL",
  ALL_EXCEPT: "ALL_EXCEPT",
  ONLY: "ONLY",
  NONE: "NONE",
} as const;
export type CoverageMode = (typeof CoverageMode)[keyof typeof CoverageMode];

/** Which precedence tier produced the verdict. Appendable (CITY/COUNTY/STATE). */
export const CoverageTier = { ZIP: "ZIP", AREA: "AREA" } as const;
export type CoverageTier = (typeof CoverageTier)[keyof typeof CoverageTier];

/**
 * The INTERNAL reason a decision came out the way it did. Staff-visible only.
 * `CoverageSource` (a real DB enum) says *which tier authorised* an allow;
 * this says *why*, including for denies, where there is no source.
 *
 * `UNKNOWN_ZIP` is the "ZIP is not in the system at all" outcome — deliberately
 * distinct from `NOT_CONFIGURED` ("the ZIP exists but no rule reaches it"),
 * because the customer experience differs: "we don't recognise that ZIP" vs
 * "we don't serve it yet — join the waitlist".
 */
export const CoverageReason = {
  /** REMOTE service: coverage does not apply. Allowed. */
  NOT_LOCATION_BOUND: "NOT_LOCATION_BOUND",
  /** Gate G2 — service is not ACTIVE. Denied before geography is reported. */
  SERVICE_NOT_BOOKABLE: "SERVICE_NOT_BOOKABLE",
  /** Phase I1 — the input was not 5 digits. A shape complaint (422), not a deny. */
  ZIP_INVALID: "ZIP_INVALID",
  /** Phase I2 — no ZipCode row for that code. */
  UNKNOWN_ZIP: "UNKNOWN_ZIP",
  /** Gate I3 — ZipCode.status !== ACTIVE. Beats every rule. */
  ZIP_INACTIVE: "ZIP_INACTIVE",
  /** Gate I4 — Area.status !== ACTIVE. Whole-market kill switch. */
  AREA_INACTIVE: "AREA_INACTIVE",
  ALLOWED_BY_ZIP: "ALLOWED_BY_ZIP",
  ALLOWED_BY_AREA: "ALLOWED_BY_AREA",
  /** Phase F — ZIP unknown, allowed against an explicitly supplied areaId. */
  ALLOWED_BY_AREA_FALLBACK: "ALLOWED_BY_AREA_FALLBACK",
  DENIED_BY_ZIP: "DENIED_BY_ZIP",
  DENIED_BY_AREA: "DENIED_BY_AREA",
  /** No rule at ANY tier reaches this ZIP. Denied, but waitlist-eligible. */
  NOT_CONFIGURED: "NOT_CONFIGURED",
} as const;
export type CoverageReason =
  (typeof CoverageReason)[keyof typeof CoverageReason];

/**
 * The COLLAPSED reason an anonymous caller is allowed to see. The collapse is
 * the non-leak boundary: `UNKNOWN_ZIP`, `ZIP_INACTIVE` and `AREA_INACTIVE` all
 * become `UNKNOWN_ZIP`, so an anonymous caller can never learn whether a ZIP
 * exists in the system, and `DENIED_BY_ZIP`, `DENIED_BY_AREA` and
 * `NOT_CONFIGURED` all become `NOT_SERVICEABLE`, so per-service rollout
 * geography is not mappable tier by tier.
 */
export const PublicCoverageReason = {
  SERVICEABLE: "SERVICEABLE",
  NOT_LOCATION_BOUND: "NOT_LOCATION_BOUND",
  SERVICE_NOT_BOOKABLE: "SERVICE_NOT_BOOKABLE",
  UNKNOWN_ZIP: "UNKNOWN_ZIP",
  NOT_SERVICEABLE: "NOT_SERVICEABLE",
} as const;
export type PublicCoverageReason =
  (typeof PublicCoverageReason)[keyof typeof PublicCoverageReason];

/**
 * Machine-readable error codes for this feature. These belong in a shared
 * `src/constants/error-codes.ts` (see the module report); until `ApiError`
 * gains a first-class `code` field they travel inside `ApiError.details`.
 */
export const CoverageErrorCode = {
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
  COVERAGE_VERSION_STALE: "COVERAGE_VERSION_STALE",
  COVERAGE_AREA_NOT_FOUND: "COVERAGE_AREA_NOT_FOUND",
  COVERAGE_AREA_ARCHIVED: "COVERAGE_AREA_ARCHIVED",
  COVERAGE_ZIP_NOT_FOUND: "COVERAGE_ZIP_NOT_FOUND",
  COVERAGE_ZIP_AREA_MISMATCH: "COVERAGE_ZIP_AREA_MISMATCH",
  COVERAGE_AREA_RULE_REQUIRED: "COVERAGE_AREA_RULE_REQUIRED",
  ZIP_REQUIRED: "ZIP_REQUIRED",
  ZIP_INVALID: "ZIP_INVALID",
  ZIP_NOT_SERVICEABLE: "ZIP_NOT_SERVICEABLE",
} as const;
export type CoverageErrorCode =
  (typeof CoverageErrorCode)[keyof typeof CoverageErrorCode];

// ────────────────────────────────────────────────────────────────────────────
// Raw-query row shapes
// ────────────────────────────────────────────────────────────────────────────

/**
 * The single row returned by the resolution query (coverage.repository.ts).
 * Enum columns are selected `::text` and typed back to their union here — a
 * deliberate assertion: the SQL is literal, the Postgres enum labels are
 * byte-identical to the Prisma ones, and every consumer (`decideCoverage`)
 * fails CLOSED on an unexpected value.
 */
export interface CoverageResolutionRow {
  zipCodeId: string;
  zip: string;
  zipStatus: GeoStatus;
  areaId: string;
  areaName: string;
  areaSlug: string;
  areaStatus: GeoStatus;
  /** NULL => the service has no rule for this area (NOT_CONFIGURED territory). */
  areaEffect: CoverageEffect | null;
  areaRuleId: string | null;
  /** NULL => no ZIP-level override; inherit the area tier. */
  zipEffect: CoverageEffect | null;
  zipRuleId: string | null;
  /**
   * `COALESCE(zipEffect, areaEffect, 'DENY')` computed DB-side. Carried so the
   * SQL is self-documenting and so the JS precedence walk can be diffed against
   * it; the verdict itself is derived from the two tier columns, because the
   * tier is what `CoverageSource` has to report.
   */
  effect: CoverageEffect;
}

/** `GROUP BY "areaId"` over ACTIVE ZipCodes — service-independent, cacheable. */
export interface AreaZipCountRow {
  areaId: string;
  zipCount: number;
}

/** One row of "every ACTIVE service bookable at this ZIP". */
export interface AvailableServiceRow {
  id: string;
  slug: string;
  name: string;
  /** true when a ZIP-level rule authorised it, false when the area rule did. */
  byZip: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Resolver contract
// ────────────────────────────────────────────────────────────────────────────

/** The slice of `Service` the resolver reads. Pass it in to avoid a re-fetch. */
export interface CoverageServiceIdentity {
  id: string;
  slug: string;
  name: string;
  status: ServiceStatus;
  locationMode: LocationMode;
  locationModes: LocationMode[];
  coverageVersion: number;
}

export interface ResolveOptions {
  /**
   * Only ever a SERVER-derived area id (the admin editor's preview, an internal
   * backfill). Never plumb a customer-supplied area here: self-selected
   * geography is the bypass this whole feature exists to close.
   */
  requestedAreaId?: string;
  /** Already validated against `Service.locationModes` by the caller (Guard 1). */
  mode?: LocationMode;
  /** Pre-loaded service row, so callers that already have it pay one query. */
  service?: CoverageServiceIdentity;
}

export interface CoverageAreaRef {
  id: string;
  name: string;
  slug: string;
  status: GeoStatus;
}

export interface CoverageZipRef {
  id: string;
  zipCode: string;
  status: GeoStatus;
}

/** The resolver's verdict. Total: every input produces one of these, no throw. */
export interface CoverageDecision {
  allowed: boolean;
  /** Set only on an allow — nothing "sources" a deny. Stamped on Booking. */
  source: CoverageSource | null;
  reason: CoverageReason;
  /** Normalized 5-digit ZIP, or null when the input was unusable. */
  zip: string | null;
  /** Null when geography was never reached (G2) or never identified (I2/F2). */
  area: CoverageAreaRef | null;
  /** Null for the AREA_FALLBACK path — there is no ZipCode row by definition. */
  zipCode: CoverageZipRef | null;
  matchedTier: CoverageTier | null;
  matchedRuleId: string | null;
}

/** The precedence verdict alone — the output of the pure `decideCoverage()`. */
export type CoverageRuleVerdict = Pick<
  CoverageDecision,
  "allowed" | "source" | "reason" | "matchedTier" | "matchedRuleId"
>;

/**
 * Exactly the coverage columns `bookings.create()` persists. Returned by
 * `assertServiceable()` so the bookings module never re-derives them.
 */
export interface CoverageStamp {
  areaId: string | null;
  zipCodeId: string | null;
  postalCode: string | null;
  areaNameSnapshot: string | null;
  coverageSource: CoverageSource | null;
  /** For the legacy `Booking.area` enum dual-write: `SLUG_TO_ENUM[areaSlug]`. */
  areaSlug: string | null;
}

export interface AssertServiceableInput {
  service: CoverageServiceIdentity;
  /** Raw customer input; normalized internally (belt & braces for internal callers). */
  zip?: string | null;
  /** Resolved location mode, already validated against the service's offer set. */
  mode?: LocationMode;
  requestedAreaId?: string;
  /**
   * When false the resolver still runs and logs but never throws, and the
   * stamp comes back empty. The `BOOKING_COVERAGE_ENFORCED` rollback lever.
   */
  enforced?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Public availability check
// ────────────────────────────────────────────────────────────────────────────

export interface CheckCoverageInput {
  /** Already normalized to 5 digits by `zipSchema`. */
  zip: string;
  serviceId?: string;
  serviceSlug?: string;
  /** Drives disclosure: staff get the internal reason + matched rule. */
  staff: boolean;
}

export interface CoverageCheckServiceEntry {
  id: string;
  slug: string;
  name: string;
  source: CoverageSource;
}

export interface CoverageCheckResult {
  zip: string;
  serviceable: boolean;
  /** Internal `CoverageReason` for staff; collapsed `PublicCoverageReason` otherwise. */
  reason: CoverageReason | PublicCoverageReason;
  /** Returned only inside the published footprint (ZIP ACTIVE and area ACTIVE). */
  area: { id: string; name: string; slug: string } | null;
  service: { id: string; slug: string; name: string } | null;
  /** Present only when the caller named no service: everything bookable here. */
  services?: CoverageCheckServiceEntry[];
  /** Staff only. Never crosses the wire for an anonymous caller. */
  matchedTier?: CoverageTier | null;
  /** Staff only. */
  matchedRuleId?: string | null;
  /** Server-authored, user-facing. Render verbatim. */
  message: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Admin coverage document
// ────────────────────────────────────────────────────────────────────────────

export interface CoverageListedZip {
  id: string;
  zipCode: string;
  city: string | null;
  status: GeoStatus;
}

export interface CoverageAreaEntry {
  areaId: string;
  name: string;
  slug: string;
  status: GeoStatus;
  mode: CoverageMode;
  /** ACTIVE ZipCodes in this area. Service-independent. */
  areaZipCount: number;
  /** ACTIVE ZipCodes this service actually reaches. Server-authored, always. */
  effectiveZipCount: number;
  /**
   * True for `ALL`/`ALL_EXCEPT`. An ALLOW area with ZERO ZIPs is COVERED, not
   * "0 of 0" — render "Covered area-wide", or every ZIP-less market silently
   * vanishes from "areas we serve".
   */
  areaWide: boolean;
  /** Whether this area currently yields any bookable ZIP. Server-authored. */
  available: boolean;
  autoIncludeNewZips: boolean;
  /**
   * Every stored ZIP rule for the mode's effect — INCLUDING rules on
   * INACTIVE/ARCHIVED ZipCodes, so re-saving the card round-trips losslessly
   * instead of silently dropping them.
   */
  listedZips: CoverageListedZip[];
  /** Server-authored prose. Never let the client compose this. */
  summaryLine: string;
  /** Anomalies surfaced, never auto-corrected. */
  warning: string | null;
}

export interface CoverageDocument {
  service: { id: string; slug: string; name: string; status: ServiceStatus };
  /** Echo this back in the PUT body. A mismatch is a 409, not a lost update. */
  version: number;
  summary: string;
  totals: { areaCount: number; zipCount: number; totalAreaCount: number };
  areas: CoverageAreaEntry[];
  uncoveredAreas: Array<{ areaId: string; name: string; slug: string }>;
}

export interface PutAreaCoverageResult {
  area: CoverageAreaEntry;
  version: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal fold inputs (repository -> service)
// ────────────────────────────────────────────────────────────────────────────

export interface AreaRuleRow {
  id: string;
  areaId: string;
  effect: CoverageEffect | null;
  autoIncludeNewZips: boolean;
  area: CoverageAreaRef;
}

export interface ZipRuleRow {
  id: string;
  areaId: string;
  effect: CoverageEffect | null;
  zipCode: CoverageListedZip;
}

/** The write plan a `CoverageMode` compiles down to. */
export interface AreaWritePlan {
  /** null => delete the area row entirely (mode NONE). */
  areaEffect: CoverageEffect | null;
  /** null => write no ZIP rules. */
  zipEffect: CoverageEffect | null;
  autoIncludeNewZips: boolean;
}
