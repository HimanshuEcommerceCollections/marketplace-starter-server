import type { Request, Response } from "express";
import { paymentsService } from "./payments.service";
import { resolveProvider } from "./providers";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import { ApiError } from "../../utils/api-error";
import { isStaffRole } from "../../constants/roles";
import type { CreateIntentDto, RefundDto } from "./payments.types";

export class PaymentsController {
  createIntent = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { bookingId } = req.body as CreateIntentDto;
    const result = await paymentsService.createIntent(bookingId, {
      id: req.user.id,
      isStaff: isStaffRole(req.user.role),
    });
    sendSuccess(res, result, "Payment intent created", HttpStatus.CREATED);
  };

  getById = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const payment = await paymentsService.getById(req.params.id, {
      id: req.user.id,
      isStaff: isStaffRole(req.user.role),
    });
    sendSuccess(res, payment);
  };

  refund = async (req: Request, res: Response) => {
    const result = await paymentsService.refund(req.params.id, req.body as RefundDto);
    sendSuccess(res, result, "Refund initiated");
  };

  /**
   * Provider webhook. Unauthenticated by design — authenticity is proven by the
   * signature, not a bearer token. `req.body` is a raw Buffer (the route is
   * mounted with express.raw before the global JSON parser).
   */
  handleWebhook = async (req: Request, res: Response) => {
    const provider = resolveProvider(req.params.provider);
    const signature = req.headers[provider.signatureHeader];
    if (typeof signature !== "string") {
      throw ApiError.badRequest("Missing webhook signature");
    }
    const result = await paymentsService.handleProviderEvent(
      provider,
      req.body as Buffer,
      signature,
    );
    sendSuccess(res, result, "Webhook received");
  };
}

export const paymentsController = new PaymentsController();
