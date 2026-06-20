import path from "path";
import { env } from "./env";

/**
 * Centralized upload + asset-storage configuration for service assets.
 *
 * Files live on disk under ASSET_STORAGE_ROOT/services/<slug>/ and are served
 * to the browser at the matching `/services/<slug>/<file>` URL (the Next.js
 * client serves its public/ dir, which is the default storage root). Nothing
 * here touches the database — assets are filesystem + JSON-config managed.
 */

/** Absolute filesystem root that the public `/` URL maps to. */
export const ASSET_STORAGE_ROOT = env.ASSET_STORAGE_DIR
  ? path.resolve(env.ASSET_STORAGE_DIR)
  : path.resolve(process.cwd(), "..", "client", "public");

/** URL + on-disk folder that all service asset folders live under. */
export const SERVICES_DIR_NAME = "services";

/** Slug used for the shared fallback assets folder. */
export const DEFAULT_ASSETS_SLUG = "default";

const KB = 1024;

/** Icon: a single inline SVG per service. */
export const ICON_CONFIG = {
  field: "icon",
  filename: "icon.svg",
  maxBytes: 50 * KB,
  allowedMimeTypes: ["image/svg+xml"] as const,
  allowedExtensions: [".svg"] as const,
} as const;

/** Cover images: multiple raster images per service (cards, hero, slideshows). */
export const COVER_CONFIG = {
  field: "covers",
  maxBytes: 500 * KB,
  maxCount: 5,
  /** Filenames are generated as cover-1.<ext>, cover-2.<ext>, ... */
  baseName: "cover",
  allowedMimeTypes: ["image/webp", "image/png", "image/jpeg"] as const,
  allowedExtensions: [".webp", ".png", ".jpg", ".jpeg"] as const,
  /** Advisory only; surfaced to admins in the UI. */
  recommended: { width: 1200, height: 800, aspectRatio: "3:2" },
} as const;

/** Largest single file multer will accept before rejecting (the cover ceiling). */
export const MAX_UPLOAD_BYTES = COVER_CONFIG.maxBytes;

/** Human-friendly size label, e.g. 51200 -> "50 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= KB * KB) return `${Math.round(bytes / (KB * KB))} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}
