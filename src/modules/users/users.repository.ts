import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class UsersRepository {
  findMany(args: Prisma.UserFindManyArgs) {
    return prisma.user.findMany(args);
  }
  count(where?: Prisma.UserWhereInput) {
    return prisma.user.count({ where });
  }
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }
  findByEmail(email: string) {
    // Case-insensitive to match auth's lookup: the duplicate check must catch
    // "John@x.com" vs "john@x.com", including legacy mixed-case rows.
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
  }
  create(data: Prisma.UserUncheckedCreateInput) {
    return prisma.user.create({ data });
  }
  update(id: string, data: Prisma.UserUncheckedUpdateInput) {
    return prisma.user.update({ where: { id }, data });
  }

  /**
   * Create an invited account, adding a ServiceProvider profile in the same
   * transaction when the invitee is a provider. Without the profile a provider
   * can't be attached to a service or hold availability, so the two writes must
   * not be able to come apart.
   */
  createInvited(
    data: Prisma.UserUncheckedCreateInput,
    profile?: { displayName: string; credential?: string },
  ) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data });
      if (profile) {
        await tx.serviceProvider.create({
          data: {
            userId: user.id,
            displayName: profile.displayName,
            credential: profile.credential,
            isVerified: true,
          },
        });
      }
      return user;
    });
  }

  /**
   * Which of these users have a live (unconsumed, unexpired) invite. Answers the
   * roster's "Invite pending" vs "Invite expired — resend" distinction in one
   * query instead of N.
   */
  async findUserIdsWithActiveInvite(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await prisma.verificationToken.findMany({
      where: {
        userId: { in: userIds },
        purpose: "INVITE",
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    return new Set(rows.map((r) => r.userId));
  }
}

export const usersRepository = new UsersRepository();
