import type { z } from "zod";
import type {
  listUsersSchema,
  createUserSchema,
  updateMeSchema,
  updateRoleSchema,
  updateStatusSchema,
  inviteUserSchema,
} from "./users.validation";

export type ListUsersQuery = z.infer<typeof listUsersSchema>;
export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateMeDto = z.infer<typeof updateMeSchema>;
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
export type UpdateStatusDto = z.infer<typeof updateStatusSchema>;
export type InviteUserDto = z.infer<typeof inviteUserSchema>;
