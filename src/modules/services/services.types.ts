import type { z } from "zod";
import type { ServiceStatus } from "../../enums";
import type {
  createServiceSchema,
  updateServiceSchema,
  listServicesSchema,
} from "./services.validation";

export type CreateServiceDto = z.infer<typeof createServiceSchema>;
export type UpdateServiceDto = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesSchema>;

/**
 * Serialized service returned by the management + public-list API (DB fields +
 * config-resolved image assets). `basePrice` is the API name for the persisted
 * `priceAmount`. Shape mirrors the former Category response (minus servicesCount)
 * so the wired admin client needs no field changes.
 */
export interface ServiceResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: number; // minor units (cents); persisted as Service.priceAmount
  durationMinutes: number;
  status: ServiceStatus;
  iconPath: string; // resolved SVG icon URL (config-managed, with fallback)
  coverImages: string[]; // ordered cover image URLs; first is the default
  createdAt: Date;
  updatedAt: Date;
}
