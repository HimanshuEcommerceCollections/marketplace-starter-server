import fs from "fs";
import path from "path";
import { env } from "./env";
import { getServiceImageDefault } from "./service-image-defaults";

/**
 * Service presentation assets (a single SVG icon + ordered cover images) are
 * NOT stored in the database (per product spec). They are static files served
 * from the Next.js client's public/ dir and resolved here by service `slug`.
 *
 * READ-ONLY. There is no upload/asset-management API: image and icon files are
 * committed assets, changed only by editing the repo. This module resolves a
 * slug to its URLs and never writes.
 *
 * The JSON registry read below is a legacy runtime store written by the former
 * asset-upload API. It is still read (and takes priority) so any deployment
 * that accumulated entries keeps rendering exactly the same images; nothing
 * writes to it any more. Absent/malformed → empty, so resolution falls through
 * to the committed defaults. An mtime-keyed cache keeps resolves cheap.
 *
 * NOTE: distinct from `config/service-assets.ts`, which is the (separate) lucide
 * icon-NAME map used by the booking-config serializer.
 */

/** URL + on-disk folder that all service asset folders live under. */
const SERVICES_DIR_NAME = "services";

/** Slug used for the shared fallback assets folder. */
const DEFAULT_ASSETS_SLUG = "default";

interface ServiceImageAssetEntry {
  iconPath?: string;
  coverImages?: string[];
}

export interface ResolvedServiceImageAssets {
  iconPath: string;
  coverImages: string[];
}

type Registry = Record<string, ServiceImageAssetEntry>;

/** Shared fallback used when a slug has no (or partial) registry entry. */
const DEFAULT_ASSETS: ResolvedServiceImageAssets = {
  iconPath: `/${SERVICES_DIR_NAME}/${DEFAULT_ASSETS_SLUG}/icon.svg`,
  coverImages: [`/${SERVICES_DIR_NAME}/${DEFAULT_ASSETS_SLUG}/cover-1.svg`],
};

const REGISTRY_FILE = env.SERVICE_ASSETS_FILE
  ? path.resolve(env.SERVICE_ASSETS_FILE)
  : path.resolve(process.cwd(), "data", "service-assets.json");

let cache: { mtimeMs: number; data: Registry } | null = null;

/** Read the registry from disk, served from cache unless the file changed. */
function readRegistry(): Registry {
  try {
    const { mtimeMs } = fs.statSync(REGISTRY_FILE);
    if (cache && cache.mtimeMs === mtimeMs) return cache.data;
    const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")) as Registry;
    cache = { mtimeMs, data };
    return data;
  } catch {
    // Missing file (first run) or malformed JSON → behave as an empty registry
    // so service serialization always succeeds with default assets.
    return {};
  }
}

/**
 * Resolve a slug's assets for API responses. Field-level fallback: a service
 * with covers but no icon still gets the default icon, and vice versa.
 * Priority per field: legacy registry → committed config
 * (service-image-defaults.ts) → shared DEFAULT_ASSETS.
 */
export function resolveServiceImageAssets(slug: string): ResolvedServiceImageAssets {
  const entry = readRegistry()[slug];
  const committed = getServiceImageDefault(slug);
  return {
    // Priority per field: legacy registry → committed config → shared default.
    iconPath: entry?.iconPath ?? committed.iconPath ?? DEFAULT_ASSETS.iconPath,
    coverImages:
      entry?.coverImages && entry.coverImages.length > 0
        ? entry.coverImages
        : committed.coverImages && committed.coverImages.length > 0
          ? committed.coverImages
          : DEFAULT_ASSETS.coverImages,
  };
}
