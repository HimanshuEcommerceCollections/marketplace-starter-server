import type { Prisma } from "@prisma/client";
import { professionalApplicationsRepository } from "./professional-applications.repository";
import { usersRepository } from "../users/users.repository";
import { AuthService, authService } from "../auth";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { buildPagination, buildMeta } from "../../utils/pagination";
import {
  Brand,
  ProfessionalApplicationStatus,
  UserRole,
  UserStatus,
} from "../../enums";
import type {
  CreateProfessionalApplicationDto,
  ListProfessionalApplicationsQuery,
  UpdateProfessionalApplicationStatusDto,
  AcceptProfessionalApplicationDto,
} from "./professional-applications.types";

export class ProfessionalApplicationsService {
  /** Persist a public application. Always a fresh row (applications aren't deduped). */
  async create(dto: CreateProfessionalApplicationDto) {
    return professionalApplicationsRepository.create({
      contactName: dto.contact.name,
      contactEmail: dto.contact.email,
      contactPhone: dto.contact.phone,
      serviceCategory: dto.serviceCategory,
      credential: dto.credential,
      experienceYears: dto.experienceYears,
      serviceArea: dto.serviceArea,
      website: dto.website,
      notes: dto.notes,
    });
  }

  /** Staff list — newest first, optionally filtered by status. */
  async list(query: ListProfessionalApplicationsQuery) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.ProfessionalApplicationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      professionalApplicationsRepository.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      professionalApplicationsRepository.count(where),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
  }

  async getById(id: string) {
    const application = await professionalApplicationsRepository.findById(id);
    if (!application) throw ApiError.notFound("Application not found");
    return application;
  }

  /** Triage move between the two open states (NEW ↔ REVIEWING). */
  async updateStatus(id: string, dto: UpdateProfessionalApplicationStatusDto) {
    const existing = await this.getById(id);
    this.assertOpen(existing.status);
    return professionalApplicationsRepository.update(id, { status: dto.status });
  }

  /**
   * Approve an applicant: provision an INVITED provider account + profile, then
   * email the invite to the address THEY supplied on the application.
   *
   * The email send is deliberately outside the transaction and non-fatal. By the
   * time it runs the account exists and the application is closed; failing the
   * request would tell the reviewer nothing happened when in fact everything but
   * the email did. Instead the outcome is reported back as `inviteEmailSent` so
   * the admin UI can surface "invite not delivered — resend".
   */
  async accept(
    id: string,
    reviewedById: string,
    dto: AcceptProfessionalApplicationDto,
  ) {
    const application = await this.getById(id);
    this.assertOpen(application.status);

    const existingUser = await usersRepository.findByEmail(application.contactEmail);
    if (existingUser) {
      throw ApiError.conflict(
        `An account already exists for ${application.contactEmail}. Change that user's role to Provider instead of accepting this application.`,
      );
    }

    const user = await professionalApplicationsRepository.acceptAsProvider({
      applicationId: id,
      reviewedById,
      user: {
        email: application.contactEmail,
        name: application.contactName,
        phone: application.contactPhone,
        passwordHash: await AuthService.unusablePasswordHash(),
        brand: Brand.ELEVATE,
        role: UserRole.SYSTEM_PROVIDER,
        status: UserStatus.INVITED,
        // Stays null until they click the invite link — that click is what
        // proves the address, so acceptance never pre-verifies it.
        emailVerifiedAt: null,
      },
      profile: {
        displayName: dto.displayName ?? application.contactName,
        credential: dto.credential ?? application.credential ?? undefined,
        bio: dto.bio ?? application.notes ?? undefined,
      },
    });

    let inviteEmailSent = true;
    try {
      await authService.sendInvite(user, "provider");
    } catch (error) {
      inviteEmailSent = false;
      logger.error("Failed to send provider invite email", error);
    }

    return {
      application: await professionalApplicationsRepository.findById(id),
      inviteEmailSent,
    };
  }

  /** Decline an applicant. No account is created and no email is sent. */
  async reject(id: string, reviewedById: string) {
    const application = await this.getById(id);
    this.assertOpen(application.status);
    return professionalApplicationsRepository.update(id, {
      status: ProfessionalApplicationStatus.REJECTED,
      reviewedAt: new Date(),
      reviewedById,
    });
  }

  /**
   * Guard every transition on the application still being open. Without this,
   * double-clicking Accept would try to provision a second account for the same
   * person (caught later by the email conflict, but with a confusing message),
   * and re-rejecting would silently overwrite the original decision's audit stamp.
   */
  private assertOpen(status: ProfessionalApplicationStatus): void {
    if (status === ProfessionalApplicationStatus.ACCEPTED) {
      throw ApiError.conflict("This application has already been accepted");
    }
    if (status === ProfessionalApplicationStatus.REJECTED) {
      throw ApiError.conflict("This application has already been rejected");
    }
  }
}

export const professionalApplicationsService =
  new ProfessionalApplicationsService();
