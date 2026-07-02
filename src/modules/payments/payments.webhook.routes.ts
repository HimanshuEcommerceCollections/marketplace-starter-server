import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { paymentsController } from "./payments.controller";

/**
 * Provider webhook router. Mounted in app.ts with express.raw() BEFORE the
 * global express.json() parser, so signature verification sees the unmodified
 * request body. Intentionally unauthenticated: authenticity is established by
 * the provider signature, not a bearer token.
 *
 * Full path: POST /api/v1/payments/webhook/:provider  (e.g. .../webhook/stripe)
 */
export const paymentsWebhookRouter = Router();

paymentsWebhookRouter.post("/:provider", asyncHandler(paymentsController.handleWebhook));
