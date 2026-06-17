import type { z } from "zod";
import type {
  createServiceSchema,
  updateServiceSchema,
  listServicesSchema,
} from "./services.validation";

export type CreateServiceDto = z.infer<typeof createServiceSchema>;
export type UpdateServiceDto = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesSchema>;
