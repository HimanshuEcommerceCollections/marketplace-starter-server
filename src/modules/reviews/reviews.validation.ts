import { z } from "zod";

export const createReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export const listReviewsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  serviceId: z.string().uuid().optional(),
});

export const reviewIdSchema = z.object({ id: z.string().uuid() });

export const moderateReviewSchema = z.object({
  isPublished: z.boolean(),
});
