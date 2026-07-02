/**
 * Committed per-service image defaults (icon + cover image URLs).
 *
 * This is the SOURCE OF TRUTH for service icons/covers in production. Unlike the
 * runtime registry (data/service-assets.json) — which is gitignored and lives on
 * the server's ephemeral disk, so it is empty after every deploy — this is a
 * committed TS module that ships with the build and is always present. Admin
 * uploads (when wired to durable storage) override these per-service at runtime
 * via the registry; absent an override, these committed paths are used.
 *
 * Each path is a ROOT-RELATIVE URL served by the Next.js client from its public/
 * folder. e.g. "/services/massage/icon.svg" resolves to
 *   client/public/services/massage/icon.svg
 * EVERY path listed here MUST have a matching committed file in the client's
 * public/ folder, or the browser will 404 it.
 *
 * To add/override a service's assets: add (or edit) its entry below and commit
 * the matching file(s) under client/public/services/<slug>/.
 *
 * TS module (not JSON) on purpose: `tsc` does not copy .json files into dist/.
 */
export interface ServiceImageDefault {
  /** Root-relative icon URL, e.g. "/services/massage/icon.svg". */
  iconPath?: string;
  /** Ordered cover image URLs; first is the default card/hero image. */
  coverImages?: string[];
}

/**
 * slug -> committed image assets. Keys must match service slugs (services.json).
 *
 * `icon.svg` files are real per-service icons. `cover-1.svg` files are currently
 * generic placeholders (copied from services/default/cover-1.svg) — replace each
 * with a real image when available. To swap in a raster cover, drop the file in
 * client/public/services/<slug>/ (e.g. cover-1.webp) and update the path below;
 * to add more covers, append to the array (cover-2.*, cover-3.*, ...).
 */
export const SERVICE_IMAGE_DEFAULTS: Record<string, ServiceImageDefault> = {
  massage: {
    iconPath: "/services/massage/icon.svg",
    coverImages: ["/services/massage/cover-1.jpg"],
  },
  "personal-training": {
    iconPath: "/services/personal-training/icon.svg",
    coverImages: ["/services/personal-training/cover-1.jpg"],
  },
  yoga: {
    iconPath: "/services/yoga/icon.svg",
    coverImages: ["/services/yoga/cover-1.jpg"],
  },
  beauty: {
    iconPath: "/services/beauty/icon.svg",
    coverImages: ["/services/beauty/cover-1.jpg"],
  },
  "nutrition-coaching": {
    iconPath: "/services/nutrition-coaching/icon.svg",
    coverImages: ["/services/nutrition-coaching/cover-1.jpg"],
  },
  "life-coaching": {
    iconPath: "/services/life-coaching/icon.svg",
    coverImages: ["/services/life-coaching/cover-1.jpg"],
  },
  "physical-therapy": {
    iconPath: "/services/physical-therapy/icon.svg",
    coverImages: ["/services/physical-therapy/cover-1.jpg"],
  },
  "speech-therapy": {
    iconPath: "/services/speech-therapy/icon.svg",
    coverImages: ["/services/speech-therapy/cover-1.jpg"],
  },
};

/**
 * Resolve a slug's committed defaults (no runtime registry). Returns undefined
 * fields when the slug has no entry, so callers layer their own final fallback.
 */
export function getServiceImageDefault(slug: string): ServiceImageDefault {
  return SERVICE_IMAGE_DEFAULTS[slug] ?? {};
}
