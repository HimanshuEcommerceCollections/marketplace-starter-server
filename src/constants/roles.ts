import { UserRole } from "../enums";

/**
 * Role groupings for authorization decisions. Reference these instead of
 * hard-coding role lists at each call site.
 */
export const STAFF_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR] as const;
export const PROVIDER_ROLES = [UserRole.SYSTEM_PROVIDER, UserRole.SYSTEM_COORDINATOR] as const;
export const ALL_ROLES = [
  UserRole.USER_CUSTOMER,
  UserRole.SYSTEM_PROVIDER,
  UserRole.SYSTEM_COORDINATOR,
  UserRole.SYSTEM_ADMIN,
] as const;

/** True when the role is internal staff (admin/coordinator). */
export function isStaffRole(role: UserRole): boolean {
  return (STAFF_ROLES as readonly UserRole[]).includes(role);
}
