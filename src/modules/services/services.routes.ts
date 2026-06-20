import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { servicesController } from "./services.controller";
import { serviceConfigRouter } from "./config/service-config.routes";
import { serviceAssetsRouter } from "./assets/service-assets.routes";
import {
  createServiceSchema,
  updateServiceSchema,
  updateServiceStatusSchema,
  listServicesSchema,
  serviceIdSchema,
} from "./services.validation";
import { UserRole } from "../../enums";

export const servicesRouter = Router();

// Asset management (icon + cover images), scoped by slug. Mounted near the top
// so the asset surface is easy to find; its 2-segment paths are distinct from
// the "/:id" routes below.
servicesRouter.use("/:slug/assets", serviceAssetsRouter);

// Nested service-configuration sub-router (groups + options) — owns
// /services/:serviceId/config/*.
servicesRouter.use("/:serviceId/config", serviceConfigRouter);

// Public list — role-aware: anonymous callers see publicly-visible services
// (ACTIVE + COMING_SOON) only; staff see all and may filter by any status.
servicesRouter.get(
  "/",
  optionalAuthenticate,
  validate({ query: listServicesSchema }),
  asyncHandler(servicesController.list),
);

// Management (staff) — serialized details.
servicesRouter.get(
  "/:id",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: serviceIdSchema }),
  asyncHandler(servicesController.getById),
);

servicesRouter.post(
  "/",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ body: createServiceSchema }),
  asyncHandler(servicesController.create),
);

servicesRouter.patch(
  "/:id",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: serviceIdSchema, body: updateServiceSchema }),
  asyncHandler(servicesController.update),
);

// Lifecycle transitions.
// Generic transition to any valid target status; guarded by the service-layer
// transition map.
servicesRouter.post(
  "/:id/status",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: serviceIdSchema, body: updateServiceStatusSchema }),
  asyncHandler(servicesController.setStatus),
);

servicesRouter.post(
  "/:id/publish",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: serviceIdSchema }),
  asyncHandler(servicesController.publish),
);

servicesRouter.post(
  "/:id/deactivate",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: serviceIdSchema }),
  asyncHandler(servicesController.deactivate),
);
