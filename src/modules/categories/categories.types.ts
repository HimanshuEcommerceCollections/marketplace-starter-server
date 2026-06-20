import type { z } from "zod";
import type { CategoryStatus } from "../../enums";
import type {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesSchema,
} from "./categories.validation";

export type CreateCategoryDto = z.infer<typeof createCategorySchema>;
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.infer<typeof listCategoriesSchema>;

/** Serialized category returned by the API (DB fields + config-resolved assets). */
export interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: number; // minor units (cents)
  status: CategoryStatus;
  iconPath: string; // resolved SVG icon URL (config-managed, with fallback)
  coverImages: string[]; // ordered cover image URLs; first is the default
  servicesCount?: number; // present on list + details
  createdAt: Date;
  updatedAt: Date;
}

/** Details response adds the count of services linked to the category. */
export interface CategoryDetailsResponse extends CategoryResponse {
  servicesCount: number;
}
