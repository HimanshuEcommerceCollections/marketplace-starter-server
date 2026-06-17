import { z } from "zod";
import { LocationMode } from "../../enums";

export const createServiceSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  description: z.string().max(2000).optional(),
  categoryId: z.string().uuid(),
  providerId: z.string().uuid().optional(),
  priceAmount: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD"),
  durationMinutes: z.number().int().positive().default(60),
  locationMode: z.nativeEnum(LocationMode).default(LocationMode.ONSITE),
  isActive: z.boolean().default(true),
});

export const updateServiceSchema = createServiceSchema.partial();

export const listServicesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  categoryId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const serviceIdSchema = z.object({ id: z.string().uuid() });
