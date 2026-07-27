import { z } from "zod";
import { GeoStatus, SortOrder } from "../../enums";


// Re-exported so existing importers keep working. THE definition lives in
// src/utils/zip.ts — one system, one answer to "what is a ZIP".
import { normalizeZip } from "../../utils/zip";
// Re-exported so existing importers keep working. THE definition lives in
// src/utils/zip.ts — one system, one answer to "what is a ZIP".
export { normalizeZip };
/**
 * Canonicalise a US postal code to exactly 5 ASCII digits, or return null.
 *
 * THE single source of truth for ZIP shape. `ZipCode.zipCode` is TEXT, never a
 * number — "07001" must not become 7001 — so this function only ever slices
 * strings and NEVER coerces to Number. Accepted inputs (after trimming):
 *
 *   "27601"        -> "27601"
 *   " 27601 "      -> "27601"
 *   "27601-1234"   -> "27601"   (ZIP+4 suffix stripped)
 *   "276011234"    -> "27601"   (ZIP+4 written without the hyphen)
 *   "2760" / "7501X" / "27601-12" / "" / non-string -> null
 *
 * It is deliberately strict rather than "strip every non-digit": "7501X" is a
 * typo an admin must see, not something to silently repair into "7501".
 * Exported so the coverage resolver, the booking flow and the bulk importer all
 * agree byte-for-byte on what a ZIP is. See the report note about promoting this
 * to `src/utils/zip.ts`.
 */

/** Rows accepted by POST /zip-codes/bulk/import in a single request. */
export const MAX_BULK_IMPORT_ROWS = 1000;
/** Ids accepted by POST /zip-codes/bulk/status and /bulk/move. */
export const MAX_BULK_IDS = 500;

/** Row-error entries returned by the importer before truncation kicks in. */
export const MAX_BULK_IMPORT_ERRORS = 200;

/** Rows written per transaction by the importer (§5.6 step 4). */
export const BULK_IMPORT_CHUNK_SIZE = 500;

/** How the importer reacts to a ZIP that already exists. */
export const zipImportConflictModes = ["SKIP", "UPDATE", "MOVE"] as const;

/** Columns the admin ZIP table can sort on. */
export const zipCodeSortFields = ["zipCode", "city", "createdAt", "updatedAt"] as const;

/**
 * A single canonical ZIP. Normalisation happens here so every downstream layer
 * receives exactly 5 digits; the 422 message is the one the design catalogues as
 * ZIP_INVALID.
 */
const zipCodeSchema = z
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
  });

/** USPS 2-letter state, upper-cased to satisfy ZipCode_stateCode_format_check. */
export const stateCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "State must be a 2-letter USPS code");

/** ISO-3166-1 alpha-2, upper-cased. Only "US" is format-checked in the DB today. */
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Country must be a 2-letter ISO code");

const citySchema = z.string().trim().min(1).max(120);

/** Query-string booleans arrive as strings; z.coerce.boolean() would make "false" true. */
const booleanFlagSchema = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value === "true" || value === "1");

/** Statuses a ZIP may be CREATED in. ARCHIVED-on-create is meaningless. */
const creatableStatusSchema = z.enum([GeoStatus.ACTIVE, GeoStatus.INACTIVE] as const);

/**
 * Statuses reachable through the STAFF toggle endpoints (`/:id/status`,
 * `/bulk/status`).
 *
 * ARCHIVED is deliberately absent. `/:id/archive` and `/:id/restore` are the only
 * doors into and out of ARCHIVED and they are admin-only; accepting ARCHIVED here
 * would let a coordinator archive through a staff route, and — because
 * ARCHIVED -> ACTIVE is a legal transition — un-archive through one too, which
 * makes the admin gate on those two routes purely decorative. Narrowing the enum
 * is what makes "restore is the only way out of ARCHIVED" actually true.
 */
const liveStatusSchema = z.enum([GeoStatus.ACTIVE, GeoStatus.INACTIVE] as const, {
  errorMap: () => ({
    message:
      "Status must be ACTIVE or INACTIVE. Use /archive or /restore to change archival state.",
  }),
});

/**
 * GET /zip-codes — prefix search, area filter, status filter, pagination.
 * `search` is split on shape in the service layer (digits -> zipCode prefix,
 * anything else -> city prefix) so both branches stay index-backed.
 * ARCHIVED rows are excluded unless `status=ARCHIVED` or `includeArchived=true`.
 */
export const listZipCodesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(120).optional(),
  areaId: z.string().uuid().optional(),
  status: z.nativeEnum(GeoStatus).optional(),
  includeArchived: booleanFlagSchema,
  sortBy: z.enum(zipCodeSortFields).default("zipCode"),
  sort: z.nativeEnum(SortOrder).default(SortOrder.ASC),
});

export const zipCodeIdParamSchema = z.object({ id: z.string().uuid() });

/** GET /zip-codes/by-code/:zipCode — the param is normalised like any other ZIP. */
export const zipCodeByCodeParamSchema = z.object({ zipCode: zipCodeSchema });

/** POST /zip-codes — `zipCode` + `areaId` required; everything else defaulted by the DB. */
export const createZipCodeSchema = z.object({
  areaId: z.string().uuid(),
  zipCode: zipCodeSchema,
  city: citySchema.optional(),
  stateCode: stateCodeSchema.optional(),
  countryCode: countryCodeSchema.optional(),
  status: creatableStatusSchema.optional(),
});

/**
 * PATCH /zip-codes/:id — every field optional, at least one required.
 * `areaId` here is a MOVE between markets and can be refused by the composite FK
 * (see the service layer). Status is intentionally not editable here: use
 * /status, /activate, /deactivate, /archive, /restore.
 */
export const updateZipCodeSchema = z
  .object({
    areaId: z.string().uuid(),
    zipCode: zipCodeSchema,
    city: citySchema.nullable(),
    stateCode: stateCodeSchema,
    countryCode: countryCodeSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

/**
 * POST /zip-codes/:id/status — the ACTIVE <-> INACTIVE toggle, guarded by the
 * transition map. See `liveStatusSchema` for why ARCHIVED is not accepted here.
 */
export const updateZipCodeStatusSchema = z.object({
  status: liveStatusSchema,
});

/** POST /zip-codes/bulk/status */
export const bulkZipCodeStatusSchema = z.object({
  zipCodeIds: z
    .array(z.string().uuid())
    .min(1, "At least one ZIP code is required")
    .max(MAX_BULK_IDS, `At most ${MAX_BULK_IDS} ZIP codes per request`),
  status: liveStatusSchema,
});

/** POST /zip-codes/bulk/move */
export const bulkMoveZipCodesSchema = z.object({
  zipCodeIds: z
    .array(z.string().uuid())
    .min(1, "At least one ZIP code is required")
    .max(MAX_BULK_IDS, `At most ${MAX_BULK_IDS} ZIP codes per request`),
  targetAreaId: z.string().uuid(),
});

/**
 * PERMISSIVE BY DESIGN — do not tighten. The strict 5-digit rule, the state-code
 * rule and the area checks all run PER ROW in the service layer so one junk row
 * reports as a row error instead of 422-ing the whole import, which would
 * destroy the per-row reporting this endpoint exists for.
 *
 * `areaId` is a bare bounded string, not `.uuid()`, for the same reason.
 */
const bulkZipRowSchema = z.object({
  zipCode: z.string().trim().max(16),
  areaId: z.string().trim().max(64).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(8).optional(),
});

/**
 * POST /zip-codes/bulk/import — JSON rows only (the browser parses the CSV).
 *
 * NOTE: duplicate ZIPs inside one payload are NOT filtered here, deliberately.
 * The design sketch dropped them in a zod `.transform()`, which silently shifts
 * every later row index and so corrupts the `row` number in every per-row error
 * the endpoint exists to report. The service layer dedupes instead, keeping the
 * first occurrence and reporting the rest as ZIP_CODE_DUPLICATE_IN_PAYLOAD.
 */
export const bulkImportZipCodesSchema = z
  .object({
    areaId: z.string().uuid().optional(),
    defaultState: stateCodeSchema.optional(),
    defaultCountry: countryCodeSchema.optional(),
    conflictMode: z.enum(zipImportConflictModes).default("SKIP"),
    dryRun: z.boolean().default(false),
    rows: z
      .array(bulkZipRowSchema)
      .min(1, "At least one row is required")
      .max(MAX_BULK_IMPORT_ROWS, `At most ${MAX_BULK_IMPORT_ROWS} rows per request`),
  })
  .refine(
    (data) =>
      data.areaId !== undefined || data.rows.every((row) => row.areaId !== undefined),
    {
      message: "Provide a top-level areaId or an areaId on every row",
      path: ["areaId"],
    },
  );
