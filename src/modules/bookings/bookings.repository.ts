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
  /** List with the service name/slug joined, for the customer "My Bookings" view. */
  findManyWithService(args: Prisma.BookingFindManyArgs) {
    return prisma.booking.findMany({
      ...args,
      include: {
        service: { select: { name: true, slug: true } },
        userDetails: true,
        customer: { select: { name: true, email: true } },
        provider: { select: { displayName: true } },
      },
    });
  }
  /** Single booking with the service name/slug joined. */
  findByIdWithService(id: string) {
    return prisma.booking.findUnique({
      where: { id },
      include: {
        service: { select: { name: true, slug: true } },
        userDetails: true,
        customer: { select: { name: true, email: true } },
        provider: { select: { displayName: true } },
      },
    });
  }
  create(data: Prisma.BookingUncheckedCreateInput) {
    return prisma.booking.create({ data });
  }
  update(id: string, data: Prisma.BookingUncheckedUpdateInput) {
    return prisma.booking.update({ where: { id }, data });
  }
}

export const bookingsRepository = new BookingsRepository();
