import type { z } from "zod";
import type { BookingStatus } from "@prisma/client";
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

/** Serialized booking returned by the API (DB row + joined service name/slug).
 *  Date fields are ISO 8601 strings (the JSON wire format the client consumes). */
export interface BookingResponse {
  id: string;
  reference: string;
  status: BookingStatus;
  serviceName: string;
  serviceSlug: string;
  customerName: string;
  customerEmail: string;
  providerName: string | null;
  scheduledStart: string; // ISO 8601 instant (canonical)
  scheduledEnd: string;
  scheduledDate: string; // "YYYY-MM-DD" derived from scheduledStart (UTC)
  scheduledTime: string; // "HH:mm" derived from scheduledStart (UTC)
  priceAmount: number;
  currency: string;
  locationMode: string;
  notes: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  schedulePreferences: unknown;
  selections: unknown;
  createdAt: string;
}
