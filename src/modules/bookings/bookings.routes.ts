import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { bookingsController } from "./bookings.controller";
import {
  createBookingSchema,
  listBookingsSchema,
  bookingIdSchema,
  updateBookingStatusSchema,
} from "./bookings.validation";
import { UserRole } from "../../enums";

export const bookingsRouter = Router();

// All booking routes require authentication.
bookingsRouter.use(authenticate);

bookingsRouter.post(
  "/",
  validate({ body: createBookingSchema }),
  asyncHandler(bookingsController.create),
);
bookingsRouter.get(
  "/",
  validate({ query: listBookingsSchema }),
  asyncHandler(bookingsController.list),
);
bookingsRouter.get(
  "/:id",
  validate({ params: bookingIdSchema }),
  asyncHandler(bookingsController.getById),
);
bookingsRouter.patch(
  "/:id/cancel",
  validate({ params: bookingIdSchema }),
  asyncHandler(bookingsController.cancel),
);
bookingsRouter.patch(
  "/:id/status",
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: bookingIdSchema, body: updateBookingStatusSchema }),
  asyncHandler(bookingsController.updateStatus),
);
