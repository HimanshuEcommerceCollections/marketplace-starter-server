import { z } from "zod";
import { Brand, ServiceArea } from "../../enums";

/**
 * Accepts the Client's lowercase brand slug (e.g. "elevate" from
 * NEXT_PUBLIC_BRAND) and maps it to the uppercase `Brand` enum.
 */
const brandSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.toUpperCase() : v),
  z.nativeEnum(Brand),
);

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().min(5).optional(),
  brand: brandSchema,
  // Coverage area is multi-value: a customer may select several Wake County
  // towns. At least one is required at signup.
  area: z
    .array(z.nativeEnum(ServiceArea))
    .min(1, "Select at least one area")
    .max(12),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, "A valid refresh token is required"),
});

// Verification token is 32 random bytes hex-encoded (64 chars); accept a small
// range rather than an exact length to stay tolerant of encoding changes.
export const verifyEmailSchema = z.object({
  token: z.string().min(32, "A valid verification token is required").max(256),
});

// Unauthenticated resend: caller supplies the address to (re)send to. The
// service is deliberately silent about whether the address exists.
export const resendVerificationSchema = z.object({
  email: z.string().email(),
});
