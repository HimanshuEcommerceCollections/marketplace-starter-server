import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class BookingsRepository {
  findMany(args: Prisma.BookingFindManyArgs) {
    return prisma.booking.findMany(args);
  }
  count(where?: Prisma.BookingWhereInput) {
    return prisma.booking.count({ where });
  }
  findById(id: string) {
    return prisma.booking.findUnique({ where: { id } });
  }
  create(data: Prisma.BookingUncheckedCreateInput) {
    return prisma.booking.create({ data });
  }
  update(id: string, data: Prisma.BookingUncheckedUpdateInput) {
    return prisma.booking.update({ where: { id }, data });
  }
}

export const bookingsRepository = new BookingsRepository();
