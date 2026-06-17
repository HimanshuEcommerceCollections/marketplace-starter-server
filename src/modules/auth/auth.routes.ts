import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import { authRateLimiter } from "../../middleware/rate-limit";
import { authController } from "./auth.controller";
import { registerSchema, loginSchema, refreshSchema } from "./auth.validation";

export const authRouter = Router();

authRouter.post(
  "/register",
  authRateLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register),
);
authRouter.post(
  "/login",
  authRateLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);
authRouter.post(
  "/refresh",
  validate({ body: refreshSchema }),
  asyncHandler(authController.refresh),
);
authRouter.post(
  "/logout",
  validate({ body: refreshSchema }),
  asyncHandler(authController.logout),
);
authRouter.get("/me", authenticate, asyncHandler(authController.me));
