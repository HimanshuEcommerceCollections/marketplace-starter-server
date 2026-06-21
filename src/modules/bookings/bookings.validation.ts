import { z } from "zod";
import { BookingStatus, LocationMode } from "../../enums";

export const createBookingSchema = z.object({
  serviceId: z.string().uuid(),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  locationMode: z.nativeEnum(LocationMode).optional(),
  notes: z.string().max(2000).optional(),
  // Selected configuration option ids; price = base + their modifiers.
  optionIds: z.array(z.string().uuid()).optional(),
  // Customer-entered details captured at the "Details" step (persisted on the booking).
  contact: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      email: z.string().trim().email().max(160).optional(),
      phone: z.string().trim().max(40).optional(),
    })
    .optional(),
  address: z.string().trim().max(300).optional(),
  // All preferred windows + flexibility + timezone, as entered (stored verbatim).
  schedulePreferences: z
    .object({
      windows: z
        .array(z.object({ date: z.string(), time: z.string().optional() }))
        .max(10)
        .optional(),
      flexibility: z.string().max(80).optional(),
      timezone: z.string().max(80).optional(),
    })
    .optional(),
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
