import type { z } from "zod";
import type { dashboardQuerySchema } from "./admin.validation";

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export interface DashboardStats {
  users: number;
  services: number;
  bookings: { total: number; pending: number; completed: number; cancelled: number };
  revenueMinor: number;
}
