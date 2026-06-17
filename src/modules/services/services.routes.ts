import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { servicesController } from "./services.controller";
import {
  createServiceSchema,
  updateServiceSchema,
  listServicesSchema,
  serviceIdSchema,
} from "./services.validation";
import { UserRole } from "../../enums";

export const servicesRouter = Router();

// Public catalog
servicesRouter.get(
  "/",
  validate({ query: listServicesSchema }),
  asyncHandler(servicesController.list),
);
servicesRouter.get(
  "/:id",
  validate({ params: serviceIdSchema }),
  asyncHandler(servicesController.getById),
);

// Management (staff)
servicesRouter.post(
  "/",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.COORDINATOR),
  validate({ body: createServiceSchema }),
  asyncHandler(servicesController.create),
);
servicesRouter.patch(
  "/:id",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.COORDINATOR),
  validate({ params: serviceIdSchema, body: updateServiceSchema }),
  asyncHandler(servicesController.update),
);
servicesRouter.delete(
  "/:id",
  authenticate,
  authorize(UserRole.ADMIN),
  validate({ params: serviceIdSchema }),
  asyncHandler(servicesController.remove),
);
