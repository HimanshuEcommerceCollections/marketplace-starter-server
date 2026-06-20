import fs from "fs";
import path from "path";
import { env } from "./env";
import { SERVICES_DIR_NAME, DEFAULT_ASSETS_SLUG } from "./upload.config";

/**
 * Service presentation assets (a single SVG icon + ordered cover images) are
 * NOT stored in the database (per product spec). They are managed on the
 * filesystem and indexed by service `slug` in a JSON registry that is read on
 * every serialize and rewritten whenever an admin changes assets.
 *
 * Why JSON (not a TS module): this registry must be MUTATED and persisted at
 * runtime. A statically-imported `const` is frozen into the compiled bundle and
 * cannot be updated, so a writable store has to be a data file. The path is
 * configurable; it defaults to <cwd>/data/service-assets.json (outside the
 * web-served public/ dir). An in-memory cache keyed on mtime keeps resolves
 * cheap while still picking up out-of-band edits to the file.
 *
 * NOTE: distinct from `config/service-assets.ts`, which is the (separate) lucide
 * icon-NAME map used by the booking-config serializer. This file holds the real
 * uploaded icon/cover image URLs.
 */

export interface ServiceImageAssetEntry {
  iconPath?: string;
  coverImages?: string[];
}

export interface ResolvedServiceImageAssets {
  iconPath: string;
  coverImages: string[];
}

type Registry = Record<string, ServiceImageAssetEntry>;

/** Shared fallback used when a slug has no (or partial) registry entry. */
export const DEFAULT_ASSETS: ResolvedServiceImageAssets = {
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

/** Persist the registry, pretty-printed and stable-sorted for readability. */
function writeRegistry(data: Registry): void {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
  const sorted: Registry = {};
  for (const key of Object.keys(data).sort()) sorted[key] = data[key];
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  cache = { mtimeMs: fs.statSync(REGISTRY_FILE).mtimeMs, data: sorted };
}

/** Raw registry entry for a slug (no fallback), or undefined if none. */
export function getServiceImageAssetEntry(slug: string): ServiceImageAssetEntry | undefined {
  return readRegistry()[slug];
}

/**
 * Resolve a slug's assets for API responses. Field-level fallback: a service
 * with covers but no icon still gets the default icon, and vice versa.
 * Priority per field: registry entry → DEFAULT_ASSETS.
 */
export function resolveServiceImageAssets(slug: string): ResolvedServiceImageAssets {
  const entry = readRegistry()[slug];
  return {
    iconPath: entry?.iconPath ?? DEFAULT_ASSETS.iconPath,
    coverImages:
      entry?.coverImages && entry.coverImages.length > 0
        ? entry.coverImages
        : DEFAULT_ASSETS.coverImages,
  };
}

/** Create/overwrite a slug's registry entry. Empty entries are pruned. */
export function upsertServiceImageAssetEntry(
  slug: string,
  entry: ServiceImageAssetEntry,
): void {
  const data = readRegistry();
  const hasIcon = Boolean(entry.iconPath);
  const hasCovers = Boolean(entry.coverImages && entry.coverImages.length > 0);
  if (!hasIcon && !hasCovers) {
    delete data[slug];
  } else {
    data[slug] = {
      ...(hasIcon ? { iconPath: entry.iconPath } : {}),
      ...(hasCovers ? { coverImages: entry.coverImages } : {}),
    };
  }
  writeRegistry(data);
}

/** Remove a slug's registry entry entirely. */
export function removeServiceImageAssetEntry(slug: string): void {
  const data = readRegistry();
  if (slug in data) {
    delete data[slug];
    writeRegistry(data);
  }
}
