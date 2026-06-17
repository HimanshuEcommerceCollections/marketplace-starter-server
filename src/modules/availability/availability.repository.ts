import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class AvailabilityRepository {
  findMany(args: Prisma.AvailabilitySlotFindManyArgs) {
    return prisma.availabilitySlot.findMany(args);
  }
  count(where?: Prisma.AvailabilitySlotWhereInput) {
    return prisma.availabilitySlot.count({ where });
  }
  findById(id: string) {
    return prisma.availabilitySlot.findUnique({ where: { id } });
  }
  create(data: Prisma.AvailabilitySlotUncheckedCreateInput) {
    return prisma.availabilitySlot.create({ data });
  }
  delete(id: string) {
    return prisma.availabilitySlot.delete({ where: { id } });
  }
}

export const availabilityRepository = new AvailabilityRepository();
