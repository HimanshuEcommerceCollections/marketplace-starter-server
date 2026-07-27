import { prisma } from "../../db/client";
import { coverageRepository } from "./coverage.repository";
import { decideCoverage } from "./coverage.rules";
import { ApiError } from "../../utils/api-error";
import { HttpStatus } from "../../constants/http-status";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";
import { normalizeZip } from "./coverage.validation";
import {
  CoverageEffect,
  CoverageSource,
  GeoStatus,
  LocationMode,
  ServiceStatus,
} from "../../enums";
import {
  CoverageErrorCode,
  CoverageMode,
  CoverageReason,
  CoverageTier,
  PublicCoverageReason,
} from "./coverage.types";
import type {
  AreaWritePlan,
  AssertServiceableInput,
  CheckCoverageInput,
  CoverageAreaEntry,
  CoverageAreaRef,
  CoverageCheckResult,
  CoverageCheckServiceEntry,
  CoverageDecision,
  CoverageDocument,
  CoverageListedZip,
  CoverageServiceIdentity,
  CoverageStamp,
  PutAreaCoverageDto,
  PutAreaCoverageResult,
  ResolveOptions,
  ZipRuleRow,
} from "./coverage.types";

/**
 * The pure precedence rule lives in `coverage.rules.ts` (sec05's file layout, and
 * the only genuinely testable artifact in this feature). Re-exported here so the
 * historical import path `from "./coverage.service"` keeps working.
 */
export { decideCoverage };

/**
 * Service statuses a non-staff caller is allowed to see AT ALL. Mirrors
 * `PUBLIC_STATUSES` in services.service.ts:33-37 — that constant is not exported,
 * and duplicating four tokens beats reaching into another module's internals.
 * DRAFT and INACTIVE services must 404 for anonymous callers here exactly as they
 * do on `GET /services/by-slug/:slug`, or the anonymous coverage check becomes an
 * enumeration oracle for unreleased services (id + slug + name).
 */
const PUBLIC_SERVICE_STATUSES: ServiceStatus[] = [
  ServiceStatus.ACTIVE,
  ServiceStatus.COMING_SOON,
];

// ────────────────────────────────────────────────────────────────────────────
// Feature flags
//
// Both live in src/config/env.ts, which is the single validated source of
// configuration and fails fast at boot on a bad value. Re-exported here so the
// resolver's call sites read as flags rather than as config lookups.
// ────────────────────────────────────────────────────────────────────────────

/**
 * When a customer's ZIP is unknown to the database, fall back to the area the
 * client asked for rather than refusing. ON by default so an admin-created
 * market stays bookable between creating it and loading its ZIPs.
 */
export const COVERAGE_ZIP_FALLBACK = env.COVERAGE_ZIP_FALLBACK;

/**
 * Booking-time enforcement. ON by default: an unserved ZIP is rejected. Turning
 * it off makes the resolver still run and log but never throw — the rollback
 * lever (a restart, not a deploy) if coverage data turns out to be wrong.
 */
export const BOOKING_COVERAGE_ENFORCED = env.BOOKING_COVERAGE_ENFORCED;

/** How many ZIPs a server-authored `summaryLine` names before eliding. */
const SUMMARY_ZIP_PREVIEW = 6;

/**
 * Interim carrier for machine-readable error codes.
 *
 * `ApiError` has no `code` field yet (the design adds `ApiError.coded()` plus a
 * top-level `code` in the error handler — two shared files this module does not
 * own). Until then the code rides in `details`, which the global handler emits
 * as `errors`. The array-of-one shape is deliberate: existing clients read
 * `body.errors[0].message` and `body.errors[].path`, so both keep working while
 * `code` and any structured extras come along for free.
 *
 * ONE choke point, so swapping in `ApiError.coded` is a single-function edit.
 */
function coded(
  statusCode: number,
  code: CoverageErrorCode,
  message: string,
  extra?: Record<string, unknown>,
  path?: string,
): ApiError {
  return new ApiError(statusCode, message, [
    { ...(path ? { path } : {}), code, message, ...(extra ?? {}) },
  ]);
}

/**
 * The ONE booking deny. It structurally CANNOT accept a reason — that is the
 * non-leak invariant, enforced by the signature rather than by discipline.
 *
 * All internal deny reasons (UNKNOWN_ZIP, ZIP_INACTIVE, AREA_INACTIVE,
 * DENIED_BY_ZIP, DENIED_BY_AREA, NOT_CONFIGURED) produce a byte-identical
 * response body: same status, same code, same sentence, and the sentence never
 * names the area even when the resolver knows it. The reason reaches
 * `logger.warn` and nothing else. Because the resolution query is a SINGLE
 * statement rather than sequential early-returning lookups, an unknown ZIP also
 * takes the same wall-clock time as a known-but-excluded one — no timing side
 * channel either.
 *
 * 400, not 422 or 409: 422 is taken by `validate` for shape errors, and this is
 * well-formed input semantically rejected — matching the neighbouring
 * `ApiError.badRequest("This service is not currently bookable")`.
 */
export function denyError(zip: string, serviceName: string): ApiError {
  const message =
    `We don't currently serve ZIP code ${zip} for ${serviceName}. ` +
    `Add your email and we'll let you know the moment we do.`;
  return coded(
    HttpStatus.BAD_REQUEST,
    CoverageErrorCode.ZIP_NOT_SERVICEABLE,
    message,
    undefined,
    "zip",
  );
}

/** Map a 4-mode admin intent onto the two `effect` columns that store it. */
function planAreaWrite(mode: PutAreaCoverageDto["mode"]): AreaWritePlan {
  switch (mode) {
    case CoverageMode.ALL:
      return {
        areaEffect: CoverageEffect.ALLOW,
        zipEffect: null,
        autoIncludeNewZips: true,
      };
    case CoverageMode.ALL_EXCEPT:
      // autoIncludeNewZips = false is NOT optional here. Writing a DENY zip rule
      // is direct evidence the market is not uniformly serviceable, so a later
      // bulk paste of ZIPs must not silently expand coverage into it. The
      // ZIP-create hook reads exactly (effect = ALLOW AND autoIncludeNewZips =
      // false) to decide whether to stamp a DENY on each new ZIP, which is what
      // keeps the RESOLVER a clean two-tier COALESCE with no third bit.
      return {
        areaEffect: CoverageEffect.ALLOW,
        zipEffect: CoverageEffect.DENY,
        autoIncludeNewZips: false,
      };
    case CoverageMode.ONLY:
      // No DENY zip rules are written, and the hook is inert for a DENY area
      // rule, so the flag stays true.
      return {
        areaEffect: CoverageEffect.DENY,
        zipEffect: CoverageEffect.ALLOW,
        autoIncludeNewZips: true,
      };
    case CoverageMode.NONE:
    default:
      return { areaEffect: null, zipEffect: null, autoIncludeNewZips: true };
  }
}

/**
 * Internal reason -> the collapsed reason an anonymous caller may see.
 * UNKNOWN_ZIP / ZIP_INACTIVE / AREA_INACTIVE all collapse, so an anonymous
 * caller can never learn whether a ZIP exists in the system.
 */
const PUBLIC_REASON: Record<CoverageReason, PublicCoverageReason> = {
  [CoverageReason.NOT_LOCATION_BOUND]: PublicCoverageReason.NOT_LOCATION_BOUND,
  [CoverageReason.SERVICE_NOT_BOOKABLE]:
    PublicCoverageReason.SERVICE_NOT_BOOKABLE,
  [CoverageReason.ZIP_INVALID]: PublicCoverageReason.UNKNOWN_ZIP,
  [CoverageReason.UNKNOWN_ZIP]: PublicCoverageReason.UNKNOWN_ZIP,
  [CoverageReason.ZIP_INACTIVE]: PublicCoverageReason.UNKNOWN_ZIP,
  [CoverageReason.AREA_INACTIVE]: PublicCoverageReason.UNKNOWN_ZIP,
  [CoverageReason.ALLOWED_BY_ZIP]: PublicCoverageReason.SERVICEABLE,
  [CoverageReason.ALLOWED_BY_AREA]: PublicCoverageReason.SERVICEABLE,
  [CoverageReason.ALLOWED_BY_AREA_FALLBACK]: PublicCoverageReason.SERVICEABLE,
  [CoverageReason.DENIED_BY_ZIP]: PublicCoverageReason.NOT_SERVICEABLE,
  [CoverageReason.DENIED_BY_AREA]: PublicCoverageReason.NOT_SERVICEABLE,
  [CoverageReason.NOT_CONFIGURED]: PublicCoverageReason.NOT_SERVICEABLE,
};

/** `["75002","75043"]` -> `"75002, 75043"`, elided past the preview cap. */
function previewZips(codes: string[]): string {
  if (codes.length <= SUMMARY_ZIP_PREVIEW) return codes.join(", ");
  const shown = codes.slice(0, SUMMARY_ZIP_PREVIEW).join(", ");
  return `${shown} +${codes.length - SUMMARY_ZIP_PREVIEW} more`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export class CoverageService {
  // ══════════════════════════════════════════════════════════════════════════
  // THE RESOLVER
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve one (service, ZIP) pair. TOTAL — never throws, every input yields a
   * `CoverageDecision`. Callers that need an exception use `assertServiceable`.
   *
   * Query budget: TWO index probes, issued in PARALLEL, never a table scan.
   *   1. `Service` by primary key (skipped when the caller pre-loaded it).
   *   2. The single resolution statement in coverage.repository.ts — one SQL
   *      statement covering four unique-index probes (ZipCode, Area,
   *      ServiceZipCoverage, ServiceAreaCoverage).
   *
   * Issuing them in parallel while APPLYING the gates in the documented order
   * (G2 before I2/I3/I4) keeps the verdict semantics of the spec exactly, and
   * keeps wall-clock time constant across every outcome — which is what closes
   * the timing side channel the deny message is engineered against.
   */
  async resolve(
    serviceId: string,
    rawZip: string | null | undefined,
    options: ResolveOptions = {},
  ): Promise<CoverageDecision> {
    // ── PHASE G: GATES ────────────────────────────────────────────────────
    // G1 — REMOTE is not location bound. `options.mode` must already have been
    // validated against Service.locationModes by the caller (Guard 1); this
    // function never trusts a raw request body.
    if (options.mode === LocationMode.REMOTE) {
      return {
        allowed: true,
        source: CoverageSource.NOT_APPLICABLE,
        reason: CoverageReason.NOT_LOCATION_BOUND,
        zip: typeof rawZip === "string" ? normalizeZip(rawZip) : null,
        area: null,
        zipCode: null,
        matchedTier: null,
        matchedRuleId: null,
      };
    }

    // ── PHASE I1: IDENTIFY THE ZIP ────────────────────────────────────────
    // Belt & braces: zod already normalized HTTP input, but internal callers
    // (importer, backfill, admin tooling) reach the resolver directly.
    const zip5 = typeof rawZip === "string" ? normalizeZip(rawZip) : null;
    if (zip5 === null) {
      return {
        allowed: false,
        source: null,
        reason: CoverageReason.ZIP_INVALID,
        zip: null,
        area: null,
        zipCode: null,
        matchedTier: null,
        matchedRuleId: null,
      };
    }

    const preloaded =
      options.service?.id === serviceId ? options.service : undefined;
    const [service, row] = await Promise.all([
      preloaded
        ? Promise.resolve(preloaded)
        : coverageRepository.findServiceById(serviceId),
      coverageRepository.resolveZip(serviceId, zip5),
    ]);

    // G2 — the service gate. Reported with NO geography, because in the spec's
    // ordering geography has not been read at this point.
    if (!service || service.status !== ServiceStatus.ACTIVE) {
      return {
        allowed: false,
        source: null,
        reason: CoverageReason.SERVICE_NOT_BOOKABLE,
        zip: zip5,
        area: null,
        zipCode: null,
        matchedTier: null,
        matchedRuleId: null,
      };
    }

    // ── PHASE F: UNKNOWN-ZIP FALLBACK ─────────────────────────────────────
    if (!row) {
      return this.unknownZipFallback(serviceId, zip5, options.requestedAreaId);
    }

    // ── PHASES I3/I4 + R: gates then the precedence walk ──────────────────
    const verdict = decideCoverage(row);
    return {
      ...verdict,
      zip: zip5,
      area: {
        id: row.areaId,
        name: row.areaName,
        slug: row.areaSlug,
        status: row.areaStatus,
      },
      zipCode: {
        id: row.zipCodeId,
        zipCode: row.zip,
        status: row.zipStatus,
      },
    };
  }

  /**
   * PHASE F. Keeps a newly-created market bookable before its ZIPs have been
   * loaded, and is deliberately narrow: it never invents an area, never fires on
   * absent input, and evaluates the area-wide rule for the EXPLICITLY SUPPLIED
   * areaId only. `requestedAreaId` must never be plumbed from a customer request
   * body — self-selected geography is the bypass this feature exists to close.
   */
  private async unknownZipFallback(
    serviceId: string,
    zip5: string,
    requestedAreaId?: string,
  ): Promise<CoverageDecision> {
    const unknown: CoverageDecision = {
      allowed: false,
      source: null,
      reason: CoverageReason.UNKNOWN_ZIP,
      zip: zip5,
      area: null,
      zipCode: null,
      matchedTier: null,
      matchedRuleId: null,
    };

    // F1/F2 — off, or nothing to evaluate against.
    if (!COVERAGE_ZIP_FALLBACK || !requestedAreaId) return unknown;

    // F3
    const area = await coverageRepository.findAreaWithRule(
      requestedAreaId,
      serviceId,
    );
    if (!area) return unknown;

    const areaRef: CoverageAreaRef = {
      id: area.id,
      name: area.name,
      slug: area.slug,
      status: area.status,
    };
    if (area.status !== GeoStatus.ACTIVE) {
      return { ...unknown, reason: CoverageReason.AREA_INACTIVE, area: areaRef };
    }

    // F4
    const rule = area.serviceCoverage[0];
    if (rule?.effect === CoverageEffect.ALLOW) {
      logger.warn("coverage.unknownZipAreaFallback", {
        serviceId,
        zip: zip5,
        areaId: area.id,
      });
      return {
        allowed: true,
        source: CoverageSource.AREA_FALLBACK,
        reason: CoverageReason.ALLOWED_BY_AREA_FALLBACK,
        zip: zip5,
        area: areaRef,
        zipCode: null,
        matchedTier: CoverageTier.AREA,
        matchedRuleId: rule.id,
      };
    }

    // F5. `matchedTier`/`matchedRuleId` both stay null, per spec: no tier
    // *decided* this outcome. Reporting a rule id with a null tier breaks the
    // invariant every other path upholds (tier non-null <=> ruleId non-null) and
    // would make the staff check panel label a rule it cannot name a tier for.
    // The rule id is not lost — it reaches the warn line below.
    if (rule) {
      logger.warn("coverage.unknownZipAreaNotAllowed", {
        serviceId,
        zip: zip5,
        areaId: area.id,
        areaRuleId: rule.id,
        areaEffect: rule.effect,
      });
    }
    return {
      ...unknown,
      reason: CoverageReason.NOT_CONFIGURED,
      area: areaRef,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BOOKING WRITE GATE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The booking-time gate. THROWS on a deny (when enforced) and returns exactly
   * the coverage columns `bookings.create()` persists.
   *
   * Call it AFTER the two free in-memory checks and BEFORE `quotePrice` — do not
   * pay a pricing round trip for a booking you are about to reject. The caller
   * is responsible for Guard 1 (validating `dto.locationMode` against
   * `service.locationModes`) BEFORE calling: `mode` is a gate input, so an
   * unvalidated `{ locationMode: "REMOTE" }` in a request body would otherwise
   * bypass every gate, rule and default-deny in this module.
   */
  async assertServiceable(input: AssertServiceableInput): Promise<CoverageStamp> {
    const { service } = input;
    const enforced = input.enforced ?? BOOKING_COVERAGE_ENFORCED;
    const mode = input.mode ?? service.locationMode;

    const empty: CoverageStamp = {
      areaId: null,
      zipCodeId: null,
      postalCode: null,
      areaNameSnapshot: null,
      coverageSource: null,
      areaSlug: null,
    };

    // HYBRID counts as onsite: the on-site half still happens somewhere.
    if (mode === LocationMode.REMOTE) {
      return { ...empty, coverageSource: CoverageSource.NOT_APPLICABLE };
    }

    // A — ZIP is required for anything that happens at an address. There is
    // deliberately NO "allow when nothing was supplied" branch: permission must
    // never be derived from the absence of input.
    const rawZip = input.zip ?? null;
    if (rawZip === null || rawZip.trim() === "") {
      if (!enforced) {
        logger.warn("coverage.skipped", {
          serviceId: service.id,
          reason: CoverageErrorCode.ZIP_REQUIRED,
          enforced,
        });
        return empty;
      }
      throw coded(
        HttpStatus.BAD_REQUEST,
        CoverageErrorCode.ZIP_REQUIRED,
        "Enter the ZIP code where the service will take place.",
        undefined,
        "zip",
      );
    }

    // B — shape. 422, because this is a malformed value, not a rejected one.
    const zip5 = normalizeZip(rawZip);
    if (zip5 === null) {
      throw coded(
        HttpStatus.UNPROCESSABLE_ENTITY,
        CoverageErrorCode.ZIP_INVALID,
        "Enter a valid 5-digit ZIP code.",
        undefined,
        "zip",
      );
    }

    // C/D — resolve.
    const decision = await this.resolve(service.id, zip5, {
      mode,
      service,
      requestedAreaId: input.requestedAreaId,
    });

    // E — deny.
    if (!decision.allowed) {
      logger.warn("coverage.deny", {
        serviceId: service.id,
        zip: zip5,
        reason: decision.reason,
        matchedTier: decision.matchedTier,
        matchedRuleId: decision.matchedRuleId,
        enforced,
      });
      if (!enforced) return empty;
      throw denyError(zip5, service.name);
    }

    // F — the stamp. FK = aggregation authority, snapshot = display authority.
    return {
      areaId: decision.area?.id ?? null,
      zipCodeId: decision.zipCode?.id ?? null,
      postalCode: zip5,
      areaNameSnapshot: decision.area?.name ?? null,
      coverageSource: decision.source,
      areaSlug: decision.area?.slug ?? null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC AVAILABILITY CHECK
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The truth-teller behind `GET /coverage/check` and
   * `GET /services/:serviceId/coverage/check`. It calls the SAME `resolve()` the
   * booking flow calls, so what an admin sees is by construction what a customer
   * gets.
   *
   * 200 for not-serviceable: a valid answer to a valid question. Only an unknown
   * `serviceId`/`serviceSlug` is a 404.
   *
   * Disclosure, deliberately looser than the booking POST but structurally
   * bounded:
   *   - `area` is returned iff the ZIP is ACTIVE **and** its area is ACTIVE —
   *     i.e. it is inside the published footprint already visible on the
   *     marketing coverage band. An unknown ZIP and an inactive one are
   *     therefore indistinguishable (both `area: null`).
   *   - `matchedTier` / `matchedRuleId` never cross the wire for anonymous
   *     callers, and the internal `reason` is collapsed via PUBLIC_REASON.
   */
  async check(input: CheckCoverageInput): Promise<CoverageCheckResult> {
    const { zip, staff } = input;

    // No service named -> answer for every ACTIVE service at once, so the
    // booking entry point is one round trip.
    if (input.serviceId === undefined && input.serviceSlug === undefined) {
      return this.checkAllServices(zip, staff);
    }

    const service =
      input.serviceId !== undefined
        ? await coverageRepository.findServiceById(input.serviceId)
        : await coverageRepository.findServiceBySlug(input.serviceSlug as string);
    // Role-aware exactly like GET /services and GET /services/by-slug/:slug: a
    // non-staff caller must not be able to tell "no such service" from "a DRAFT
    // or INACTIVE service exists with this id". Without this the anonymous check
    // returns 200 with the unreleased service's id, slug and name in `service`,
    // which turns a rate-limited public endpoint into an enumeration oracle for
    // the unpublished catalogue. Same 404 sentence, so the two are identical.
    if (!service || (!staff && !PUBLIC_SERVICE_STATUSES.includes(service.status))) {
      throw coded(
        HttpStatus.NOT_FOUND,
        CoverageErrorCode.SERVICE_NOT_FOUND,
        "Service not found",
      );
    }

    // A service is only exempt from coverage when EVERY mode it offers is
    // REMOTE. `locationMode` alone is not enough: a service whose primary mode
    // is REMOTE but which also offers ONSITE still has an on-site half that
    // happens somewhere, and must be resolved against the ZIP.
    const offered =
      service.locationModes.length > 0
        ? service.locationModes
        : [service.locationMode];
    const remoteOnly = offered.every((m) => m === LocationMode.REMOTE);

    const decision = await this.resolve(service.id, zip, {
      mode: remoteOnly ? LocationMode.REMOTE : undefined,
      service,
    });

    const inFootprint =
      decision.zipCode?.status === GeoStatus.ACTIVE &&
      decision.area?.status === GeoStatus.ACTIVE;
    const area = staff ? decision.area : inFootprint ? decision.area : null;

    const result: CoverageCheckResult = {
      zip,
      serviceable: decision.allowed,
      reason: staff ? decision.reason : PUBLIC_REASON[decision.reason],
      area: area ? { id: area.id, name: area.name, slug: area.slug } : null,
      service: { id: service.id, slug: service.slug, name: service.name },
      message: this.checkMessage({
        reason: decision.reason,
        serviceable: decision.allowed,
        zip,
        areaName: area?.name ?? null,
        serviceName: service.name,
      }),
    };
    if (staff) {
      result.matchedTier = decision.matchedTier;
      result.matchedRuleId = decision.matchedRuleId;
    }
    return result;
  }

  /**
   * "What can you do at this ZIP?" — the no-service branch. The gates are
   * evaluated once against the ZIP and its market, then a single set-returning
   * statement lists every ACTIVE service whose COALESCE resolves to ALLOW.
   */
  private async checkAllServices(
    zip: string,
    staff: boolean,
  ): Promise<CoverageCheckResult> {
    const row = await coverageRepository.findZipWithArea(zip);

    const base: CoverageCheckResult = {
      zip,
      serviceable: false,
      reason: staff ? CoverageReason.UNKNOWN_ZIP : PublicCoverageReason.UNKNOWN_ZIP,
      area: null,
      service: null,
      services: [],
      message: `We don't recognise ZIP code ${zip}.`,
    };
    if (staff) {
      base.matchedTier = null;
      base.matchedRuleId = null;
    }

    if (!row) return base;

    // Gates I3/I4, same order, same precedence over any rule.
    if (row.status !== GeoStatus.ACTIVE || row.area.status !== GeoStatus.ACTIVE) {
      const gateReason =
        row.status !== GeoStatus.ACTIVE
          ? CoverageReason.ZIP_INACTIVE
          : CoverageReason.AREA_INACTIVE;
      logger.warn("coverage.deny", { zip, reason: gateReason, serviceId: null });
      return {
        ...base,
        reason: staff ? gateReason : PUBLIC_REASON[gateReason],
        // Staff see the geography; anonymous callers must not be able to tell an
        // inactive ZIP from an unknown one.
        area: staff
          ? { id: row.area.id, name: row.area.name, slug: row.area.slug }
          : null,
      };
    }

    const available = await coverageRepository.availableServicesAtZip(
      row.id,
      row.area.id,
    );
    const services: CoverageCheckServiceEntry[] = available.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      source: s.byZip ? CoverageSource.ZIP_RULE : CoverageSource.AREA_RULE,
    }));

    const serviceable = services.length > 0;
    const reason = serviceable
      ? CoverageReason.ALLOWED_BY_AREA
      : CoverageReason.NOT_CONFIGURED;
    return {
      ...base,
      serviceable,
      reason: staff ? reason : PUBLIC_REASON[reason],
      area: { id: row.area.id, name: row.area.name, slug: row.area.slug },
      services,
      message: this.checkMessage({
        reason,
        serviceable,
        zip,
        areaName: row.area.name,
        serviceName: null,
        serviceCount: services.length,
      }),
    };
  }

  /**
   * Server-authored, user-facing copy. Always server-side: the day the rule
   * engine gains a wrinkle, a client-composed sentence silently lies.
   */
  private checkMessage(args: {
    reason: CoverageReason;
    serviceable: boolean;
    zip: string;
    areaName: string | null;
    serviceName: string | null;
    serviceCount?: number;
  }): string {
    const { reason, serviceable, zip, areaName, serviceName } = args;
    const where = areaName ? `${zip} (${areaName})` : zip;
    const subject = serviceName ?? "We";

    if (reason === CoverageReason.NOT_LOCATION_BOUND) {
      return `${subject} is delivered remotely, so there's no coverage area to check.`;
    }
    if (reason === CoverageReason.SERVICE_NOT_BOOKABLE) {
      return `${subject} isn't taking bookings right now.`;
    }
    // Every "we can't place this ZIP" outcome shares one sentence: unknown,
    // invalid, inactive ZIP and inactive area must not be distinguishable. The
    // collapse map is the single definition of that set.
    if (PUBLIC_REASON[reason] === PublicCoverageReason.UNKNOWN_ZIP) {
      return `We don't recognise ZIP code ${zip}.`;
    }

    if (serviceable) {
      if (serviceName) return `Good news — we serve ${where} for ${serviceName}.`;
      const n = args.serviceCount ?? 0;
      return `Good news — we serve ${where}. ${n} ${plural(n, "service", "services")} available.`;
    }

    if (serviceName) {
      return (
        `${serviceName} isn't available in ${where} yet. ` +
        `Add your email and we'll let you know the moment it is.`
      );
    }
    return (
      `We don't have any services available in ${where} yet. ` +
      `Add your email and we'll let you know the moment we do.`
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN: READ THE WHOLE COVERAGE DOCUMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Everything the coverage editor needs to render every per-area card — mode,
   * effective counts, the ZIP exception list, `autoIncludeNewZips`, prose and
   * warnings — plus the `coverageVersion` to echo back on save. No extra round
   * trips, and NEVER exposed from a paginated list response: this is four
   * queries per SERVICE, which at `MAX_LIMIT = 100` list rows would be an N+1
   * that holds the whole connection pool.
   *
   * Decomposed rather than a `CROSS JOIN Service x ZipCode`:
   *   (a) service-INDEPENDENT ACTIVE-ZIP census, one row per area;
   *   (b) this service's area rules (one row per touched market);
   *   (c) this service's ZIP exceptions — SPARSE, tens of rows;
   *   (d) the area list, for display order and `uncoveredAreas`.
   * Then folded in JS.
   */
  async getDocument(serviceId: string): Promise<CoverageDocument> {
    const service = await coverageRepository.findServiceById(serviceId);
    if (!service) {
      throw coded(
        HttpStatus.NOT_FOUND,
        CoverageErrorCode.SERVICE_NOT_FOUND,
        "Service not found",
      );
    }

    const [zipCounts, areaRules, zipRules, areas] = await Promise.all([
      coverageRepository.activeZipCountsByArea(),
      coverageRepository.findAreaRules(serviceId),
      coverageRepository.findZipRules(serviceId),
      coverageRepository.findAreas(),
    ]);

    const zipCountByArea = new Map(zipCounts.map((r) => [r.areaId, r.zipCount]));
    const ruleByArea = new Map(areaRules.map((r) => [r.areaId, r]));

    const zipRulesByArea = new Map<string, ZipRuleRow[]>();
    for (const rule of zipRules) {
      const bucket = zipRulesByArea.get(rule.areaId);
      if (bucket) bucket.push(rule);
      else zipRulesByArea.set(rule.areaId, [rule]);
    }

    // An area is "touched" if it carries an area rule (the canonical form) OR —
    // defensively — orphan ZIP rules. Orphans are unreachable through this API
    // but must still be visible, or a canonical-form violation written by a
    // script becomes invisible and therefore unfixable.
    const touched = new Set<string>([
      ...ruleByArea.keys(),
      ...zipRulesByArea.keys(),
    ]);

    // Driven by `areas` (ARCHIVED included) so the cards come back in the
    // admin/public display order without a second sort.
    const entries: CoverageAreaEntry[] = [];
    for (const area of areas) {
      if (!touched.has(area.id)) continue;
      entries.push(
        this.buildAreaEntry({
          area,
          rule: ruleByArea.get(area.id) ?? null,
          activeZipCount: zipCountByArea.get(area.id) ?? 0,
          zipRules: zipRulesByArea.get(area.id) ?? [],
        }),
      );
    }
    // Both FKs are enforced by Postgres, so every touched area is in `areas`.
    // Log rather than silently render fewer cards than there are rules — a
    // missing card is a coverage rule an admin can neither see nor clear.
    if (entries.length !== touched.size) {
      logger.error("coverage.orphanedRuleArea", {
        serviceId,
        renderedAreas: entries.length,
        touchedAreas: touched.size,
      });
    }

    const uncoveredAreas = areas
      .filter((a) => a.status !== GeoStatus.ARCHIVED && !touched.has(a.id))
      .map((a) => ({ areaId: a.id, name: a.name, slug: a.slug }));

    const totalAreaCount = areas.filter(
      (a) => a.status !== GeoStatus.ARCHIVED,
    ).length;
    // `areaCount` and `zipCount` must be computed over the SAME set, or the
    // summary contradicts itself: an INACTIVE or ARCHIVED market is excluded from
    // "available in N areas" (gate I4 denies every ZIP beneath it) but its
    // effectiveZipCount would still be added to the ZIP total, so a paused metro
    // reads as "Available in 2 of 12 areas · 1,240 ZIP codes" — 1,206 of which
    // resolve to DENY. Count only areas that actually yield a bookable ZIP.
    const availableEntries = entries.filter((e) => e.available);
    const areaCount = availableEntries.length;
    const zipCount = availableEntries.reduce(
      (sum, e) => sum + e.effectiveZipCount,
      0,
    );

    return {
      service: {
        id: service.id,
        slug: service.slug,
        name: service.name,
        status: service.status,
      },
      version: service.coverageVersion,
      summary:
        areaCount === 0
          ? `Not available in any of ${totalAreaCount} ${plural(totalAreaCount, "area", "areas")}`
          : `Available in ${areaCount} of ${totalAreaCount} ${plural(totalAreaCount, "area", "areas")} · ${zipCount.toLocaleString("en-US")} ${plural(zipCount, "ZIP code", "ZIP codes")}`,
      totals: { areaCount, zipCount, totalAreaCount },
      areas: entries,
      uncoveredAreas,
    };
  }

  /**
   * Project one area's stored rows into the editor's card. `mode`,
   * `effectiveZipCount`, `summaryLine` and `warning` are ALL server-authored,
   * always, for every mode — the single most important constraint in this API.
   */
  private buildAreaEntry(input: {
    area: CoverageAreaRef;
    rule: { effect: CoverageEffect | null; autoIncludeNewZips: boolean } | null;
    activeZipCount: number;
    zipRules: ZipRuleRow[];
  }): CoverageAreaEntry {
    const { area, rule, activeZipCount, zipRules } = input;

    const denyRules = zipRules.filter((r) => r.effect === CoverageEffect.DENY);
    const allowRules = zipRules.filter((r) => r.effect === CoverageEffect.ALLOW);
    const activeCount = (rows: ZipRuleRow[]): number =>
      rows.filter((r) => r.zipCode.status === GeoStatus.ACTIVE).length;

    let mode: CoverageAreaEntry["mode"];
    if (!rule) mode = CoverageMode.NONE;
    else if (rule.effect === CoverageEffect.ALLOW) {
      mode = denyRules.length > 0 ? CoverageMode.ALL_EXCEPT : CoverageMode.ALL;
    } else if (rule.effect === CoverageEffect.DENY) mode = CoverageMode.ONLY;
    // effect NULL is a payload-only row: transparent to resolution, so it grants
    // nothing. A CHECK constraint forbids it today.
    else mode = CoverageMode.NONE;

    // Listed ZIPs are the FULL stored set for the mode's effect, INCLUDING rules
    // on INACTIVE/ARCHIVED ZipCodes, so re-saving the card round-trips instead
    // of silently dropping them. Counts, in contrast, only ever consider ACTIVE
    // ZIPs — an inactive ZIP is unbookable regardless of its rule.
    const listedRules =
      mode === CoverageMode.ALL_EXCEPT
        ? denyRules
        : mode === CoverageMode.ONLY
          ? allowRules
          : [];
    const listedZips: CoverageListedZip[] = listedRules.map((r) => r.zipCode);
    const listedCodes = listedZips.map((z) => z.zipCode);

    const areaWide =
      mode === CoverageMode.ALL || mode === CoverageMode.ALL_EXCEPT;
    const effectiveZipCount =
      mode === CoverageMode.ALL
        ? activeZipCount
        : mode === CoverageMode.ALL_EXCEPT
          ? Math.max(activeZipCount - activeCount(denyRules), 0)
          : mode === CoverageMode.ONLY
            ? activeCount(allowRules)
            : 0;

    // An ALLOW area with ZERO ZIPs is COVERED, not "0 of 0": Phase F resolves it
    // area-wide. Reporting it as unavailable is what makes every ZIP-less market
    // silently vanish from "areas we serve".
    const available =
      area.status === GeoStatus.ACTIVE &&
      (effectiveZipCount > 0 || (areaWide && activeZipCount === 0));

    let summaryLine: string;
    switch (mode) {
      case CoverageMode.ALL:
        summaryLine =
          activeZipCount === 0
            ? `All of ${area.name} — covered area-wide (no ZIP codes loaded yet)`
            : `All of ${area.name} (${activeZipCount} ${plural(activeZipCount, "ZIP code", "ZIP codes")})`;
        break;
      case CoverageMode.ALL_EXCEPT:
        summaryLine = `All of ${area.name} except ${previewZips(listedCodes)}`;
        break;
      case CoverageMode.ONLY:
        summaryLine =
          listedCodes.length > 0
            ? `Only ${previewZips(listedCodes)} in ${area.name}`
            : `No ZIP codes opted in for ${area.name}`;
        break;
      default:
        summaryLine = `Not available in ${area.name}`;
    }

    // Anomalies are SURFACED, never auto-corrected.
    const warnings: string[] = [];
    if (area.status === GeoStatus.INACTIVE) {
      warnings.push(
        `${area.name} is paused, so nothing resolves there regardless of coverage.`,
      );
    } else if (area.status === GeoStatus.ARCHIVED) {
      warnings.push(
        `${area.name} is archived. Its coverage rules are preserved but inert; restore the market to use them.`,
      );
    }
    if (mode === CoverageMode.ALL_EXCEPT && effectiveZipCount === 0) {
      warnings.push(
        `Every ZIP code in ${area.name} is excluded, so this service is not bookable there.`,
      );
    }
    if (mode === CoverageMode.ONLY && effectiveZipCount === 0) {
      warnings.push(
        `${area.name} is switched off and no active ZIP codes are opted in, so this service is not bookable there.`,
      );
    }
    if (!rule && zipRules.length > 0) {
      warnings.push(
        `Invalid: ${zipRules.length} ZIP-level ${plural(zipRules.length, "rule", "rules")} exist here with no area-level rule (${CoverageErrorCode.COVERAGE_AREA_RULE_REQUIRED}). Re-save this area to fix it.`,
      );
    }
    const redundant =
      mode === CoverageMode.ALL || mode === CoverageMode.ALL_EXCEPT
        ? allowRules
        : mode === CoverageMode.ONLY
          ? denyRules
          : [];
    if (redundant.length > 0) {
      warnings.push(
        `${redundant.length} redundant ZIP ${plural(redundant.length, "rule", "rules")} (${previewZips(redundant.map((r) => r.zipCode.zipCode))}) do not change the verdict and will be dropped on the next save.`,
      );
    }
    const inactiveListed = listedZips.filter(
      (z) => z.status !== GeoStatus.ACTIVE,
    );
    if (inactiveListed.length > 0) {
      warnings.push(
        `${inactiveListed.length} listed ZIP ${plural(inactiveListed.length, "code", "codes")} (${previewZips(inactiveListed.map((z) => z.zipCode))}) ${plural(inactiveListed.length, "is", "are")} not active and ${plural(inactiveListed.length, "is", "are")} excluded from the counts above.`,
      );
    }

    return {
      areaId: area.id,
      name: area.name,
      slug: area.slug,
      status: area.status,
      mode,
      areaZipCount: activeZipCount,
      effectiveZipCount,
      areaWide,
      available,
      autoIncludeNewZips: rule?.autoIncludeNewZips ?? true,
      listedZips,
      summaryLine,
      warning: warnings.length > 0 ? warnings.join(" ") : null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN: WRITE ONE AREA'S COVERAGE (PUT-REPLACE)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Whole-intent-per-area PUT with optimistic concurrency. NOT a PATCH delta:
   * per-ZIP endpoints let a client construct illegal states (a DENY row with no
   * parent area row) and force diff tracking; a whole-DOCUMENT PUT makes every
   * single toggle a payload proportional to TOTAL coverage. Per-area whole-intent
   * is what the editor actually does — one card, one Save, one atomic write.
   *
   * Everything below runs in ONE interactive transaction, including the reads:
   * the `FOR UPDATE` lock has to be held across the ZIP-ownership checks, or a
   * concurrent ZIP move invalidates them between check and write.
   *
   * Explicit `timeout`/`maxWait` because a 500-row `createMany` behind the
   * Supavisor pooler is exactly the shape that trips Prisma's 5s default into a
   * P2028 the error handler reports as a generic 400.
   */
  async putAreaCoverage(
    serviceId: string,
    areaId: string,
    dto: PutAreaCoverageDto,
  ): Promise<PutAreaCoverageResult> {
    return prisma.$transaction(
      async (tx) => {
        // 1. Lock the Service row and check the version the client echoed.
        const locked = await coverageRepository.lockServiceCoverageVersion(
          serviceId,
          tx,
        );
        if (!locked) {
          throw coded(
            HttpStatus.NOT_FOUND,
            CoverageErrorCode.SERVICE_NOT_FOUND,
            "Service not found",
          );
        }
        if (locked.coverageVersion !== dto.version) {
          throw coded(
            HttpStatus.CONFLICT,
            CoverageErrorCode.COVERAGE_VERSION_STALE,
            "This service's coverage was changed by someone else. Reload and try again.",
            { currentVersion: locked.coverageVersion },
            "version",
          );
        }

        // 2. The area must exist, and must not be archived unless we are
        //    REMOVING coverage (mode NONE) — clearing stale rules off an
        //    archived market has to stay possible.
        const area = await coverageRepository.findAreaById(areaId, tx);
        if (!area) {
          throw coded(
            HttpStatus.NOT_FOUND,
            CoverageErrorCode.COVERAGE_AREA_NOT_FOUND,
            "That area does not exist.",
          );
        }
        if (
          area.status === GeoStatus.ARCHIVED &&
          dto.mode !== CoverageMode.NONE
        ) {
          throw coded(
            HttpStatus.CONFLICT,
            CoverageErrorCode.COVERAGE_AREA_ARCHIVED,
            `Cannot grant coverage in the archived area "${area.name}".`,
          );
        }

        // 3. Every listed ZIP must exist AND belong to THIS area. A mismatch is
        //    the single most likely admin mistake and must be a hard error,
        //    never silently ignored — the composite FK would refuse it anyway,
        //    as an opaque Prisma error instead of an actionable sentence.
        const zips =
          dto.zipCodeIds.length > 0
            ? await coverageRepository.findZipCodesByIds(dto.zipCodeIds, tx)
            : [];
        if (zips.length !== dto.zipCodeIds.length) {
          const found = new Set(zips.map((z) => z.id));
          throw coded(
            HttpStatus.NOT_FOUND,
            CoverageErrorCode.COVERAGE_ZIP_NOT_FOUND,
            "One or more ZIP codes do not exist.",
            { zipCodeIds: dto.zipCodeIds.filter((id) => !found.has(id)) },
            "zipCodeIds",
          );
        }
        const mismatched = zips.filter((z) => z.areaId !== areaId);
        if (mismatched.length > 0) {
          const first = mismatched[0]!;
          throw coded(
            HttpStatus.CONFLICT,
            CoverageErrorCode.COVERAGE_ZIP_AREA_MISMATCH,
            `ZIP ${first.zipCode} belongs to "${first.area.name}", not "${area.name}".`,
            {
              zipCodeIds: mismatched.map((z) => z.id),
              zipCodes: mismatched.map((z) => z.zipCode),
            },
            "zipCodeIds",
          );
        }

        // 4. Compile the mode into the two effect columns.
        const plan = planAreaWrite(dto.mode);

        // CANONICAL FORM RULE — a ServiceZipCoverage row may not exist for a
        // (service, area) pair with no ServiceAreaCoverage row. Structurally
        // unreachable through the current mode map (every mode that writes ZIP
        // rules also upserts the area row), and asserted anyway so a future edit
        // to `planAreaWrite` fails loudly here instead of writing data the
        // resolver reports as NOT_CONFIGURED while the editor shows exceptions.
        if (plan.areaEffect === null && dto.zipCodeIds.length > 0) {
          throw coded(
            HttpStatus.BAD_REQUEST,
            CoverageErrorCode.COVERAGE_AREA_RULE_REQUIRED,
            "Set this area's availability before listing individual ZIP codes.",
            undefined,
            "mode",
          );
        }

        // 5. Replace. ZIP rules first, so a mode flip cannot momentarily leave a
        //    DENY zip row parented to a DENY area row.
        await coverageRepository.deleteZipRules(serviceId, areaId, tx);
        if (plan.areaEffect === null) {
          await coverageRepository.deleteAreaRule(serviceId, areaId, tx);
        } else {
          await coverageRepository.upsertAreaRule(
            {
              serviceId,
              areaId,
              effect: plan.areaEffect,
              autoIncludeNewZips: plan.autoIncludeNewZips,
            },
            tx,
          );
        }
        if (plan.zipEffect !== null && dto.zipCodeIds.length > 0) {
          const zipEffect = plan.zipEffect;
          await coverageRepository.createZipRules(
            dto.zipCodeIds.map((zipCodeId) => ({
              serviceId,
              zipCodeId,
              // areaId is half of the composite FK to ZipCode(id, areaId): it
              // pins this rule to the market it was authored under, so the ZIP
              // cannot later be moved out from under it.
              areaId,
              effect: zipEffect,
            })),
            tx,
          );
        }

        // 6. Bump the version in the SAME transaction. Without this, two
        //    coordinators editing different areas of one service silently revert
        //    each other — invisibly, because coverage is only observable by
        //    resolving a ZIP.
        const bumped = await coverageRepository.bumpCoverageVersion(
          serviceId,
          tx,
        );

        // 7. Recompute the card from the just-written truth (still inside the
        //    transaction, so it cannot read a racing write), so the client
        //    re-renders from truth and the next edit carries a fresh version.
        const [activeZipCount, freshRule, freshZipRules] = await Promise.all([
          coverageRepository.countActiveZipsInArea(areaId, tx),
          coverageRepository.findAreaRule(serviceId, areaId, tx),
          coverageRepository.findZipRulesForArea(serviceId, areaId, tx),
        ]);

        logger.info("coverage.areaUpdated", {
          serviceId,
          areaId,
          mode: dto.mode,
          zipCount: dto.zipCodeIds.length,
          autoIncludeNewZips: plan.autoIncludeNewZips,
          version: bumped.coverageVersion,
        });

        return {
          area: this.buildAreaEntry({
            area,
            rule: freshRule,
            activeZipCount,
            zipRules: freshZipRules,
          }),
          version: bumped.coverageVersion,
        };
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
  }
}

export const coverageService = new CoverageService();

/** Re-exported for the bookings module's stamp typing convenience. */
export type { CoverageServiceIdentity, CoverageStamp };
