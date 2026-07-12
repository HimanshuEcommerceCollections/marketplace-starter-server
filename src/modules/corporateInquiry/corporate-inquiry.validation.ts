import { z } from "zod";
import { CorporateInquiryStatus } from "../../enums";

/**
 * Public "Request a proposal" submission. The client folds selected service
 * chips + a free-text message into `notes`; `headcount`/`eventType` come from
 * the team-size/format selects. Everything is trimmed and length-capped.
 */
export const createCorporateInquirySchema = z.object({
  company: z.string().trim().min(1, "Company name is required").max(160),
  contact: z.object({
    name: z.string().trim().min(1, "Your name is required").max(120),
    email: z.string().trim().email("Enter a valid email").max(200),
    phone: z.string().trim().max(40).optional(),
  }),
  headcount: z.string().trim().max(120).optional(),
  eventType: z.string().trim().min(1, "Select a format").max(120),
  preferredDate: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const listCorporateInquiriesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(CorporateInquiryStatus).optional(),
});

export const corporateInquiryIdSchema = z.object({ id: z.string().uuid() });

export const updateCorporateInquiryStatusSchema = z.object({
  status: z.nativeEnum(CorporateInquiryStatus),
});
