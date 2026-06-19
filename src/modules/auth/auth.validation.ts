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

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().min(5).optional(),
  brand: brandSchema,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, "A valid refresh token is required"),
});
