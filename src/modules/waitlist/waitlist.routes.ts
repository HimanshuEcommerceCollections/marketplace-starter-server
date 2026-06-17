import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import { waitlistController } from "./waitlist.controller";
import {
  joinWaitlistSchema,
  listWaitlistSchema,
  waitlistIdSchema,
} from "./waitlist.validation";

export const waitlistRouter = Router();

// All waitlist routes require authentication.
waitlistRouter.use(authenticate);

waitlistRouter.post(
  "/",
  validate({ body: joinWaitlistSchema }),
  asyncHandler(waitlistController.join),
);
waitlistRouter.get(
  "/",
  validate({ query: listWaitlistSchema }),
  asyncHandler(waitlistController.list),
);
waitlistRouter.patch(
  "/:id/leave",
  validate({ params: waitlistIdSchema }),
  asyncHandler(waitlistController.leave),
);
