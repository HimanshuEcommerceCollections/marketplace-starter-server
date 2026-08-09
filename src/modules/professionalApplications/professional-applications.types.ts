import type { z } from "zod";
import type {
  createProfessionalApplicationSchema,
  listProfessionalApplicationsSchema,
  updateProfessionalApplicationStatusSchema,
  acceptProfessionalApplicationSchema,
} from "./professional-applications.validation";

export type CreateProfessionalApplicationDto = z.infer<
  typeof createProfessionalApplicationSchema
>;
export type ListProfessionalApplicationsQuery = z.infer<
  typeof listProfessionalApplicationsSchema
>;
export type UpdateProfessionalApplicationStatusDto = z.infer<
  typeof updateProfessionalApplicationStatusSchema
>;
export type AcceptProfessionalApplicationDto = z.infer<
  typeof acceptProfessionalApplicationSchema
>;
