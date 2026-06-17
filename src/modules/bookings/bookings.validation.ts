import { z } from "zod";
import { BookingStatus, LocationMode } from "../../enums";

export const createBookingSchema = z.object({
  serviceId: z.string().uuid(),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  locationMode: z.nativeEnum(LocationMode).optional(),
  notes: z.string().max(2000).optional(),
});

export const listBookingsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(BookingStatus).optional(),
});

export const bookingIdSchema = z.object({ id: z.string().uuid() });

export const updateBookingStatusSchema = z.object({
  status: z.nativeEnum(BookingStatus),
});
