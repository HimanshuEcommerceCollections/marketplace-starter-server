import { z } from "zod";
import { CoverageMode } from "./coverage.types";


// Re-exported so existing importers keep working. THE definition lives in
// src/utils/zip.ts — one system, one answer to "what is a ZIP".
import { normalizeZip } from "../../utils/zip";
// Re-exported so existing importers keep working. THE definition lives in
// src/utils/zip.ts — one system, one answer to "what is a ZIP".
export { normalizeZip };
/**
 * LOCAL COPY of the shared ZIP normalizer.
 *
 * The design places this in `src/utils/zip.ts` so zod, the resolver and the ZIP
 * importer share one definition. That file is not owned by this module (and did
 * not exist when this module was written), so the canonical implementation is
 * duplicated here byte-for-byte. See the module report: once `src/utils/zip.ts`
 * lands, delete this function and re-export from there — the coverage module
 * must NOT be the second source of truth for ZIP shape.
 *
 * `"  75001-1234 "` -> `"75001"`;  `"7500"` -> `null`;  `"750011234567"` -> `null`.
 * The `digits.length <= 9` guard is what rejects garbage that merely *starts*
 * with five digits, rather than silently truncating it to a valid-looking ZIP.
 */

/**
 * The one ZIP leaf schema. Transforms to the canonical 5-digit form, so
 * everything downstream of `validate` (including the rate limiter keyed on
 * `req.query.zip`) sees bounded, canonical input.
 */
export const zipSchema = z
  .string()
  .trim()
  .max(16)
  .transform((v) => normalizeZip(v))
  .refine((v): v is string => v !== null, {
    message: "Enter a valid 5-digit ZIP code",
  });

/** URL slug: lowercase alphanumeric words joined by single hyphens. */
const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const serviceSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(slugRegex, "Invalid service slug");

/**
 * GET /coverage/check — the anonymous availability check.
 *
 * `serviceId` XOR `serviceSlug`, both optional: omit them and the response
 * carries `services[]` (everything bookable at that ZIP), which makes the
 * booking entry point one round trip.
 */
export const coverageCheckQuerySchema = z
  .object({
    zip: zipSchema,
    serviceId: z.string().uuid().optional(),
    serviceSlug: serviceSlugSchema.optional(),
  })
  .refine((q) => !(q.serviceId !== undefined && q.serviceSlug !== undefined), {
    message: "Provide either serviceId or serviceSlug, not both",
    path: ["serviceId"],
  });

/**
 * Params for the service-scoped routes. `validate` REPLACES `req.params`
 * wholesale, so every merged param of the nested mount must be listed here.
 */
export const serviceCoverageParamsSchema = z.object({
  serviceId: z.string().uuid(),
});

export const serviceCoverageAreaParamsSchema = z.object({
  serviceId: z.string().uuid(),
  areaId: z.string().uuid(),
});

/** GET /services/:serviceId/coverage/check — the truth-teller. */
export const serviceCoverageCheckQuerySchema = z.object({ zip: zipSchema });

/**
 * Hard cap on ZIPs listed in one per-area write. Real validation, not a limit:
 * anyone excluding 500+ ZIPs meant `ONLY`, and the 422 says exactly that.
 */
export const MAX_LISTED_ZIPS = 500;

/**
 * PUT /services/:serviceId/coverage/areas/:areaId — whole-intent per area.
 *
 * `version` is the optimistic-concurrency token the client read from
 * `GET /coverage`. It travels in the BODY, not an `If-Match` header, because
 * the Next BFF's `proxyJson` copies no headers.
 *
 *   mode `ALL`        -> zipCodeIds MUST be []
 *   mode `ALL_EXCEPT` -> zipCodeIds = the ZIPs to EXCLUDE, 1..500
 *   mode `ONLY`       -> zipCodeIds = the ZIPs to INCLUDE, 1..500
 *   mode `NONE`       -> zipCodeIds MUST be []; removes the area entirely
 */
export const putAreaCoverageSchema = z
  .object({
    version: z.number().int().min(0),
    mode: z.nativeEnum(CoverageMode),
    zipCodeIds: z
      .array(z.string().uuid())
      .default([])
      // Deduped BEFORE the count checks and before the write: a payload
      // containing one id twice would otherwise hit ON CONFLICT against a row
      // inserted by the SAME createMany, which Postgres rejects outright.
      .transform((ids) => Array.from(new Set(ids))),
  })
  .superRefine((body, ctx) => {
    const count = body.zipCodeIds.length;

    if (body.mode === CoverageMode.ALL || body.mode === CoverageMode.NONE) {
      if (count > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["zipCodeIds"],
          message:
            body.mode === CoverageMode.ALL
              ? `"All ZIP codes" takes no individual ZIP codes; received ${count}`
              : `"Not available" takes no individual ZIP codes; received ${count}`,
        });
      }
      return;
    }

    if (count === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["zipCodeIds"],
        message:
          body.mode === CoverageMode.ALL_EXCEPT
            ? 'List at least one ZIP code to exclude, or switch this area to "All ZIP codes".'
            : 'List at least one ZIP code to include, or switch this area to "Not available".',
      });
    }

    if (count > MAX_LISTED_ZIPS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["zipCodeIds"],
        message:
          body.mode === CoverageMode.ALL_EXCEPT
            ? `That's ${count} excluded ZIP codes. Switch this area to "Only specific ZIP codes" instead.`
            : `That's ${count} ZIP codes, more than the ${MAX_LISTED_ZIPS} allowed. Switch this area to "All except…" instead.`,
      });
    }
  });
