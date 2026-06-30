import { z } from "zod";

/** Customer requests a PaymentIntent for one of their bookings. */
export const createIntentSchema = z.object({
  bookingId: z.string().uuid(),
});

export const paymentIdSchema = z.object({ id: z.string().uuid() });

/** Staff refund. `amount` (minor units) omitted = full refund. */
export const refundSchema = z.object({
  amount: z.coerce.number().int().positive().optional(),
});
