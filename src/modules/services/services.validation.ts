import { z } from "zod";
import { ServiceStatus, SortOrder } from "../../enums";

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
const durationSchema = z.number().int().positive().max(1440);

/**
 * POST /services — slug optional (auto-generated); publish drives initial status.
 * `basePrice` is the API/contract name for the service's base price; it is
 * persisted as Service.priceAmount (the booking-math base, minor units).
 */
export const createServiceSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  basePrice: basePriceSchema,
  slug: slugSchema.optional(),
  durationMinutes: durationSchema.optional(),
  publish: z.boolean().default(false),
});

/** PATCH /services/:id — every field optional, but at least one required.
 *  Status is intentionally NOT editable here: use /publish, /deactivate, /status. */
export const updateServiceSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema,
    description: descriptionSchema.nullable(),
    basePrice: basePriceSchema,
    durationMinutes: durationSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

/** GET /services — search, status filter (staff only), sort, pagination. */
export const listServicesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  status: z.nativeEnum(ServiceStatus).optional(),
  sort: z.nativeEnum(SortOrder).default(SortOrder.DESC),
});

/** POST /services/:id/status — generic lifecycle change to any valid status. */
export const updateServiceStatusSchema = z.object({
  status: z.nativeEnum(ServiceStatus),
});

export const serviceIdSchema = z.object({ id: z.string().uuid() });
