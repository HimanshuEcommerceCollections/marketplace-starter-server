import { asyncHandler } from "../utils/async-handler";
import { ApiError } from "../utils/api-error";
import { HttpStatus } from "../constants/http-status";
import { authRepository } from "../modules/auth/auth.repository";

/**
 * Gate protected business actions (e.g. creating a booking) on a verified email.
 * Use AFTER `authenticate`. The access token carries no `emailVerified` claim
 * (and is short-lived), so this reads the authoritative flag from the database
 * via the auth repository rather than trusting the token. Emits a coded 403 so
 * clients can surface a "verify your email" affordance.
 */
export const requireEmailVerified = asyncHandler(async (req, _res, next) => {
  if (!req.user) throw ApiError.unauthorized();

  const user = await authRepository.findUserById(req.user.id);
  if (!user) throw ApiError.unauthorized("User no longer exists");

  if (!user.emailVerifiedAt) {
    throw new ApiError(
      HttpStatus.FORBIDDEN,
      "Please verify your email address before continuing. Check your inbox for the verification link.",
      { code: "EMAIL_NOT_VERIFIED" },
    );
  }

  next();
});
