import { z } from "zod";
import { GeoStatus, SortOrder } from "../../enums";


// Re-exported so existing importers keep working. THE definition lives in
// src/utils/zip.ts — one system, one answer to "what is a ZIP".
import { normalizeZip } from "../../utils/zip";
// Re-exported so existing importers keep working. THE definition lives in
// src/utils/zip.ts — one system, one answer to "what is a ZIP".
export { normalizeZip };
/**
 * URL slug: alphanumeric words joined by single hyphens. Accepted in ANY case and
 * normalized to lowercase here, so the DB only ever sees the canonical form
 * (Area.slug is the natural key and is compared with `=`, never case-folded).
 */
const slugInputRegex = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** Two ASCII letters; uppercased to match the Area_*Code_format_check constraints. */
const twoLetterCodeRegex = /^[A-Za-z]{2}$/;

/** True when the runtime recognises the value as an IANA time zone. */
function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonicalise a US postal code to exactly 5 ASCII digits, or return null.
 *
 * String-only, ALWAYS: `ZipCode.zipCode` is TEXT and "07001" must never become
 * 7001, so this only ever slices and never coerces to Number. ZIP+4 is truncated
 * here (the zod boundary), backstopped by ZipCode_zipCode_us_format_check.
 *
 *   "27601" | " 27601 " | "27601-1234" | "276011234"  -> "27601"
 *   "2760" | "7501X" | "27601-12" | ""                -> null
 *
 * Deliberately strict rather than "strip every non-digit": "7501X" is a typo the
 * caller must see, not something to silently repair into "7501".
 *
 * Duplicated (4 lines, byte-identical behaviour) from the zip-codes module rather
 * than imported across module boundaries — see the report: this belongs in
 * `src/utils/zip.ts` and both modules should then import it from there.
 */

const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(80);

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(slugInputRegex, "Slug may contain only letters, numbers, and hyphens")
  .transform((value) => value.toLowerCase());

const stateCodeSchema = z
  .string()
  .trim()
  .regex(twoLetterCodeRegex, "State code must be 2 letters (USPS, e.g. NC)")
  .transform((value) => value.toUpperCase());

const countryCodeSchema = z
  .string()
  .trim()
  .regex(twoLetterCodeRegex, "Country code must be 2 letters (ISO-3166-1, e.g. US)")
  .transform((value) => value.toUpperCase());

/** IANA zone name — operating-hours-by-area will read this, so reject typos now. */
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isSupportedTimeZone, "Unknown IANA time zone (e.g. America/New_York)");

/** Display ordering for the admin list and the public coverage band. */
const sortOrderSchema = z
  .number()
  .int("Sort order must be a whole number")
  .min(-100_000)
  .max(100_000);

/**
 * A query-string flag. `z.coerce.boolean()` would be WRONG here: it is
 * `Boolean(value)`, so the string "false" coerces to **true** and the flag could
 * never be switched off from a URL. `""` (from `?includeZipCodes=`, which is what
 * a naive client emits for an undefined value) reads as false, not as "present
 * therefore true".
 */
const booleanQuerySchema = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", ""])])
  .transform((value) => value === true || value === "true" || value === "1");

/** Slug of a Service — the `?serviceSlug=` availability filter on GET /areas. */
const serviceSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(slugInputRegex, "Invalid service slug")
  .transform((value) => value.toLowerCase());

/** Sortable columns for GET /areas. */
export const AREA_SORT_FIELDS = ["sortOrder", "name", "createdAt", "updatedAt"] as const;

/**
 * POST /areas — only `name` is required; `slug` is derived from it via
 * src/utils/slugify.ts when omitted. Status is NOT settable at create time: a new
 * market starts ACTIVE (schema default) and moves through the lifecycle routes.
 */
export const createAreaSchema = z.object({
  name: nameSchema,
  slug: slugSchema.optional(),
  stateCode: stateCodeSchema.optional(),
  countryCode: countryCodeSchema.optional(),
  timezone: timezoneSchema.optional(),
  sortOrder: sortOrderSchema.optional(),
});

/**
 * PATCH /areas/:id — every field optional, at least one required. Status is
 * intentionally not editable here: use /activate, /deactivate, /archive,
 * /restore or /status.
 */
export const updateAreaSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema,
    stateCode: stateCodeSchema,
    countryCode: countryCodeSchema,
    timezone: timezoneSchema,
    sortOrder: sortOrderSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

/**
 * GET /areas — search (name/slug), status filter, service-availability filter,
 * sort, pagination.
 *
 * `status` is honoured for staff only. It is also how ARCHIVED rows are reached:
 * with no `status` the list returns ACTIVE + INACTIVE, so retired markets stay
 * out of the way until they are asked for explicitly.
 *
 * `serviceSlug` filters to the markets where that service is actually available
 * (area-wide ALLOW **or** at least one opted-in ZIP), which is what the service
 * detail page's coverage band needs. `includeZipCodes` inlines each market's
 * ACTIVE ZIPs for the marketing band.
 */
export const listAreasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  status: z.nativeEnum(GeoStatus).optional(),
  serviceSlug: serviceSlugSchema.optional(),
  includeZipCodes: booleanQuerySchema.default(false),
  sortBy: z.enum(AREA_SORT_FIELDS).default("sortOrder"),
  sort: z.nativeEnum(SortOrder).default(SortOrder.ASC),
});

/** GET /areas/:id and GET /areas/by-slug/:slug — the AreaDetail read options. */
export const areaDetailQuerySchema = z.object({
  includeZipCodes: booleanQuerySchema.default(false),
});

/**
 * GET /areas/lookup?zip= — "who owns 27601?". The ZIP is normalized to exactly
 * five digits here so the service layer, the DB lookup and any future rate-limit
 * key all see the same bounded value.
 */
export const areaZipLookupSchema = z.object({
  zip: z
    .string()
    .trim()
    .min(1, "ZIP code is required")
    .max(16)
    .transform((value, ctx) => {
      const five = normalizeZip(value);
      if (five === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a valid 5-digit ZIP code",
        });
        return z.NEVER;
      }
      return five;
    }),
});

/**
 * GET /areas/:id/zip-codes — the coverage picker's ZIP list. Deliberately NOT
 * paginated (see the service's hard cap): paging a picker over 300 ZIPs is
 * unusable, so it caps and reports `truncated` instead.
 */
export const listAreaZipCodesSchema = z.object({
  status: z.nativeEnum(GeoStatus).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

/** POST /areas/:id/status — generic lifecycle change to any valid status. */
export const updateAreaStatusSchema = z.object({
  status: z.nativeEnum(GeoStatus),
});

export const areaIdSchema = z.object({ id: z.string().uuid() });

/** GET /areas/by-slug/:slug — public lookup by natural key. */
export const areaSlugParamSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(slugInputRegex, "Invalid area slug")
    .transform((value) => value.toLowerCase()),
});
