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
  reorderGroupsSchema,
  reorderOptionsSchema,
  priceQuerySchema,
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

// Price quote (public, role-aware): base + selected option modifiers.
serviceConfigRouter.post(
  "/price",
  optionalAuthenticate,
  validate({ params: serviceParamsSchema, body: priceQuerySchema }),
  asyncHandler(serviceConfigController.quotePrice),
);

// ── Group management (staff: admin + coordinator) ─────────────────────────────
serviceConfigRouter.post(
  "/groups",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: serviceParamsSchema, body: createConfigGroupSchema }),
  asyncHandler(serviceConfigController.createGroup),
);
// Reorder must be registered BEFORE "/groups/:groupId" so "order" isn't parsed as a groupId.
serviceConfigRouter.patch(
  "/groups/order",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: serviceParamsSchema, body: reorderGroupsSchema }),
  asyncHandler(serviceConfigController.reorderGroups),
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
// Reorder before "/options/:optionId" so "order" isn't parsed as an optionId.
serviceConfigRouter.patch(
  "/groups/:groupId/options/order",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: groupParamsSchema, body: reorderOptionsSchema }),
  asyncHandler(serviceConfigController.reorderOptions),
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
