import { z } from "zod";
import { UserRole, UserStatus } from "../../enums";

export const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

export const userIdSchema = z.object({ id: z.string().uuid() });

export const updateMeSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().min(5).optional(),
});

export const updateRoleSchema = z.object({ role: z.nativeEnum(UserRole) });
export const updateStatusSchema = z.object({ status: z.nativeEnum(UserStatus) });
