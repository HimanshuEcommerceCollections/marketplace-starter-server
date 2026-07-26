// Barrel for the coverage module. Top-level mounts get a barrel; nested
// sub-routers are imported by path (matching services/config/).
export {
  coverageRouter,
  serviceCoverageRouter,
  coverageCheckRateLimiter,
} from "./coverage.routes";

// `coverageService` is THE resolver. bookings.service.ts imports
// `assertServiceable()` from here as its write gate; the status-transition
// lapse check (§7.6a) imports `resolve()`.
export {
  coverageService,
  CoverageService,
  denyError,
  COVERAGE_ZIP_FALLBACK,
  BOOKING_COVERAGE_ENFORCED,
} from "./coverage.service";

// The pure precedence rule — no I/O, no Prisma client, no logger. The single
// source of precedence truth; duplicating it into another module is exactly how
// S1 and S3 start disagreeing between two screens.
export { decideCoverage } from "./coverage.rules";

// Shared ZIP normalizer. Temporary home — see the note on the function itself;
// it moves to src/utils/zip.ts, which is the importer's and the zip-codes
// module's source of truth too.
export { normalizeZip, zipSchema, MAX_LISTED_ZIPS } from "./coverage.validation";

export {
  CoverageMode,
  CoverageReason,
  CoverageTier,
  PublicCoverageReason,
  CoverageErrorCode,
} from "./coverage.types";

export type {
  AssertServiceableInput,
  CheckCoverageInput,
  CoverageAreaEntry,
  CoverageCheckResult,
  CoverageDecision,
  CoverageDocument,
  CoverageListedZip,
  CoverageResolutionRow,
  CoverageRuleVerdict,
  CoverageServiceIdentity,
  CoverageStamp,
  PutAreaCoverageDto,
  PutAreaCoverageResult,
  ResolveOptions,
} from "./coverage.types";
