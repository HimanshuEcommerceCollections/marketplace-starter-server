import type { z } from "zod";
import type {
  listUsersSchema,
  updateMeSchema,
  updateRoleSchema,
  updateStatusSchema,
} from "./users.validation";

export type ListUsersQuery = z.infer<typeof listUsersSchema>;
export type UpdateMeDto = z.infer<typeof updateMeSchema>;
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
export type UpdateStatusDto = z.infer<typeof updateStatusSchema>;
