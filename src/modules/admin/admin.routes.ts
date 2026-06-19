import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { adminController } from "./admin.controller";
import { UserRole } from "../../enums";

export const adminRouter = Router();

// Entire admin surface is restricted to SYSTEM_ADMIN (and SYSTEM_COORDINATOR where noted).
adminRouter.use(authenticate, authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR));

adminRouter.get("/dashboard", asyncHandler(adminController.dashboard));
