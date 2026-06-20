import { z } from "zod";

/** Service slug in the URL — same shape the services module accepts. */
const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const assetSlugParamSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(slugRegex, "Invalid service slug"),
});

/**
 * A cover identifier in the URL: the stored filename, e.g. "cover-2.webp".
 * Strict pattern doubles as a path-traversal guard (no slashes or dots-dot).
 */
export const coverParamSchema = assetSlugParamSchema.extend({
  coverId: z
    .string()
    .regex(/^cover-\d+\.(webp|png|jpe?g|svg)$/i, "Invalid cover id"),
});

/** PATCH /covers/order — explicit ordering of the existing covers. */
export const reorderCoversSchema = z.object({
  coverImages: z
    .array(z.string().min(1))
    .min(1, "Provide at least one cover image"),
});
