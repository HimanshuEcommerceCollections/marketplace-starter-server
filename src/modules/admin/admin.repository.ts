import { prisma } from "../../db/client";
import { BookingStatus } from "../../enums";

/**
 * Read-only aggregate queries for the admin dashboard. Cuts across multiple
 * tables, so it lives in the admin module rather than any single resource.
 */
export class AdminRepository {
  countUsers() {
    return prisma.user.count();
  }
  countServices() {
    return prisma.service.count();
  }
  countBookings(status?: BookingStatus) {
    return prisma.booking.count({ where: status ? { status } : undefined });
  }
  sumCompletedRevenue() {
    return prisma.booking.aggregate({
      _sum: { priceAmount: true },
      where: { status: BookingStatus.COMPLETED },
    });
  }
}

export const adminRepository = new AdminRepository();
