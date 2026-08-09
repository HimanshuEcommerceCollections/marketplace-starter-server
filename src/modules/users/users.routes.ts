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
  inviteUserSchema,
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
// Invite-based provisioning (no password chosen by the admin). Admin-only, same
// bar as POST / — both mint an account with a privileged role.
usersRouter.post(
  "/invite",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({ body: inviteUserSchema }),
  asyncHandler(usersController.invite),
);
usersRouter.get(
  "/:id",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: userIdSchema }),
  asyncHandler(usersController.getById),
);
usersRouter.post(
  "/:id/invite/resend",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({ params: userIdSchema }),
  asyncHandler(usersController.resendInvite),
);
usersRouter.delete(
  "/:id/invite",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({ params: userIdSchema }),
  asyncHandler(usersController.revokeInvite),
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
