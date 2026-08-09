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
  // Comma-separated multi-role filter, for screens that show more than one role
  // at once (the Team page lists admins AND coordinators). Applied instead of
  // `role` when present.
  roles: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.nativeEnum(UserRole)).nonempty().optional()),
  status: z.nativeEnum(UserStatus).optional(),
});

export const userIdSchema = z.object({ id: z.string().uuid() });

/** Admin-only account creation — can set any role + an initial password. */
export const createUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  // Lowercased to match auth's normalization — email equality is case-insensitive
  // everywhere, so admin-provisioned accounts must not mint mixed-case rows.
  email: z.string().email().toLowerCase(),
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

/**
 * Invite a staff member or provider by email — no password, because the invitee
 * sets their own. USER_CUSTOMER is excluded: customers self-register, and an
 * invited customer account would have no way in beyond a link nobody asked for.
 * Providers are normally born from an accepted application; the role is allowed
 * here too so an admin can onboard someone who never went through the form.
 */
export const inviteUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: z.string().email().toLowerCase(),
  phone: z.string().min(5).optional(),
  brand: brandSchema,
  role: z.enum([
    UserRole.SYSTEM_COORDINATOR,
    UserRole.SYSTEM_ADMIN,
    UserRole.SYSTEM_PROVIDER,
  ]),
});
