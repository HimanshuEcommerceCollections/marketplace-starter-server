import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { paymentsController } from "./payments.controller";
import {
  createIntentSchema,
  paymentIdSchema,
  refundSchema,
} from "./payments.validation";
import { UserRole } from "../../enums";

export const paymentsRouter = Router();

// All non-webhook payment routes require authentication. (The webhook is mounted
// separately in app.ts with a raw body parser and is intentionally public.)
paymentsRouter.use(authenticate);

// Customer creates/reuses a PaymentIntent for their booking.
paymentsRouter.post(
  "/intent",
  validate({ body: createIntentSchema }),
  asyncHandler(paymentsController.createIntent),
);

// Read payment status (owner or staff).
paymentsRouter.get(
  "/:id",
  validate({ params: paymentIdSchema }),
  asyncHandler(paymentsController.getById),
);

// Staff initiates a (full or partial) refund.
paymentsRouter.post(
  "/:id/refund",
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: paymentIdSchema, body: refundSchema }),
  asyncHandler(paymentsController.refund),
);
