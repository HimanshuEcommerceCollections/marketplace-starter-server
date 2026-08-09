import { prisma } from "../../db/client";
import type { Prisma, User } from "@prisma/client";

export class ProfessionalApplicationsRepository {
  findMany(args: Prisma.ProfessionalApplicationFindManyArgs) {
    return prisma.professionalApplication.findMany(args);
  }
  count(where?: Prisma.ProfessionalApplicationWhereInput) {
    return prisma.professionalApplication.count({ where });
  }
  findById(id: string) {
    return prisma.professionalApplication.findUnique({ where: { id } });
  }
  create(data: Prisma.ProfessionalApplicationUncheckedCreateInput) {
    return prisma.professionalApplication.create({ data });
  }
  update(id: string, data: Prisma.ProfessionalApplicationUncheckedUpdateInput) {
    return prisma.professionalApplication.update({ where: { id }, data });
  }

  /**
   * Provision the invited practitioner and close out the application as one
   * unit. A partial result here is the worst outcome available — an orphaned
   * User with no ServiceProvider profile can't be assigned to services or
   * availability, and an application marked ACCEPTED with no account behind it
   * is unrecoverable from the admin UI — so all three writes share a transaction.
   */
  async acceptAsProvider(params: {
    applicationId: string;
    reviewedById: string;
    user: Prisma.UserUncheckedCreateInput;
    profile: { displayName: string; bio?: string; credential?: string };
  }): Promise<User> {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: params.user });
      await tx.serviceProvider.create({
        data: {
          userId: user.id,
          displayName: params.profile.displayName,
          bio: params.profile.bio,
          credential: params.profile.credential,
          // Vetting happened in the application review that led here.
          isVerified: true,
        },
      });
      await tx.professionalApplication.update({
        where: { id: params.applicationId },
        data: {
          status: "ACCEPTED",
          reviewedAt: new Date(),
          reviewedById: params.reviewedById,
          invitedUserId: user.id,
        },
      });
      return user;
    });
  }
}

export const professionalApplicationsRepository =
  new ProfessionalApplicationsRepository();
