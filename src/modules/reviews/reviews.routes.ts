import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { reviewsController } from "./reviews.controller";
import {
  createReviewSchema,
  listReviewsSchema,
  reviewIdSchema,
  moderateReviewSchema,
} from "./reviews.validation";
import { UserRole } from "../../enums";

export const reviewsRouter = Router();

// Public: read published reviews
reviewsRouter.get(
  "/",
  validate({ query: listReviewsSchema }),
  asyncHandler(reviewsController.list),
);
reviewsRouter.get(
  "/:id",
  validate({ params: reviewIdSchema }),
  asyncHandler(reviewsController.getById),
);

// Authenticated customer submits a review
reviewsRouter.post(
  "/",
  authenticate,
  validate({ body: createReviewSchema }),
  asyncHandler(reviewsController.create),
);

// Staff moderation (publish/hide)
reviewsRouter.patch(
  "/:id/moderate",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.COORDINATOR),
  validate({ params: reviewIdSchema, body: moderateReviewSchema }),
  asyncHandler(reviewsController.moderate),
);
