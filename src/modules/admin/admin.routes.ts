import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { adminController } from "./admin.controller";
import { UserRole } from "../../enums";

export const adminRouter = Router();

// Entire admin surface is restricted to ADMIN (and COORDINATOR where noted).
adminRouter.use(authenticate, authorize(UserRole.ADMIN, UserRole.COORDINATOR));

adminRouter.get("/dashboard", asyncHandler(adminController.dashboard));
