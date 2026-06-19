import { z } from "zod";
import { CategoryStatus, SortOrder } from "../../enums";

/** URL slug: lowercase alphanumeric words joined by single hyphens. */
const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const nameSchema = z.string().trim().min(2, "Name must be at least 2 characters").max(80);
const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(slugRegex, "Slug may contain only lowercase letters, numbers, and hyphens");
const descriptionSchema = z.string().trim().max(2000);
const basePriceSchema = z
  .number()
  .int("Base price must be a whole number of cents")
  .positive("Base price must be greater than 0");

/** POST /categories — slug optional (auto-generated); publish drives initial status. */
export const createCategorySchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  basePrice: basePriceSchema,
  slug: slugSchema.optional(),
  publish: z.boolean().default(false),
});

/** PATCH /categories/:id — every field optional, but at least one required.
 *  Status is intentionally NOT editable here: use /publish and /deactivate. */
export const updateCategorySchema = z
  .object({
    name: nameSchema,
    slug: slugSchema,
    description: descriptionSchema.nullable(),
    basePrice: basePriceSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

/** GET /categories — search, status filter (staff only), sort, pagination. */
export const listCategoriesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  status: z.nativeEnum(CategoryStatus).optional(),
  sort: z.nativeEnum(SortOrder).default(SortOrder.DESC),
});

export const categoryIdSchema = z.object({ id: z.string().uuid() });
