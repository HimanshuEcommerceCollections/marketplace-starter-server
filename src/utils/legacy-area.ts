import { ServiceArea } from "../enums";

/**
 * TEMPORARY BRIDGE — DELETE THIS FILE IN THE CONTRACT MIGRATION.
 *
 * `Booking.area` (the 12-value ServiceArea enum) is deprecated but still written,
 * so that rolling back to the previous server version finds its read path
 * populated. Coverage resolution returns an Area *slug*; this maps that slug back
 * onto the legacy enum for the dual-write.
 *
 * Areas are admin-managed now, so a NEW area (a 13th market) has no enum member.
 * That is expected and fine: the lookup returns undefined, the legacy column stays
 * NULL, and the authoritative `areaId` / `areaNameSnapshot` columns carry the
 * truth. Do not add fallbacks that guess an enum value — a wrong legacy value is
 * worse than a null one.
 *
 * When `Booking.area` and the ServiceArea enum are dropped, delete this file and
 * its single call site in bookings.service.ts.
 */
const SLUG_TO_LEGACY_ENUM: Record<string, ServiceArea> = {
  raleigh: ServiceArea.RALEIGH,
  cary: ServiceArea.CARY,
  apex: ServiceArea.APEX,
  "wake-forest": ServiceArea.WAKE_FOREST,
  morrisville: ServiceArea.MORRISVILLE,
  garner: ServiceArea.GARNER,
  "holly-springs": ServiceArea.HOLLY_SPRINGS,
  "fuquay-varina": ServiceArea.FUQUAY_VARINA,
  knightdale: ServiceArea.KNIGHTDALE,
  wendell: ServiceArea.WENDELL,
  zebulon: ServiceArea.ZEBULON,
  rolesville: ServiceArea.ROLESVILLE,
};

/** Legacy enum value for an Area slug, or null for admin-created areas. */
export function legacyAreaForSlug(slug: string | null | undefined): ServiceArea | null {
  if (!slug) return null;
  return SLUG_TO_LEGACY_ENUM[slug] ?? null;
}
