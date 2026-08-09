import { z } from "zod";
import { Brand } from "../../enums";

/**
 * Accepts the Client's lowercase brand slug (e.g. "elevate" from
 * NEXT_PUBLIC_BRAND) and maps it to the uppercase `Brand` enum.
 */
const brandSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.toUpperCase() : v),
  z.nativeEnum(Brand),
);

// Emails are matched case-insensitively (RFC domains are; mailbox local parts
// effectively are too), so normalize to lowercase at the edge — otherwise
// "John@x.com" and "john@x.com" register as two different accounts.
const emailSchema = z.string().email().toLowerCase();

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().min(5).optional(),
  brand: brandSchema,
  // NOTE: no `area` field. Coverage is a property of a BOOKING (resolved from the
  // customer's ZIP at booking time), not of an account. This is a non-strict
  // z.object and `validate` replaces req.body with the parsed output, so an
  // already-deployed client still sending `area` has it silently stripped rather
  // than 422'd.
});

export const loginSchema = z.object({
  email: emailSchema,
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
  email: emailSchema,
});
