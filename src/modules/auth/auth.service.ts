import crypto from "node:crypto";
import type { User } from "@prisma/client";
import { authRepository } from "./auth.repository";
import { ApiError } from "../../utils/api-error";
import { HttpStatus } from "../../constants/http-status";
import { hashPassword, comparePassword } from "../../utils/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt";
import { toPublicUser } from "../../utils/user";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";
import { emailService } from "../email";
import { UserStatus, VerificationPurpose } from "../../enums";
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
  /**
   * Reject admin-disabled accounts. Checked on login AND refresh so a
   * suspension/deactivation actually cuts off access — without the refresh-side
   * check a disabled user could keep rotating refresh tokens indefinitely.
   */
  private assertAccountEnabled(user: User): void {
    if (user.status === UserStatus.SUSPENDED) {
      throw ApiError.forbidden("This account has been suspended");
    }
    if (user.status === UserStatus.INACTIVE) {
      throw ApiError.forbidden("This account is inactive");
    }
    // An invited account has a random unusable password hash, so a password
    // login would already fail — but say so explicitly rather than returning
    // "Invalid credentials", which would send an invitee hunting for a typo.
    if (user.status === UserStatus.INVITED) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        "This account hasn't been set up yet. Open the invitation link we emailed you to choose a password.",
        { code: "INVITE_PENDING" },
      );
    }
  }

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

  /**
   * Issue a fresh single-use verification token for a user and email it. Any
   * outstanding tokens are invalidated first so only the newest link works. The
   * raw token is emailed; only its SHA-256 hash is persisted.
   */
  private async sendVerificationToken(user: User): Promise<void> {
    await authRepository.deleteVerificationTokensForUser(user.id);
    const rawToken = crypto.randomBytes(32).toString("hex");
    await authRepository.storeVerificationToken(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + env.EMAIL_VERIFICATION_TTL_MS),
    );
    const verifyUrl = `${env.APP_URL}/verify-email?token=${rawToken}`;
    await emailService.sendVerificationEmail(user.email, verifyUrl, user.name);
  }

  async register(dto: RegisterDto) {
    const existing = await authRepository.findUserByEmail(dto.email);
    if (existing) throw ApiError.conflict("An account with this email already exists");

    const passwordHash = await hashPassword(dto.password);
    // role omitted → defaults to USER_CUSTOMER (self-signup can never set a role).
    // When verification is required, accounts start unverified: they still get
    // session tokens below (auto-login preserved) but can't log in again or take
    // protected actions (e.g. booking) until they verify. When it's disabled,
    // accounts are created ACTIVE + already-verified and no email is sent.
    const verificationRequired = env.EMAIL_VERIFICATION_REQUIRED;
    const user = await authRepository.createUser({
      email: dto.email,
      passwordHash,
      name: dto.name,
      phone: dto.phone,
      brand: dto.brand,
      status: verificationRequired
        ? UserStatus.PENDING_VERIFICATION
        : UserStatus.ACTIVE,
      emailVerifiedAt: verificationRequired ? null : new Date(),
    });

    if (verificationRequired) {
      // Fire the verification email. A send failure must NOT roll back signup —
      // the account and token already exist and the user can request a resend.
      try {
        await this.sendVerificationToken(user);
      } catch (error) {
        logger.error("Failed to send verification email during registration", error);
      }
    }

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await authRepository.findUserByEmail(dto.email);
    if (!user) throw ApiError.unauthorized("Invalid credentials");

    const ok = await comparePassword(dto.password, user.passwordHash);
    if (!ok) throw ApiError.unauthorized("Invalid credentials");
    this.assertAccountEnabled(user);
    // Verification gate: unverified accounts cannot sign in (unless the feature
    // is disabled via EMAIL_VERIFICATION_REQUIRED). The `code` lets the client
    // surface a "resend verification" affordance instead of a dead end.
    if (env.EMAIL_VERIFICATION_REQUIRED && !user.emailVerifiedAt) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        "Please verify your email address before signing in. Check your inbox for the verification link.",
        { code: "EMAIL_NOT_VERIFIED" },
      );
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
    this.assertAccountEnabled(user);

    // Rotate: revoke the used token, issue a fresh pair.
    await authRepository.revokeRefreshToken(hashToken(refreshToken));
    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), ...tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    await authRepository.revokeRefreshToken(hashToken(refreshToken));
  }

  /**
   * Revoke every outstanding refresh token for a user. Public surface for other
   * modules (e.g. users suspending an account) so they can terminate live
   * sessions without reaching into auth's repository layer.
   */
  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await authRepository.revokeAllForUser(userId);
  }

  async me(userId: string) {
    const user = await authRepository.findUserById(userId);
    if (!user) throw ApiError.notFound("User not found");
    return toPublicUser(user);
  }

  /**
   * Redeem a verification token: validate → mark the user verified + ACTIVE →
   * consume the token (single-use). Idempotent for an already-verified user, so
   * clicking the link twice is friendly rather than an error. Distinct error
   * `code`s (TOKEN_INVALID / TOKEN_EXPIRED) let the client render tailored states.
   */
  async verifyEmail(rawToken: string) {
    const record = await authRepository.findVerificationToken(hashToken(rawToken));
    // An INVITE token must not be redeemable here: /verify-email would activate
    // the account WITHOUT ever setting a password, leaving it reachable only
    // through a password reset that doesn't exist yet.
    if (record && record.purpose !== VerificationPurpose.EMAIL_VERIFICATION) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "This verification link is invalid.", {
        code: "TOKEN_INVALID",
      });
    }
    if (!record) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "This verification link is invalid.", {
        code: "TOKEN_INVALID",
      });
    }

    const user = await authRepository.findUserById(record.userId);
    if (!user) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "This verification link is invalid.", {
        code: "TOKEN_INVALID",
      });
    }

    // Already verified (link clicked twice, or verified via a newer link) → no-op.
    if (user.emailVerifiedAt) {
      return { user: toPublicUser(user), alreadyVerified: true };
    }

    if (record.consumedAt) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        "This verification link has already been used.",
        { code: "TOKEN_INVALID" },
      );
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        "This verification link has expired. Please request a new one.",
        { code: "TOKEN_EXPIRED" },
      );
    }

    const updated = await authRepository.markEmailVerified(user.id, {
      emailVerifiedAt: new Date(),
      // Only promote out of the pending state — never let the PUBLIC verify
      // endpoint override an admin-set SUSPENDED/INACTIVE status.
      status:
        user.status === UserStatus.PENDING_VERIFICATION
          ? UserStatus.ACTIVE
          : user.status,
    });
    await authRepository.consumeVerificationToken(record.id);

    return { user: toPublicUser(updated), alreadyVerified: false };
  }

  /**
   * Resend for a KNOWN, authenticated user id. Idempotent no-op if already
   * verified. Send failures are logged but never surfaced (generic success).
   */
  async resendVerificationForUser(userId: string): Promise<void> {
    if (!env.EMAIL_VERIFICATION_REQUIRED) return;
    const user = await authRepository.findUserById(userId);
    if (!user || user.emailVerifiedAt) return;
    // Fire-and-forget: don't await the (slow) email send before returning, so
    // response latency stays uniform regardless of account state (no timing
    // oracle) and a send failure can't block the generic ack.
    void this.sendVerificationToken(user).catch((error) => {
      logger.error("Failed to resend verification email", error);
    });
  }

  /**
   * Resend for an email address (unauthenticated). Silently no-ops when the
   * email is unknown or already verified so the endpoint can't be used to probe
   * which addresses have accounts (enumeration-safe).
   */
  async resendVerificationForEmail(email: string): Promise<void> {
    if (!env.EMAIL_VERIFICATION_REQUIRED) return;
    const user = await authRepository.findUserByEmail(email);
    if (!user || user.emailVerifiedAt) return;
    // Fire-and-forget (see resendVerificationForUser): uniform latency avoids an
    // enumeration timing side-channel on this public endpoint.
    void this.sendVerificationToken(user).catch((error) => {
      logger.error("Failed to resend verification email", error);
    });
  }

  // ── Invitations ─────────────────────────────────────────────────────────────

  /**
   * A password hash no password can ever produce. Invited accounts need SOME
   * value in the non-nullable passwordHash column before their owner picks one;
   * random bytes mean that even if the INVITED status check were bypassed, the
   * bcrypt comparison in login could not succeed.
   */
  static async unusablePasswordHash(): Promise<string> {
    return hashPassword(crypto.randomBytes(32).toString("hex"));
  }

  /**
   * Issue a single-use invite link for an INVITED user and email it. Any
   * outstanding invite is invalidated first so only the newest link works.
   *
   * Failures propagate: unlike verification mail, the caller (accepting an
   * application, inviting a coordinator) needs to know the invite never landed
   * so it can tell the admin to resend rather than reporting success.
   */
  async sendInvite(
    user: User,
    kind: "provider" | "staff",
    roleLabel?: string,
  ): Promise<void> {
    await authRepository.deleteVerificationTokensForUser(
      user.id,
      VerificationPurpose.INVITE,
    );
    const rawToken = crypto.randomBytes(32).toString("hex");
    await authRepository.storeVerificationToken(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + env.INVITE_TTL_MS),
      VerificationPurpose.INVITE,
    );
    const inviteUrl = `${env.APP_URL}/accept-invite?token=${rawToken}`;
    await emailService.sendInviteEmail(user.email, inviteUrl, {
      kind,
      recipientName: user.name,
      roleLabel,
    });
  }

  /** Kill any outstanding invite without touching the account itself. */
  async revokeInvite(userId: string): Promise<void> {
    await authRepository.deleteVerificationTokensForUser(
      userId,
      VerificationPurpose.INVITE,
    );
  }

  /** Whether a live (unconsumed, unexpired) invite exists — drives the admin UI. */
  async hasActiveInvite(userId: string): Promise<boolean> {
    return (await authRepository.countActiveInvites(userId)) > 0;
  }

  /**
   * Describe an invite token WITHOUT redeeming it, so the accept-invite page can
   * greet the invitee by name and render a dead-link state before they type a
   * password. Deliberately returns only the name + email already known to
   * whoever holds the link.
   */
  async previewInvite(rawToken: string) {
    const record = await authRepository.findVerificationToken(hashToken(rawToken));
    this.assertInviteRedeemable(record);
    const user = await authRepository.findUserById(record!.userId);
    if (!user || user.status !== UserStatus.INVITED) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "This invitation link is invalid.", {
        code: "TOKEN_INVALID",
      });
    }
    return { name: user.name, email: user.email, role: user.role };
  }

  /**
   * Redeem an invite: set the account's first password, activate it, and consume
   * the token. The invitee is signed in immediately afterwards (same auto-login
   * courtesy as registration) so acceptance lands them inside the product.
   */
  async acceptInvite(rawToken: string, password: string) {
    const record = await authRepository.findVerificationToken(hashToken(rawToken));
    this.assertInviteRedeemable(record);

    const user = await authRepository.findUserById(record!.userId);
    if (!user || user.status !== UserStatus.INVITED) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "This invitation link is invalid.", {
        code: "TOKEN_INVALID",
      });
    }

    const passwordHash = await hashPassword(password);
    const updated = await authRepository.setPassword(user.id, {
      passwordHash,
      status: UserStatus.ACTIVE,
      // Clicking a link sent to that address IS the proof of ownership, so the
      // invitee never has to run the separate verification round-trip.
      emailVerifiedAt: new Date(),
    });
    await authRepository.consumeVerificationToken(record!.id);

    const tokens = await this.issueTokens(updated);
    return { user: toPublicUser(updated), ...tokens };
  }

  /** Shared validity checks for an invite token. Throws with a client `code`. */
  private assertInviteRedeemable(
    record: Awaited<ReturnType<typeof authRepository.findVerificationToken>>,
  ): void {
    if (!record || record.purpose !== VerificationPurpose.INVITE) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "This invitation link is invalid.", {
        code: "TOKEN_INVALID",
      });
    }
    if (record.consumedAt) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        "This invitation has already been used. Try signing in instead.",
        { code: "TOKEN_INVALID" },
      );
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        "This invitation has expired. Ask your Elevate contact to send a new one.",
        { code: "TOKEN_EXPIRED" },
      );
    }
  }
}

export const authService = new AuthService();
