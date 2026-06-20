import fs from "fs/promises";
import path from "path";
import {
  ASSET_STORAGE_ROOT,
  SERVICES_DIR_NAME,
} from "../config/upload.config";

/**
 * Filesystem layer for service assets. All paths are derived from
 * ASSET_STORAGE_ROOT so the same code works in dev and prod, and every public
 * URL maps 1:1 to a file under that root. Slugs/filenames reaching here are
 * already validated upstream, but resolveWithinRoot() is a hard backstop
 * against path traversal regardless.
 */

/** Absolute path to a service's asset folder. */
export function serviceDir(slug: string): string {
  return path.join(ASSET_STORAGE_ROOT, SERVICES_DIR_NAME, slug);
}

/** Public URL for a file inside a service folder, e.g. /services/yoga/icon.svg */
export function publicUrl(slug: string, filename: string): string {
  return `/${SERVICES_DIR_NAME}/${slug}/${filename}`;
}

/** Resolve a public URL path to its absolute file path, refusing to escape root. */
export function resolveWithinRoot(urlPath: string): string {
  const clean = urlPath.replace(/^\/+/, "");
  const abs = path.resolve(ASSET_STORAGE_ROOT, clean);
  const rootWithSep = ASSET_STORAGE_ROOT.endsWith(path.sep)
    ? ASSET_STORAGE_ROOT
    : ASSET_STORAGE_ROOT + path.sep;
  // Windows paths are case-insensitive, so compare case-insensitively there to
  // avoid both false rejections and case-folding bypasses of the root check.
  const fold = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
  if (fold(abs) !== fold(ASSET_STORAGE_ROOT) && !fold(abs).startsWith(fold(rootWithSep))) {
    throw new Error(`Refusing to access path outside storage root: ${urlPath}`);
  }
  return abs;
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Write a buffer to <serviceDir>/<filename>, creating the folder if needed. */
export async function saveServiceFile(
  slug: string,
  filename: string,
  data: Buffer,
): Promise<void> {
  const dir = serviceDir(slug);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, filename), data);
}

/** Delete a file addressed by its public URL. No-op if it's already gone. */
export async function deleteByUrl(urlPath: string): Promise<void> {
  try {
    await fs.unlink(resolveWithinRoot(urlPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Remove a service folder if (and only if) it is empty. */
export async function removeDirIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    if (entries.length === 0) await fs.rmdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Existing files in a service folder (basenames), or [] if the folder is absent. */
export async function listServiceFiles(slug: string): Promise<string[]> {
  try {
    return await fs.readdir(serviceDir(slug));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Next free cover filename for a slug, e.g. "cover-3.webp". Scans existing
 * cover-N.* files so names never collide even after deletions/re-uploads.
 */
export async function nextCoverFilename(
  slug: string,
  baseName: string,
  ext: string,
): Promise<string> {
  const files = await listServiceFiles(slug);
  const re = new RegExp(`^${baseName}-(\\d+)\\.`, "i");
  let max = 0;
  for (const f of files) {
    const m = re.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${baseName}-${max + 1}${ext}`;
}
