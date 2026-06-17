import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class WaitlistRepository {
  findMany(args: Prisma.WaitlistEntryFindManyArgs) {
    return prisma.waitlistEntry.findMany(args);
  }
  count(where?: Prisma.WaitlistEntryWhereInput) {
    return prisma.waitlistEntry.count({ where });
  }
  findById(id: string) {
    return prisma.waitlistEntry.findUnique({ where: { id } });
  }
  findByServiceAndUser(serviceId: string, userId: string) {
    return prisma.waitlistEntry.findUnique({
      where: { serviceId_userId: { serviceId, userId } },
    });
  }
  create(data: Prisma.WaitlistEntryUncheckedCreateInput) {
    return prisma.waitlistEntry.create({ data });
  }
  update(id: string, data: Prisma.WaitlistEntryUncheckedUpdateInput) {
    return prisma.waitlistEntry.update({ where: { id }, data });
  }
}

export const waitlistRepository = new WaitlistRepository();
