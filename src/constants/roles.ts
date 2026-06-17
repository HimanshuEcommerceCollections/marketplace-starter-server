import { UserRole } from "../enums";

/**
 * Role groupings for authorization decisions. Reference these instead of
 * hard-coding role lists at each call site.
 */
export const STAFF_ROLES = [UserRole.ADMIN, UserRole.COORDINATOR] as const;
export const PROVIDER_ROLES = [UserRole.PROVIDER, UserRole.COORDINATOR] as const;
export const ALL_ROLES = [
  UserRole.CUSTOMER,
  UserRole.PROVIDER,
  UserRole.COORDINATOR,
  UserRole.ADMIN,
] as const;

/** True when the role is internal staff (admin/coordinator). */
export function isStaffRole(role: UserRole): boolean {
  return (STAFF_ROLES as readonly UserRole[]).includes(role);
}
