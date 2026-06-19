import { Router } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { authenticate, optionalAuthenticate } from "../../../middleware/authenticate";
import { authorize } from "../../../middleware/authorize";
import { validate } from "../../../middleware/validate";
import { serviceConfigController } from "./service-config.controller";
import {
  createConfigGroupSchema,
  updateConfigGroupSchema,
  createConfigOptionSchema,
  updateConfigOptionSchema,
  serviceParamsSchema,
  groupParamsSchema,
  optionParamsSchema,
} from "./service-config.validation";
import { UserRole } from "../../../enums";

// mergeParams so the parent `:serviceId` (mounted at /services/:serviceId/config) is visible.
export const serviceConfigRouter = Router({ mergeParams: true });

// ── Public reads (role-aware: anon limited to publicly-visible services) ──────
serviceConfigRouter.get(
  "/",
  optionalAuthenticate,
  validate({ params: serviceParamsSchema }),
  asyncHandler(serviceConfigController.getServiceConfig),
);
serviceConfigRouter.get(
  "/groups",
  optionalAuthenticate,
  validate({ params: serviceParamsSchema }),
  asyncHandler(serviceConfigController.listGroups),
);

// ── Group management (staff: admin + coordinator) ─────────────────────────────
serviceConfigRouter.post(
  "/groups",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: serviceParamsSchema, body: createConfigGroupSchema }),
  asyncHandler(serviceConfigController.createGroup),
);
serviceConfigRouter.patch(
  "/groups/:groupId",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: groupParamsSchema, body: updateConfigGroupSchema }),
  asyncHandler(serviceConfigController.updateGroup),
);
// Destructive: admin-only, matching services DELETE convention.
serviceConfigRouter.delete(
  "/groups/:groupId",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({ params: groupParamsSchema }),
  asyncHandler(serviceConfigController.deleteGroup),
);

// ── Option management ─────────────────────────────────────────────────────────
serviceConfigRouter.post(
  "/groups/:groupId/options",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: groupParamsSchema, body: createConfigOptionSchema }),
  asyncHandler(serviceConfigController.createOption),
);
serviceConfigRouter.patch(
  "/groups/:groupId/options/:optionId",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: optionParamsSchema, body: updateConfigOptionSchema }),
  asyncHandler(serviceConfigController.updateOption),
);
serviceConfigRouter.delete(
  "/groups/:groupId/options/:optionId",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({ params: optionParamsSchema }),
  asyncHandler(serviceConfigController.deleteOption),
);
