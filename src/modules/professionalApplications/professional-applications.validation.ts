import { z } from "zod";
import { ProfessionalApplicationStatus } from "../../enums";

/**
 * Public "apply as a professional" submission (the /corporate/inquiry page). The
 * client folds the free-text "about your practice" answer into `notes`.
 * `contactEmail` is lowercased because it becomes the account email if the
 * application is accepted — it has to match auth's normalization or the
 * duplicate-account check would miss "John@x.com" vs "john@x.com".
 */
export const createProfessionalApplicationSchema = z.object({
  contact: z.object({
    name: z.string().trim().min(1, "Your name is required").max(120),
    email: z.string().trim().email("Enter a valid email").max(200).toLowerCase(),
    phone: z.string().trim().max(40).optional(),
  }),
  serviceCategory: z
    .string()
    .trim()
    .min(1, "Select your primary service")
    .max(120),
  credential: z.string().trim().max(120).optional(),
  experienceYears: z.coerce.number().int().min(0).max(70).optional(),
  serviceArea: z.string().trim().max(160).optional(),
  website: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const listProfessionalApplicationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(ProfessionalApplicationStatus).optional(),
});

export const professionalApplicationIdSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Manual status moves only. ACCEPTED and REJECTED are deliberately excluded:
 * those are side-effecting decisions (provision an account + email an invite,
 * or close the application) and go through their own endpoints so they can
 * never be reached by a bare status PATCH.
 */
export const updateProfessionalApplicationStatusSchema = z.object({
  status: z.enum([
    ProfessionalApplicationStatus.NEW,
    ProfessionalApplicationStatus.REVIEWING,
  ]),
});

/**
 * Accepting can override what the applicant typed — a coordinator may clean up a
 * display name or correct a credential before it appears on bookings. Everything
 * is optional and falls back to the application's own values.
 */
export const acceptProfessionalApplicationSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  credential: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(2000).optional(),
});
