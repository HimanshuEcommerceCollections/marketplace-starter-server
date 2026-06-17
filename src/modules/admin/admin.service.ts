import { adminRepository } from "./admin.repository";
import { BookingStatus } from "../../enums";
import type { DashboardStats } from "./admin.types";

export class AdminService {
  async dashboard(): Promise<DashboardStats> {
    const [users, services, total, pending, completed, cancelled, revenue] =
      await Promise.all([
        adminRepository.countUsers(),
        adminRepository.countServices(),
        adminRepository.countBookings(),
        adminRepository.countBookings(BookingStatus.PENDING),
        adminRepository.countBookings(BookingStatus.COMPLETED),
        adminRepository.countBookings(BookingStatus.CANCELLED),
        adminRepository.sumCompletedRevenue(),
      ]);

    return {
      users,
      services,
      bookings: { total, pending, completed, cancelled },
      revenueMinor: revenue._sum.priceAmount ?? 0,
    };
  }
}

export const adminService = new AdminService();
