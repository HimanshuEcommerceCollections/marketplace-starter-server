import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import {
  authenticate,
  optionalAuthenticate,
} from "../../middleware/authenticate";
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

// Public: read published reviews. optionalAuthenticate (same pattern as
// services.routes.ts) is what lets the controller's staff check actually see a
// user — without it req.user is always undefined and the moderation view
// (unpublished reviews) is unreachable.
reviewsRouter.get(
  "/",
  optionalAuthenticate,
  validate({ query: listReviewsSchema }),
  asyncHandler(reviewsController.list),
);
reviewsRouter.get(
  "/:id",
  optionalAuthenticate,
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
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: reviewIdSchema, body: moderateReviewSchema }),
  asyncHandler(reviewsController.moderate),
);
