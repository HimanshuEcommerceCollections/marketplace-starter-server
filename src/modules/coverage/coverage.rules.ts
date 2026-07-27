import { CoverageEffect, CoverageSource, GeoStatus } from "../../enums";
import { CoverageReason, CoverageTier } from "./coverage.types";
import type { CoverageResolutionRow, CoverageRuleVerdict } from "./coverage.types";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE PRECEDENCE RULE. Pure, I/O-free, total. Its own file (no repository, no
 * prisma client, no logger) because it is the single source of truth for "is
 * this ZIP covered by this service" — every other surface (booking write, public
 * check, admin ZIP checker, editor preview) funnels through it, which is what
 * stops two screens from disagreeing about S1 and S3. Keeping it importable
 * without dragging in a DB client is also what will keep it testable the day a
 * test runner lands.
 *
 *   PRECEDENCE = [ZIP, AREA]   // most specific first; append CITY/COUNTY later
 *   DEFAULT    = DENY
 *
 * GATES run BEFORE any rule is read and sit deliberately OUTSIDE the precedence
 * walk: an ALLOW rule must never be able to resurrect a switched-off entity.
 * That ordering is the single invariant of the whole feature, so it is numbered
 * code, not a comment.
 *
 *   I2  no ZipCode row                  -> deny UNKNOWN_ZIP
 *   I3  ZipCode.status  != ACTIVE       -> deny ZIP_INACTIVE
 *   I4  Area.status     != ACTIVE       -> deny AREA_INACTIVE  (metro kill switch)
 *   R1  effect := COALESCE(zipEffect, areaEffect, DENY)
 *   R2  tier   := zipEffect ? ZIP : areaEffect ? AREA : null
 *   R3  ALLOW  -> allow, source = ZIP_RULE | AREA_RULE
 *   R4  DENY   -> deny, DENIED_BY_ZIP | DENIED_BY_AREA | NOT_CONFIGURED
 *
 * G1 (mode REMOTE) and G2 (service not ACTIVE) are NOT here: both are decided
 * before geography is read and therefore before there is a row to hand over.
 * They live in `coverageService.resolve()`.
 *
 * `NOT_CONFIGURED` (no rule at ANY tier) resolves to denied but is a DISTINCT
 * reason from an explicit DENY: the customer experience differs (waitlist vs
 * "we don't serve that"), and it is the signal the admin "unconfigured
 * coverage" report keys on.
 *
 * ── PROOF against S1/S2/S3 (Area Dallas ACTIVE; 75001-3 ACTIVE; 75004 inserted
 *    a month later). `effect` = COALESCE(zipEffect, areaEffect, DENY). ────────
 *
 * S1 — House Cleaning "available in Dallas, available 75001, NOT 75002"
 *      rows: SAC(HC, Dallas, ALLOW, autoIncludeNewZips=false)
 *          + SZC(HC, 75002, DENY)   [+ the redundant SZC(HC, 75001, ALLOW)]
 *   ZIP    zipEffect  areaEffect  effect  tier  verdict          intent
 *   75001  ALLOW      ALLOW       ALLOW   ZIP   allow            "available 75001"   OK
 *   75001  —          ALLOW       ALLOW   AREA  allow            identical answer -> the
 *                                                               redundant row is a
 *                                                               provable no-op          OK
 *   75002  DENY       ALLOW       DENY    ZIP   deny  DENIED_BY_ZIP  "NOT 75002"      OK
 *   75003  —          ALLOW       ALLOW   AREA  allow            "available in Dallas"
 *                                                               = the default holds  OK
 *   75004  DENY*      ALLOW       DENY    ZIP   deny             *written by the
 *          (hook)                                                autoIncludeNewZips
 *                                                                hook; an area with an
 *                                                                exclusion is not
 *                                                                uniformly serviceable OK
 *
 * S2 — Lawn Care "available Dallas and ALL its zips"
 *      rows: SAC(LC, Dallas, ALLOW, autoIncludeNewZips=true). ZERO zip rows.
 *   75001  —  ALLOW  ALLOW  AREA  allow  OK
 *   75002  —  ALLOW  ALLOW  AREA  allow  OK
 *   75003  —  ALLOW  ALLOW  AREA  allow  OK
 *   75004  —  ALLOW  ALLOW  AREA  allow  OK  <- automatic, ZERO writes. One row
 *                                              expresses "all of Dallas, forever,
 *                                              including ZIPs that don't exist yet".
 *
 * S3 — Window Cleaning "NOT available Dallas-wide, available in 75003 ONLY"
 *      rows: SAC(WC, Dallas, DENY) + SZC(WC, 75003, ALLOW). The area row is
 *      MANDATORY (canonical-form rule, enforced in putAreaCoverage).
 *   75001  —      DENY  DENY   AREA  deny  DENIED_BY_AREA  OK
 *   75002  —      DENY  DENY   AREA  deny  DENIED_BY_AREA  OK
 *   75003  ALLOW  DENY  ALLOW  ZIP   allow ALLOWED_BY_ZIP  OK
 *   75004  —      DENY  DENY   AREA  deny  DENIED_BY_AREA  OK  <- new ZIPs do not
 *                                                               leak into an opt-in area
 *
 * Degenerate combinations, all defined:
 *   area ALLOW + zip DENY          -> zip wins, deny        (that IS S1)
 *   area DENY  + zip ALLOW         -> zip wins, allow       (that IS S3)
 *   zip rule with no area rule     -> rejected at WRITE time, never resolved
 *   no rule at any tier            -> deny NOT_CONFIGURED (not the same as DENY)
 *   zip INACTIVE  + zip ALLOW      -> deny ZIP_INACTIVE  (I3 beats the rule)
 *   area !ACTIVE  + zip ALLOW      -> deny AREA_INACTIVE (I4 beats the rule)
 *   two rules on one scope         -> unstorable (@@unique), not resolved
 * ════════════════════════════════════════════════════════════════════════════
 */
export function decideCoverage(
  row: CoverageResolutionRow | null,
): CoverageRuleVerdict {
  // I2 — the ZIP is not in the system at all.
  if (!row) {
    return {
      allowed: false,
      source: null,
      reason: CoverageReason.UNKNOWN_ZIP,
      matchedTier: null,
      matchedRuleId: null,
    };
  }

  // I3/I4 — GATES. Before any rule. Fail CLOSED on any unexpected status value.
  if (row.zipStatus !== GeoStatus.ACTIVE) {
    return {
      allowed: false,
      source: null,
      reason: CoverageReason.ZIP_INACTIVE,
      matchedTier: null,
      matchedRuleId: null,
    };
  }
  if (row.areaStatus !== GeoStatus.ACTIVE) {
    return {
      allowed: false,
      source: null,
      reason: CoverageReason.AREA_INACTIVE,
      matchedTier: null,
      matchedRuleId: null,
    };
  }

  // R2 — which tier owns the decision. First NON-NULL effect terminates.
  // A NULL effect is a payload-only row and is TRANSPARENT here, exactly as it
  // is to the COALESCE: it neither decides nor blocks the tier below it.
  const matchedTier =
    row.zipEffect !== null
      ? CoverageTier.ZIP
      : row.areaEffect !== null
        ? CoverageTier.AREA
        : null;
  const matchedRuleId =
    matchedTier === CoverageTier.ZIP
      ? row.zipRuleId
      : matchedTier === CoverageTier.AREA
        ? row.areaRuleId
        : null;

  // R1 — COALESCE(zipEffect, areaEffect, 'DENY').
  const effect = row.zipEffect ?? row.areaEffect ?? CoverageEffect.DENY;

  // R3 — allow. `matchedTier` is necessarily non-null here: a null tier means
  // both effects were null, which lands on the DEFAULT of DENY.
  if (effect === CoverageEffect.ALLOW) {
    const byZip = matchedTier === CoverageTier.ZIP;
    return {
      allowed: true,
      source: byZip ? CoverageSource.ZIP_RULE : CoverageSource.AREA_RULE,
      reason: byZip
        ? CoverageReason.ALLOWED_BY_ZIP
        : CoverageReason.ALLOWED_BY_AREA,
      matchedTier,
      matchedRuleId,
    };
  }

  // R4 — deny, with the three distinguishable reasons.
  return {
    allowed: false,
    source: null,
    reason:
      matchedTier === CoverageTier.ZIP
        ? CoverageReason.DENIED_BY_ZIP
        : matchedTier === CoverageTier.AREA
          ? CoverageReason.DENIED_BY_AREA
          : CoverageReason.NOT_CONFIGURED,
    matchedTier,
    matchedRuleId,
  };
}
