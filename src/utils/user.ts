import type { User } from "@prisma/client";

/** User shape safe to return in API responses (no password hash). */
export type PublicUser = Omit<User, "passwordHash">;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, ...rest } = user;
  void passwordHash; // intentionally stripped
  return rest;
}
