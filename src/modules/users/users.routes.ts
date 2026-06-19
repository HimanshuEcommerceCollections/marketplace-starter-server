import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { usersController } from "./users.controller";
import {
  listUsersSchema,
  createUserSchema,
  userIdSchema,
  updateMeSchema,
  updateRoleSchema,
  updateStatusSchema,
} from "./users.validation";
import { UserRole } from "../../enums";

export const usersRouter = Router();

// Self-service (any authenticated user)
usersRouter.get("/me", authenticate, asyncHandler(usersController.getMe));
usersRouter.patch(
  "/me",
  authenticate,
  validate({ body: updateMeSchema }),
  asyncHandler(usersController.updateMe),
);

// Staff/admin management
usersRouter.get(
  "/",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ query: listUsersSchema }),
  asyncHandler(usersController.list),
);

// Admin creates an account for any user type (provider/coordinator/admin/customer).
usersRouter.post(
  "/",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({ body: createUserSchema }),
  asyncHandler(usersController.create),
);
usersRouter.get(
  "/:id",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: userIdSchema }),
  asyncHandler(usersController.getById),
);
usersRouter.patch(
  "/:id/role",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({ params: userIdSchema, body: updateRoleSchema }),
  asyncHandler(usersController.updateRole),
);
usersRouter.patch(
  "/:id/status",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({ params: userIdSchema, body: updateStatusSchema }),
  asyncHandler(usersController.updateStatus),
);
