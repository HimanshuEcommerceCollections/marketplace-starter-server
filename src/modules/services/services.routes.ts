import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { servicesController } from "./services.controller";
import { serviceConfigRouter } from "./config/service-config.routes";
import {
  createServiceSchema,
  updateServiceSchema,
  listServicesSchema,
  serviceIdSchema,
} from "./services.validation";
import { UserRole } from "../../enums";

export const servicesRouter = Router();

// Nested service-configuration sub-router (groups + options) — owns
// /services/:serviceId/config/*. Mounted first so its 2-segment paths resolve
// before the catch-all "/:id" routes below.
servicesRouter.use("/:serviceId/config", serviceConfigRouter);

// Public catalog (optionalAuthenticate: staff bypass the ACTIVE-category filter)
servicesRouter.get(
  "/",
  optionalAuthenticate,
  validate({ query: listServicesSchema }),
  asyncHandler(servicesController.list),
);
servicesRouter.get(
  "/:id",
  optionalAuthenticate,
  validate({ params: serviceIdSchema }),
  asyncHandler(servicesController.getById),
);

// Management (staff)
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
servicesRouter.delete(
  "/:id",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({ params: serviceIdSchema }),
  asyncHandler(servicesController.remove),
);
