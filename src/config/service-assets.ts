/**
 * Service presentation assets are NOT stored in the database (per the Categories
 * precedent). The `iconPath` is resolved from this hardcoded config by service `slug`
 * and merged into API responses. NOTE: like categories, `iconPath` is a **lucide icon
 * name** (e.g. "HandHelping"), not a filesystem path. A `coverImagePath` analog can be
 * added later if the service card needs one (design §8.6).
 *
 * TypeScript module (not raw .json) on purpose: `tsc` does not copy .json into `dist/`.
 */
export interface ServiceAssets {
  iconPath: string;
}

const DEFAULT_ASSETS: ServiceAssets = { iconPath: "Sparkles" };

/** slug -> assets. Mirrors the `icon` values in the client services.json catalog. */
const SERVICE_ASSETS: Record<string, ServiceAssets> = {
  massage: { iconPath: "HandHelping" },
  "personal-training": { iconPath: "Dumbbell" },
  yoga: { iconPath: "Flower2" },
  beauty: { iconPath: "Sparkles" },
  "nutrition-coaching": { iconPath: "Salad" },
  "life-coaching": { iconPath: "Compass" },
  "physical-therapy": { iconPath: "Activity" },
  "speech-therapy": { iconPath: "MessageCircle" },
};

/** Resolve a service's presentation assets by slug, falling back to defaults. */
export function resolveServiceAssets(slug: string): ServiceAssets {
  return SERVICE_ASSETS[slug] ?? DEFAULT_ASSETS;
}
