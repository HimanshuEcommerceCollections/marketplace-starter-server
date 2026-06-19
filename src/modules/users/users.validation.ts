import { z } from "zod";
import { UserRole, UserStatus, Brand } from "../../enums";

/** Maps the Client's lowercase brand slug to the uppercase `Brand` enum. */
const brandSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.toUpperCase() : v),
  z.nativeEnum(Brand),
);

export const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

export const userIdSchema = z.object({ id: z.string().uuid() });

/** Admin-only account creation — can set any role + an initial password. */
export const createUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().min(5).optional(),
  brand: brandSchema,
  role: z.nativeEnum(UserRole),
});

export const updateMeSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(5).optional(),
});

export const updateRoleSchema = z.object({ role: z.nativeEnum(UserRole) });
export const updateStatusSchema = z.object({ status: z.nativeEnum(UserStatus) });
