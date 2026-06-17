import type { z } from "zod";
import type {
  createReviewSchema,
  listReviewsSchema,
  moderateReviewSchema,
} from "./reviews.validation";

export type CreateReviewDto = z.infer<typeof createReviewSchema>;
export type ListReviewsQuery = z.infer<typeof listReviewsSchema>;
export type ModerateReviewDto = z.infer<typeof moderateReviewSchema>;
