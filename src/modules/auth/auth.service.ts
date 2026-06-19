import crypto from "node:crypto";
import type { User } from "@prisma/client";
import { authRepository } from "./auth.repository";
import { ApiError } from "../../utils/api-error";
import { hashPassword, comparePassword } from "../../utils/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt";
import { toPublicUser } from "../../utils/user";
import { UserStatus } from "../../enums";
import type { AuthUser } from "../../types/common.types";
import type { RegisterDto, LoginDto, AuthTokens } from "./auth.types";

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Refresh tokens are stored only as SHA-256 hashes, never in plaintext. */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toAuthUser(user: User): AuthUser {
  return { id: user.id, email: user.email, role: user.role };
}

export class AuthService {
  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessToken = signAccessToken(toAuthUser(user));
    const refreshToken = signRefreshToken({ id: user.id });
    await authRepository.storeRefreshToken(
      user.id,
      hashToken(refreshToken),
      new Date(Date.now() + REFRESH_TTL_MS),
    );
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const existing = await authRepository.findUserByEmail(dto.email);
    if (existing) throw ApiError.conflict("An account with this email already exists");

    const passwordHash = await hashPassword(dto.password);
    // role omitted → defaults to USER_CUSTOMER (self-signup can never set a role).
    const user = await authRepository.createUser({
      email: dto.email,
      passwordHash,
      name: dto.name,
      phone: dto.phone,
      brand: dto.brand,
      status: UserStatus.ACTIVE,
    });

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await authRepository.findUserByEmail(dto.email);
    if (!user) throw ApiError.unauthorized("Invalid credentials");

    const ok = await comparePassword(dto.password, user.passwordHash);
    if (!ok) throw ApiError.unauthorized("Invalid credentials");
    if (user.status === UserStatus.SUSPENDED) {
      throw ApiError.forbidden("This account has been suspended");
    }

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), ...tokens };
  }

  async refresh(refreshToken: string) {
    let payload: { id: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw ApiError.unauthorized("Invalid refresh token");
    }

    const stored = await authRepository.findRefreshToken(hashToken(refreshToken));
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw ApiError.unauthorized("Refresh token expired or revoked");
    }

    const user = await authRepository.findUserById(payload.id);
    if (!user) throw ApiError.unauthorized("User no longer exists");

    // Rotate: revoke the used token, issue a fresh pair.
    await authRepository.revokeRefreshToken(hashToken(refreshToken));
    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), ...tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    await authRepository.revokeRefreshToken(hashToken(refreshToken));
  }

  async me(userId: string) {
    const user = await authRepository.findUserById(userId);
    if (!user) throw ApiError.notFound("User not found");
    return toPublicUser(user);
  }
}

export const authService = new AuthService();
