import type { z } from "zod";
import type {
  createBookingSchema,
  listBookingsSchema,
  updateBookingStatusSchema,
} from "./bookings.validation";

export type CreateBookingDto = z.infer<typeof createBookingSchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsSchema>;
export type UpdateBookingStatusDto = z.infer<typeof updateBookingStatusSchema>;

/** Who is acting on a booking — used for ownership/RBAC checks in the service. */
export interface BookingRequester {
  id: string;
  isStaff: boolean;
}
