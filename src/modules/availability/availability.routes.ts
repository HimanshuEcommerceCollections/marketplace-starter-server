import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { availabilityController } from "./availability.controller";
import {
  createSlotSchema,
  listSlotsSchema,
  slotIdSchema,
} from "./availability.validation";
import { UserRole } from "../../enums";

export const availabilityRouter = Router();

// Public: browse open slots
availabilityRouter.get(
  "/",
  validate({ query: listSlotsSchema }),
  asyncHandler(availabilityController.list),
);

// Providers/coordinators/admins manage slots
availabilityRouter.post(
  "/",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR, UserRole.SYSTEM_PROVIDER),
  validate({ body: createSlotSchema }),
  asyncHandler(availabilityController.create),
);
availabilityRouter.delete(
  "/:id",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR, UserRole.SYSTEM_PROVIDER),
  validate({ params: slotIdSchema }),
  asyncHandler(availabilityController.remove),
);
