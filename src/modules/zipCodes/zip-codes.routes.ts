import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { UserRole } from "../../enums";
import { zipCodesController } from "./zip-codes.controller";
import {
  bulkImportZipCodesSchema,
  bulkMoveZipCodesSchema,
  bulkZipCodeStatusSchema,
  createZipCodeSchema,
  listZipCodesSchema,
  updateZipCodeSchema,
  updateZipCodeStatusSchema,
  zipCodeByCodeParamSchema,
  zipCodeIdParamSchema,
} from "./zip-codes.validation";

export const zipCodesRouter = Router();

/** Staff (admin + coordinator) — the day-to-day geography desk. */
const staffOnly = [
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
] as const;

/**
 * Admin only. Matches the config router's "Destructive: admin-only" precedent
 * (service-config.routes.ts) and §5.2, which marks archive/restore `admin`.
 */
const adminOnly = [authenticate, authorize(UserRole.SYSTEM_ADMIN)] as const;

// Public list — role-aware: anonymous callers see ACTIVE ZIPs in ACTIVE markets;
// staff may filter by any status and opt ARCHIVED rows in. Powers the marketing
// "areas we serve" band, the coverage picker and the admin table from one
// serializer, so there is exactly one visibility rule to get right.
zipCodesRouter.get(
  "/",
  optionalAuthenticate,
  validate({ query: listZipCodesSchema }),
  asyncHandler(zipCodesController.list),
);

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL ROUTE ORDER: every literal path below is registered BEFORE "/:id",
// or "bulk" parses as an id and every bulk call 422s with "Invalid uuid".
// Same gotcha is documented twice in services/config/service-config.routes.ts.
// ─────────────────────────────────────────────────────────────────────────────

zipCodesRouter.post(
  "/bulk/import",
  ...staffOnly,
  validate({ body: bulkImportZipCodesSchema }),
  asyncHandler(zipCodesController.bulkImport),
);

zipCodesRouter.post(
  "/bulk/status",
  ...staffOnly,
  validate({ body: bulkZipCodeStatusSchema }),
  asyncHandler(zipCodesController.bulkSetStatus),
);

zipCodesRouter.post(
  "/bulk/move",
  ...staffOnly,
  validate({ body: bulkMoveZipCodesSchema }),
  asyncHandler(zipCodesController.bulkMove),
);

// "who owns 75001?" — the cross-area lookup a flat router exists to serve.
zipCodesRouter.get(
  "/by-code/:zipCode",
  ...staffOnly,
  validate({ params: zipCodeByCodeParamSchema }),
  asyncHandler(zipCodesController.getByCode),
);

zipCodesRouter.get(
  "/:id",
  ...staffOnly,
  validate({ params: zipCodeIdParamSchema }),
  asyncHandler(zipCodesController.getById),
);

zipCodesRouter.post(
  "/",
  ...staffOnly,
  validate({ body: createZipCodeSchema }),
  asyncHandler(zipCodesController.create),
);

// PATCH may include areaId, which is a MOVE and can be refused by the composite
// FK with 409 ZIP_MOVE_BLOCKED_BY_COVERAGE.
zipCodesRouter.patch(
  "/:id",
  ...staffOnly,
  validate({ params: zipCodeIdParamSchema, body: updateZipCodeSchema }),
  asyncHandler(zipCodesController.update),
);

// ── Lifecycle. POST sub-resources, never DELETE: the repo's only DELETEs are
//    hard deletes, and overloading DELETE to mean archive is how data gets lost.
//
//    /status, /activate and /deactivate are the ACTIVE <-> INACTIVE toggle and
//    accept ACTIVE|INACTIVE only. ARCHIVED is unreachable from any staff route:
//    /archive and /restore below are the sole doors in and out of it, and they are
//    admin-only. Widening updateZipCodeStatusSchema back to the full GeoStatus
//    hands every coordinator both of those admin capabilities.
zipCodesRouter.post(
  "/:id/status",
  ...staffOnly,
  validate({ params: zipCodeIdParamSchema, body: updateZipCodeStatusSchema }),
  asyncHandler(zipCodesController.setStatus),
);

zipCodesRouter.post(
  "/:id/activate",
  ...staffOnly,
  validate({ params: zipCodeIdParamSchema }),
  asyncHandler(zipCodesController.activate),
);

zipCodesRouter.post(
  "/:id/deactivate",
  ...staffOnly,
  validate({ params: zipCodeIdParamSchema }),
  asyncHandler(zipCodesController.deactivate),
);

zipCodesRouter.post(
  "/:id/archive",
  ...adminOnly,
  validate({ params: zipCodeIdParamSchema }),
  asyncHandler(zipCodesController.archive),
);

zipCodesRouter.post(
  "/:id/restore",
  ...adminOnly,
  validate({ params: zipCodeIdParamSchema }),
  asyncHandler(zipCodesController.restore),
);
