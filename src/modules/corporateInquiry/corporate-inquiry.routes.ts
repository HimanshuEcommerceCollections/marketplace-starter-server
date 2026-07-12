import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { UserRole } from "../../enums";
import { corporateInquiryController } from "./corporate-inquiry.controller";
import {
  createCorporateInquirySchema,
  listCorporateInquiriesSchema,
  corporateInquiryIdSchema,
  updateCorporateInquiryStatusSchema,
} from "./corporate-inquiry.validation";

export const corporateInquiryRouter = Router();

// Public: anyone can submit a corporate inquiry (marketing lead-gen, no auth).
corporateInquiryRouter.post(
  "/",
  validate({ body: createCorporateInquirySchema }),
  asyncHandler(corporateInquiryController.create),
);

// Staff-only: list and triage inquiries.
const staffOnly = [
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
] as const;

corporateInquiryRouter.get(
  "/",
  ...staffOnly,
  validate({ query: listCorporateInquiriesSchema }),
  asyncHandler(corporateInquiryController.list),
);
corporateInquiryRouter.patch(
  "/:id/status",
  ...staffOnly,
  validate({
    params: corporateInquiryIdSchema,
    body: updateCorporateInquiryStatusSchema,
  }),
  asyncHandler(corporateInquiryController.updateStatus),
);
