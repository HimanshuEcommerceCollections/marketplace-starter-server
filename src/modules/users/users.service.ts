import type { Prisma, User } from "@prisma/client";
import { usersRepository } from "./users.repository";
import { authService, AuthService } from "../auth";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { toPublicUser } from "../../utils/user";
import { hashPassword } from "../../utils/password";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { UserRole, UserStatus } from "../../enums";
import type {
  ListUsersQuery,
  CreateUserDto,
  UpdateMeDto,
  UpdateRoleDto,
  UpdateStatusDto,
  InviteUserDto,
} from "./users.types";

/** Human-readable role name for invite email copy ("…as a Coordinator"). */
function roleLabel(role: UserRole): string {
  switch (role) {
    case UserRole.SYSTEM_ADMIN:
      return "Admin";
    case UserRole.SYSTEM_COORDINATOR:
      return "Coordinator";
    case UserRole.SYSTEM_PROVIDER:
      return "Provider";
    default:
      return "Member";
  }
}

export class UsersService {
  async list(query: ListUsersQuery) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.UserWhereInput = {
      // `roles` (multi) wins over `role` (single) when both are supplied.
      ...(query.roles
        ? { role: { in: query.roles } }
        : query.role
          ? { role: query.role }
          : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [users, total] = await Promise.all([
      usersRepository.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        // The admin roster renders the provider's display name and credential
        // alongside the account, so fetch them together rather than N+1ing.
        include: { providerProfile: true },
      }),
      usersRepository.count(where),
    ]);

    // Only INVITED accounts can have a live invite; skip the query otherwise.
    const invitedIds = users
      .filter((u) => u.status === UserStatus.INVITED)
      .map((u) => u.id);
    const withActiveInvite =
      await usersRepository.findUserIdsWithActiveInvite(invitedIds);

    return {
      items: users.map((user) => ({
        ...toPublicUser(user),
        // undefined for anyone not awaiting an invite; true/false distinguishes
        // "invitation pending" from "invitation expired or revoked — resend".
        inviteActive:
          user.status === UserStatus.INVITED
            ? withActiveInvite.has(user.id)
            : undefined,
      })),
      meta: buildMeta(page, limit, total),
    };
  }

  async getById(id: string) {
    const user = await usersRepository.findById(id);
    if (!user) throw ApiError.notFound("User not found");
    return toPublicUser(user);
  }

  /** Admin-provisioned account: any role, initial password, status ACTIVE. */
  async create(dto: CreateUserDto) {
    const existing = await usersRepository.findByEmail(dto.email);
    if (existing) throw ApiError.conflict("An account with this email already exists");

    const passwordHash = await hashPassword(dto.password);
    const user = await usersRepository.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      phone: dto.phone,
      brand: dto.brand,
      role: dto.role,
      status: UserStatus.ACTIVE,
      // Admin-provisioned accounts are trusted and skip self-verification, so
      // stamp emailVerifiedAt — otherwise the login email-verification gate would
      // lock them out (no verification email is ever sent on this path).
      emailVerifiedAt: new Date(),
    });
    return toPublicUser(user);
  }

  async updateProfile(id: string, dto: UpdateMeDto) {
    const updated = await usersRepository.update(id, dto);
    return toPublicUser(updated);
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    await this.getById(id);
    return toPublicUser(await usersRepository.update(id, { role: dto.role }));
  }

  /**
   * Invite a staff member or provider: create the account with no usable
   * password (status INVITED) and email them a link to set one.
   *
   * The email failure mode mirrors accepting an application — the account is
   * already committed by the time the send runs, so a failure is reported as
   * `inviteEmailSent: false` for the UI to offer a resend, rather than a 500
   * that implies nothing happened.
   */
  async invite(dto: InviteUserDto) {
    const existing = await usersRepository.findByEmail(dto.email);
    if (existing) throw ApiError.conflict("An account with this email already exists");

    const user = await usersRepository.createInvited(
      {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        brand: dto.brand,
        role: dto.role,
        passwordHash: await AuthService.unusablePasswordHash(),
        status: UserStatus.INVITED,
        emailVerifiedAt: null,
      },
      dto.role === UserRole.SYSTEM_PROVIDER
        ? { displayName: dto.name }
        : undefined,
    );

    const inviteEmailSent = await this.deliverInvite(user, dto.role);
    return { user: toPublicUser(user), inviteEmailSent };
  }

  /** Re-issue an invite (new token, new email). Invalidates the previous link. */
  async resendInvite(id: string) {
    const user = await usersRepository.findById(id);
    if (!user) throw ApiError.notFound("User not found");
    if (user.status !== UserStatus.INVITED) {
      throw ApiError.badRequest(
        "This account has already been set up — there is no invitation to resend.",
      );
    }
    // Surfaced as a hard failure here (unlike invite/accept): nothing else
    // happened in this request, so a false success would be a plain lie.
    await authService.sendInvite(
      user,
      user.role === UserRole.SYSTEM_PROVIDER ? "provider" : "staff",
      roleLabel(user.role),
    );
    return toPublicUser(user);
  }

  /**
   * Kill an outstanding invitation without deleting the account. The row stays
   * INVITED with no live link, which is what the roster renders as "revoked";
   * an admin can resend later or suspend the account outright.
   */
  async revokeInvite(id: string) {
    const user = await usersRepository.findById(id);
    if (!user) throw ApiError.notFound("User not found");
    if (user.status !== UserStatus.INVITED) {
      throw ApiError.badRequest(
        "This account has already been set up — there is no invitation to revoke.",
      );
    }
    await authService.revokeInvite(id);
    return toPublicUser(user);
  }

  /** Send an invite, converting a delivery failure into a reportable flag. */
  private async deliverInvite(user: User, role: UserRole): Promise<boolean> {
    try {
      await authService.sendInvite(
        user,
        role === UserRole.SYSTEM_PROVIDER ? "provider" : "staff",
        roleLabel(role),
      );
      return true;
    } catch (error) {
      logger.error("Failed to send invite email", error);
      return false;
    }
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    await this.getById(id);
    const updated = await usersRepository.update(id, { status: dto.status });
    // Disabling an account must also kill its live sessions — otherwise the
    // user keeps rotating refresh tokens and the status change never bites.
    if (dto.status === UserStatus.SUSPENDED || dto.status === UserStatus.INACTIVE) {
      await authService.revokeAllSessionsForUser(id);
    }
    return toPublicUser(updated);
  }
}

export const usersService = new UsersService();
