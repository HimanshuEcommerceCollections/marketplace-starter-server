import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { GeoStatus } from "../../enums";
import type {
  createAreaSchema,
  updateAreaSchema,
  listAreasSchema,
  updateAreaStatusSchema,
  areaDetailQuerySchema,
  areaZipLookupSchema,
  listAreaZipCodesSchema,
} from "./areas.validation";

export type CreateAreaDto = z.infer<typeof createAreaSchema>;
export type UpdateAreaDto = z.infer<typeof updateAreaSchema>;
export type ListAreasQuery = z.infer<typeof listAreasSchema>;
export type UpdateAreaStatusDto = z.infer<typeof updateAreaStatusSchema>;
export type AreaDetailQuery = z.infer<typeof areaDetailQuerySchema>;
export type AreaZipLookupQuery = z.infer<typeof areaZipLookupSchema>;
export type ListAreaZipCodesQuery = z.infer<typeof listAreaZipCodesSchema>;

/**
 * Every Area read in this module carries the total ZIP rollup, so the serializer
 * is total: there is no code path that can return an Area without `zipCodeCount`.
 */
export type AreaWithZipCount = Prisma.AreaGetPayload<{
  include: { _count: { select: { zipCodes: true } } };
}>;

/**
 * The two rollups that cannot come from `_count` on the Area row itself.
 *
 * `activeZipCodeCount` needs a filtered relation count, which is a Prisma preview
 * feature this schema does not enable, so it is a separate grouped query.
 * `serviceCount` must UNION both coverage tables (counting ServiceAreaCoverage
 * alone undercounts every zip-only service, and an admin who sees "0 services"
 * archives a market that was some service's only coverage).
 *
 * BOTH are loaded in ONE batched query per request for the whole page — never
 * per row. That is the constraint behind "coverage rollups are banned from
 * paginated list responses": the ban is on the per-row N+1 that the repo's
 * `serialize()` idiom invites, not on the number itself, which the design
 * explicitly requires in the areas table.
 */
export interface AreaRollup {
  activeZipCodeCount: number;
  serviceCount: number;
}

/**
 * A ZIP as the coverage picker, the public coverage band and the ZIP lookup need
 * it. `city` is a postal fact for display/autofill only and must NEVER be used to
 * resolve an area.
 */
export interface ZipCodeLean {
  id: string;
  zipCode: string;
  city: string | null;
  stateCode: string;
  status: GeoStatus;
}

/** The market identity returned beside a ZIP by GET /areas/lookup. */
export interface AreaLean {
  id: string;
  name: string;
  slug: string;
  status: GeoStatus;
  stateCode: string;
  countryCode: string;
  timezone: string;
}

/**
 * Serialized Area — the shape every areas endpoint returns (admin list, detail,
 * lifecycle transitions and the public coverage band alike).
 *
 * `zipCodeCount` counts ZipCode rows in ANY status; `activeZipCodeCount` only
 * ACTIVE ones. An ACTIVE area with `zipCodeCount: 0` is a legitimate state (a
 * market created before its ZIPs are loaded) and must NOT be filtered out of
 * "areas we serve" — it is covered area-wide, not "0 of 0".
 */
export interface AreaResponse {
  id: string;
  name: string;
  slug: string;
  stateCode: string;
  countryCode: string;
  timezone: string;
  status: GeoStatus;
  sortOrder: number;
  zipCodeCount: number;
  activeZipCodeCount: number;
  serviceCount: number;
  /** Present only when `includeZipCodes=true`; ACTIVE ZIPs, ordered by code. */
  zipCodes?: ZipCodeLean[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Single-area read shape. `activeBookingCount` (PENDING | CONFIRMED |
 * IN_PROGRESS) is the blast-radius number the archive confirm dialog shows; it is
 * loaded for STAFF ONLY, because open-booking volume per market is internal
 * business data that must not reach the public by-slug route.
 */
export interface AreaDetail extends AreaResponse {
  activeBookingCount?: number;
}

/** GET /areas/lookup — the ZIP and the market that owns it. */
export interface AreaZipLookupResult {
  area: AreaLean;
  zipCode: ZipCodeLean;
}

/** GET /areas/:id/zip-codes — capped, not paginated. */
export interface AreaZipCodesResult {
  items: ZipCodeLean[];
  truncated: boolean;
}
