import type { User } from "@prisma/client";

/** User shape safe to return in API responses (no password hash). */
export type PublicUser = Omit<User, "passwordHash">;

/**
 * Generic in the row type so callers that widen the query (e.g. `include:
 * { providerProfile: true }`) keep those relations in the returned type instead
 * of having them silently erased down to a bare User.
 */
export function toPublicUser<T extends User>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash, ...rest } = user;
  void passwordHash; // intentionally stripped
  return rest;
}
