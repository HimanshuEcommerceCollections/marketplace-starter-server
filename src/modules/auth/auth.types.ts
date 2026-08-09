import type { z } from "zod";
import type {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  inviteTokenSchema,
  acceptInviteSchema,
} from "./auth.validation";

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationDto = z.infer<typeof resendVerificationSchema>;
export type InviteTokenDto = z.infer<typeof inviteTokenSchema>;
export type AcceptInviteDto = z.infer<typeof acceptInviteSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
