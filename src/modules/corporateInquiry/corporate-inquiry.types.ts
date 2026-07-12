import type { z } from "zod";
import type {
  createCorporateInquirySchema,
  listCorporateInquiriesSchema,
  updateCorporateInquiryStatusSchema,
} from "./corporate-inquiry.validation";

export type CreateCorporateInquiryDto = z.infer<
  typeof createCorporateInquirySchema
>;
export type ListCorporateInquiriesQuery = z.infer<
  typeof listCorporateInquiriesSchema
>;
export type UpdateCorporateInquiryStatusDto = z.infer<
  typeof updateCorporateInquiryStatusSchema
>;
