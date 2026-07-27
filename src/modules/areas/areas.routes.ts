import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { UserRole } from "../../enums";
import { areasController } from "./areas.controller";
import {
  createAreaSchema,
  updateAreaSchema,
  updateAreaStatusSchema,
  listAreasSchema,
  areaDetailQuerySchema,
  areaZipLookupSchema,
  listAreaZipCodesSchema,
  areaIdSchema,
  areaSlugParamSchema,
} from "./areas.validation";

export const areasRouter = Router();

const staffOnly = [
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
] as const;

// Destructive lifecycle (retire / un-retire a market) is admin-only, matching the
// service-config router's precedent.
const adminOnly = [authenticate, authorize(UserRole.SYSTEM_ADMIN)] as const;

// PUBLIC list — role-aware, exactly like GET /services: anonymous callers (the
// marketing "areas we serve" band) get ACTIVE areas only and a caller-supplied
// `status` is ignored for them; staff get ACTIVE + INACTIVE by default and may
// filter by any status, including ARCHIVED.
areasRouter.get(
  "/",
  optionalAuthenticate,
  validate({ query: listAreasSchema }),
  asyncHandler(areasController.list),
);

// PUBLIC ZIP -> market lookup. MUST stay above "/:id": Express matches in
// registration order, so registered after it, "lookup" would be parsed as an id
// and 422 on the uuid check.
areasRouter.get(
  "/lookup",
  optionalAuthenticate,
  validate({ query: areaZipLookupSchema }),
  asyncHandler(areasController.lookup),
);

// PUBLIC lookup by natural key. Registered before "/:id" — a 2-segment path could
// not collide, but the ordering is the documented house rule for this feature.
areasRouter.get(
  "/by-slug/:slug",
  optionalAuthenticate,
  validate({ params: areaSlugParamSchema, query: areaDetailQuerySchema }),
  asyncHandler(areasController.getBySlug),
);

areasRouter.get(
  "/:id",
  ...staffOnly,
  validate({ params: areaIdSchema, query: areaDetailQuerySchema }),
  asyncHandler(areasController.getById),
);

// The coverage picker's ZIP list. Deliberately NOT paginated — it hard-caps at
// 2000 rows and reports `truncated` instead.
areasRouter.get(
  "/:id/zip-codes",
  ...staffOnly,
  validate({ params: areaIdSchema, query: listAreaZipCodesSchema }),
  asyncHandler(areasController.listZipCodes),
);

areasRouter.post(
  "/",
  ...staffOnly,
  validate({ body: createAreaSchema }),
  asyncHandler(areasController.create),
);

areasRouter.patch(
  "/:id",
  ...staffOnly,
  validate({ params: areaIdSchema, body: updateAreaSchema }),
  asyncHandler(areasController.update),
);

// Lifecycle. There is deliberately NO DELETE route: an Area is referenced by
// ZipCode and Booking with Restrict FKs, so retirement is status = ARCHIVED.
areasRouter.post(
  "/:id/status",
  ...staffOnly,
  validate({ params: areaIdSchema, body: updateAreaStatusSchema }),
  asyncHandler(areasController.setStatus),
);

areasRouter.post(
  "/:id/activate",
  ...staffOnly,
  validate({ params: areaIdSchema }),
  asyncHandler(areasController.activate),
);

areasRouter.post(
  "/:id/deactivate",
  ...staffOnly,
  validate({ params: areaIdSchema }),
  asyncHandler(areasController.deactivate),
);

areasRouter.post(
  "/:id/archive",
  ...adminOnly,
  validate({ params: areaIdSchema }),
  asyncHandler(areasController.archive),
);

areasRouter.post(
  "/:id/restore",
  ...adminOnly,
  validate({ params: areaIdSchema }),
  asyncHandler(areasController.restore),
);
