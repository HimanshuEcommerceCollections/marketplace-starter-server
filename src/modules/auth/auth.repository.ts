import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

/** Data-access for auth: users + refresh tokens. No business rules here. */
export class AuthRepository {
  findUserByEmail(email: string) {
    // Case-insensitive on purpose: inputs are lowercased at validation, but rows
    // created before that normalization may still hold mixed-case emails and
    // those users must keep authenticating. findFirst because `mode` isn't
    // allowed on a unique lookup.
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
  }

  findUserById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  createUser(data: Prisma.UserUncheckedCreateInput) {
    return prisma.user.create({ data });
  }

  /** Flip a user's verification state (emailVerifiedAt + status). */
  markEmailVerified(
    userId: string,
    data: Pick<Prisma.UserUncheckedUpdateInput, "emailVerifiedAt" | "status">,
  ) {
    return prisma.user.update({ where: { id: userId }, data });
  }

  storeRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
    return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  findRefreshToken(tokenHash: string) {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  revokeRefreshToken(tokenHash: string) {
    return prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── Email-verification tokens (only SHA-256 hashes are stored) ──────────────

  storeVerificationToken(userId: string, tokenHash: string, expiresAt: Date) {
    return prisma.verificationToken.create({
      data: { userId, tokenHash, expiresAt },
    });
  }

  findVerificationToken(tokenHash: string) {
    return prisma.verificationToken.findUnique({ where: { tokenHash } });
  }

  /** Single-use: stamp consumedAt so a redeemed token can't be replayed. */
  consumeVerificationToken(id: string) {
    return prisma.verificationToken.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }

  /** Invalidate every outstanding token for a user (used before issuing a new one). */
  deleteVerificationTokensForUser(userId: string) {
    return prisma.verificationToken.deleteMany({ where: { userId } });
  }
}

export const authRepository = new AuthRepository();
