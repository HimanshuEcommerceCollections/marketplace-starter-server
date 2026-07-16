import type { Request, Response } from "express";
import { authService } from "./auth.service";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { HttpStatus } from "../../constants/http-status";
import type {
  RegisterDto,
  LoginDto,
  RefreshDto,
  VerifyEmailDto,
  ResendVerificationDto,
} from "./auth.types";

// Deliberately generic so resend endpoints never reveal whether an address has
// an account or its verification state (enumeration-safe).
const RESEND_ACK =
  "If your email still needs verifying, a new verification link is on its way.";

/** HTTP layer: parse request, call service, shape response. No business logic. */
export class AuthController {
  register = async (req: Request, res: Response) => {
    const result = await authService.register(req.body as RegisterDto);
    sendSuccess(res, result, "Registration successful", HttpStatus.CREATED);
  };

  login = async (req: Request, res: Response) => {
    const result = await authService.login(req.body as LoginDto);
    sendSuccess(res, result, "Login successful");
  };

  refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as RefreshDto;
    const result = await authService.refresh(refreshToken);
    sendSuccess(res, result, "Token refreshed");
  };

  logout = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as RefreshDto;
    await authService.logout(refreshToken);
    sendSuccess(res, null, "Logged out");
  };

  me = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const user = await authService.me(req.user.id);
    sendSuccess(res, user);
  };

  verifyEmail = async (req: Request, res: Response) => {
    const { token } = req.body as VerifyEmailDto;
    const result = await authService.verifyEmail(token);
    sendSuccess(
      res,
      result,
      result.alreadyVerified
        ? "Your email is already verified"
        : "Email verified successfully",
    );
  };

  // Authenticated resend: uses the logged-in user's id (no email in the body).
  resendVerification = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    await authService.resendVerificationForUser(req.user.id);
    sendSuccess(res, null, RESEND_ACK);
  };

  // Unauthenticated resend: caller supplies an email. Always the same generic ack.
  resendVerificationPublic = async (req: Request, res: Response) => {
    const { email } = req.body as ResendVerificationDto;
    await authService.resendVerificationForEmail(email);
    sendSuccess(res, null, RESEND_ACK);
  };
}

export const authController = new AuthController();
