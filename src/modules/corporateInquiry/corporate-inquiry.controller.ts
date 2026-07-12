import type { Request, Response } from "express";
import { corporateInquiryService } from "./corporate-inquiry.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import type {
  CreateCorporateInquiryDto,
  ListCorporateInquiriesQuery,
  UpdateCorporateInquiryStatusDto,
} from "./corporate-inquiry.types";

export class CorporateInquiryController {
  // Public — no auth. Anyone can submit a corporate inquiry.
  create = async (req: Request, res: Response) => {
    const entry = await corporateInquiryService.create(
      req.body as CreateCorporateInquiryDto,
    );
    sendSuccess(res, entry, "Inquiry submitted", HttpStatus.CREATED);
  };

  // Staff-only (gated in routes).
  list = async (req: Request, res: Response) => {
    const { items, meta } = await corporateInquiryService.list(
      req.query as unknown as ListCorporateInquiriesQuery,
    );
    sendSuccess(res, items, "Corporate inquiries fetched", undefined, meta);
  };

  updateStatus = async (req: Request, res: Response) => {
    const { status } = req.body as UpdateCorporateInquiryStatusDto;
    const entry = await corporateInquiryService.updateStatus(
      req.params.id,
      status,
    );
    sendSuccess(res, entry, "Inquiry updated");
  };
}

export const corporateInquiryController = new CorporateInquiryController();
