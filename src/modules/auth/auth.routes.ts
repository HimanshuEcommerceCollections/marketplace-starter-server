import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import {
  authRateLimiter,
  verifyIpRateLimiter,
  verifyRateLimiter,
} from "../../middleware/rate-limit";
import { authController } from "./auth.controller";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  inviteTokenSchema,
  acceptInviteSchema,
} from "./auth.validation";

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

// Public: the token in the body is itself the credential.
authRouter.post(
  "/verify-email",
  verifyRateLimiter,
  validate({ body: verifyEmailSchema }),
  asyncHandler(authController.verifyEmail),
);

// Authenticated resend (logged-in-but-unverified user; no body).
authRouter.post(
  "/resend-verification",
  verifyRateLimiter,
  authenticate,
  asyncHandler(authController.resendVerification),
);

// Unauthenticated resend by email (e.g. session expired); enumeration-safe.
// verifyRateLimiter keys on the attacker-supplied body email, so it also needs
// the IP-keyed limiter — rotating addresses would otherwise bypass it entirely.
authRouter.post(
  "/resend-verification/public",
  verifyIpRateLimiter,
  verifyRateLimiter,
  validate({ body: resendVerificationSchema }),
  asyncHandler(authController.resendVerificationPublic),
);

// ── Invitations (public: the token in the request IS the credential) ──────────
// Both are IP-rate-limited because the token is guessable only by brute force and
// neither endpoint requires a session.
authRouter.get(
  "/invite",
  verifyIpRateLimiter,
  validate({ query: inviteTokenSchema }),
  asyncHandler(authController.previewInvite),
);
authRouter.post(
  "/accept-invite",
  verifyIpRateLimiter,
  validate({ body: acceptInviteSchema }),
  asyncHandler(authController.acceptInvite),
);
