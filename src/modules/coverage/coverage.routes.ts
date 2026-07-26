import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { UserRole } from "../../enums";
import { coverageController } from "./coverage.controller";
import {
  coverageCheckQuerySchema,
  putAreaCoverageSchema,
  serviceCoverageAreaParamsSchema,
  serviceCoverageCheckQuerySchema,
  serviceCoverageParamsSchema,
} from "./coverage.validation";

/**
 * Limiter for the public coverage checks.
 *
 * This belongs in `src/middleware/rate-limit.ts` beside `verifyRateLimiter`; it
 * lives here because this module does not own that file (see the module report).
 *
 * Behind the Next BFF all traffic arrives from one origin IP — the global-bucket
 * problem already noted in `rate-limit.ts` — so an IP key would throttle every
 * customer together. Key on the ZIP instead, but ONLY because
 * `validate({ query })` is registered BEFORE this middleware and has already
 * transformed the value to exactly five digits. Keying on UNVALIDATED caller
 * input with the default MemoryStore would be both a one-line bypass (increment
 * the ZIP) and a memory-exhaustion vector: one store entry per distinct key. The
 * five-digit bound caps the key space at 100,000, and the 60s window keeps the
 * store draining.
 *
 * If middleware order here is ever changed so the limiter runs first, the memory
 * bound is GONE. Do not reorder.
 */
export const coverageCheckRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `coverage:${(req.query as { zip?: string }).zip ?? "unknown"}`,
  message: {
    success: false,
    message: "Too many coverage checks, please try again shortly.",
  },
});

const staffOnly = [
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
] as const;

// ────────────────────────────────────────────────────────────────────────────
// /api/v1/coverage
// ────────────────────────────────────────────────────────────────────────────

export const coverageRouter = Router();

/**
 * GET /api/v1/coverage/check?zip=&serviceId=|serviceSlug=
 *
 * ANONYMOUS. The booking flow asks "do you serve me?" before signup, so
 * requiring auth kills conversion; `optionalAuthenticate` is only there so staff
 * get the precise reason. GET, not POST — it is a read. 200 even when not
 * serviceable: a valid answer to a valid question, and a 404 would make the
 * client's error boundaries treat it as a failure and pollute monitoring. Omit
 * the service and the response carries `services[]`.
 */
coverageRouter.get(
  "/check",
  optionalAuthenticate,
  // validate BEFORE the limiter — see coverageCheckRateLimiter.
  validate({ query: coverageCheckQuerySchema }),
  coverageCheckRateLimiter,
  asyncHandler(coverageController.check),
);

/**
 * Service-scoped routes, mounted FLAT here as well as on the nested router
 * below, so the module is fully functional with a single line in
 * `src/routes/index.ts` and does not require an edit to `services.routes.ts`.
 * Both mounts share one controller, one validation set and one service — there
 * is no second implementation to drift.
 *
 * `/check` is registered before the bare `/:serviceId` paths, matching the route
 * -order discipline documented twice in `service-config.routes.ts`.
 */
coverageRouter.get(
  "/services/:serviceId/check",
  optionalAuthenticate,
  validate({
    params: serviceCoverageParamsSchema,
    query: serviceCoverageCheckQuerySchema,
  }),
  coverageCheckRateLimiter,
  asyncHandler(coverageController.checkForService),
);

coverageRouter.get(
  "/services/:serviceId",
  ...staffOnly,
  validate({ params: serviceCoverageParamsSchema }),
  asyncHandler(coverageController.getDocument),
);

coverageRouter.put(
  "/services/:serviceId/areas/:areaId",
  ...staffOnly,
  validate({
    params: serviceCoverageAreaParamsSchema,
    body: putAreaCoverageSchema,
  }),
  asyncHandler(coverageController.putArea),
);

// ────────────────────────────────────────────────────────────────────────────
// /api/v1/services/:serviceId/coverage  (nested sub-router)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The canonical service-scoped mount. `mergeParams` so the parent `:serviceId`
 * is visible; every params schema lists EVERY merged param because `validate`
 * replaces `req.params` wholesale.
 *
 * Mount it from `services.routes.ts` (a file this module does not own) with:
 *   servicesRouter.use("/:serviceId/coverage", serviceCoverageRouter);
 *
 * There are deliberately NO DELETE routes anywhere in this feature: the repo's
 * only DELETEs are HARD deletes, and overloading DELETE to mean "remove
 * coverage" in one module and "destroy" in another is how data gets lost.
 * `PUT /areas/:areaId` with `mode: "NONE"` removes an area's coverage.
 */
export const serviceCoverageRouter = Router({ mergeParams: true });

serviceCoverageRouter.get(
  "/check",
  optionalAuthenticate,
  validate({
    params: serviceCoverageParamsSchema,
    query: serviceCoverageCheckQuerySchema,
  }),
  coverageCheckRateLimiter,
  asyncHandler(coverageController.checkForService),
);

serviceCoverageRouter.get(
  "/",
  ...staffOnly,
  validate({ params: serviceCoverageParamsSchema }),
  asyncHandler(coverageController.getDocument),
);

serviceCoverageRouter.put(
  "/areas/:areaId",
  ...staffOnly,
  validate({
    params: serviceCoverageAreaParamsSchema,
    body: putAreaCoverageSchema,
  }),
  asyncHandler(coverageController.putArea),
);
