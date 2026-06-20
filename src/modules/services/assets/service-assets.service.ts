import { servicesRepository } from "../services.repository";
import { ApiError } from "../../../utils/api-error";
import { logger } from "../../../utils/logger";
import {
  resolveServiceImageAssets,
  getServiceImageAssetEntry,
  upsertServiceImageAssetEntry,
  removeServiceImageAssetEntry,
} from "../../../config/service-image-assets";
import {
  COVER_CONFIG,
  ICON_CONFIG,
  formatBytes,
} from "../../../config/upload.config";
import {
  serviceDir,
  publicUrl,
  saveServiceFile,
  deleteByUrl,
  removeDirIfEmpty,
  nextCoverFilename,
} from "../../../utils/file-storage";
import {
  extname,
  isValidSvg,
  svgHasScript,
  sniffRasterImage,
  rasterMimeType,
  type RasterImageType,
} from "../../../utils/file-validation";
import type {
  ApplyAssetsInput,
  ServiceAssetsResponse,
  UploadedFile,
} from "./service-assets.types";

/** Asset management view: actual uploaded state (null/[] when nothing uploaded). */
export interface CurrentAssets {
  iconPath: string | null;
  coverImages: string[];
}

/** Last path segment, treating value as a URL or bare filename. */
function basename(value: string): string {
  return value.split("/").pop() ?? value;
}

export class ServiceAssetsService {
  /** 404 if no service owns this slug — assets are always scoped to a service. */
  private async assertServiceExists(slug: string): Promise<void> {
    const service = await servicesRepository.findBySlug(slug);
    if (!service) throw ApiError.notFound("Service not found");
  }

  /** Raw uploaded state from the registry (no default fallback). */
  private currentAssets(slug: string): CurrentAssets {
    const entry = getServiceImageAssetEntry(slug);
    return {
      iconPath: entry?.iconPath ?? null,
      coverImages: entry?.coverImages ? [...entry.coverImages] : [],
    };
  }

  private validateIcon(file: UploadedFile): void {
    if (!ICON_CONFIG.allowedExtensions.includes(extname(file.originalname) as never)) {
      throw ApiError.badRequest("Icon must be an .svg file");
    }
    if (!ICON_CONFIG.allowedMimeTypes.includes(file.mimetype as never)) {
      throw ApiError.badRequest("Icon must have content type image/svg+xml");
    }
    if (file.size > ICON_CONFIG.maxBytes) {
      throw ApiError.badRequest(
        `Icon exceeds the maximum size of ${formatBytes(ICON_CONFIG.maxBytes)}`,
      );
    }
    if (!isValidSvg(file.buffer)) {
      throw ApiError.badRequest("Icon is not a valid SVG file (corrupted or empty)");
    }
    if (svgHasScript(file.buffer)) {
      throw ApiError.badRequest("SVG icons must not contain scripts or event handlers");
    }
  }

  /** Validate a cover and return its canonical extension (matching real bytes). */
  private validateCover(file: UploadedFile): string {
    if (!COVER_CONFIG.allowedExtensions.includes(extname(file.originalname) as never)) {
      throw ApiError.badRequest(
        `Cover images must be one of: ${COVER_CONFIG.allowedExtensions.join(", ")}`,
      );
    }
    if (!COVER_CONFIG.allowedMimeTypes.includes(file.mimetype as never)) {
      throw ApiError.badRequest(
        `Unsupported image type "${file.mimetype}". Allowed: ${COVER_CONFIG.allowedMimeTypes.join(", ")}`,
      );
    }
    if (file.size > COVER_CONFIG.maxBytes) {
      throw ApiError.badRequest(
        `Cover image exceeds the maximum size of ${formatBytes(COVER_CONFIG.maxBytes)}`,
      );
    }
    const sniffed = sniffRasterImage(file.buffer);
    if (!sniffed) {
      throw ApiError.badRequest("Cover image is corrupted or not a real image");
    }
    if (rasterMimeType(sniffed) !== file.mimetype) {
      throw ApiError.badRequest(
        "Cover image content does not match its declared type",
      );
    }
    return this.canonicalExt(sniffed);
  }

  private canonicalExt(type: RasterImageType): string {
    return type === "jpeg" ? ".jpg" : `.${type}`;
  }

  /** GET — current uploaded assets for a service (management view). */
  async getAssets(slug: string): Promise<CurrentAssets> {
    await this.assertServiceExists(slug);
    return this.currentAssets(slug);
  }

  /** Public-facing resolved assets (with default fallback) for a slug. */
  resolvePublic(slug: string): ServiceAssetsResponse {
    return resolveServiceImageAssets(slug);
  }

  /**
   * Shared mutation for POST (create) and PUT (update): optionally replace the
   * icon, add covers, remove selected covers, and reorder — all in one atomic
   * pass over the registry. Files are validated before any disk write.
   */
  async applyChanges(slug: string, input: ApplyAssetsInput): Promise<CurrentAssets> {
    await this.assertServiceExists(slug);

    // Pre-validate everything up front so a bad file aborts before we touch disk.
    if (input.icon) this.validateIcon(input.icon);
    const coverExts = (input.covers ?? []).map((c) => this.validateCover(c));

    // A reorder must reference the final cover set, but the server assigns
    // filenames to newly-added covers — the caller can't know them yet. So
    // reordering and adding in one request is ambiguous; require separate calls.
    if (input.order?.length && input.covers?.length) {
      throw ApiError.badRequest(
        "Reordering cannot be combined with adding covers in the same request; reorder after the upload completes",
      );
    }
    // Defense-in-depth: removeCovers entries must look like real cover filenames
    // (they are also matched against the stored list before any file is touched).
    for (const id of input.removeCovers ?? []) {
      if (!/^cover-\d+\.(webp|png|jpe?g|svg)$/i.test(basename(id))) {
        throw ApiError.badRequest(`Invalid cover id: "${id}"`);
      }
    }

    const current = this.currentAssets(slug);
    let iconPath = current.iconPath;
    let covers = [...current.coverImages];

    // 1. Replace icon, or remove it when removeIcon is set and no replacement.
    //    The icon filename is always icon.svg, so saveServiceFile overwrites in
    //    place — no delete-first step (which would open a window where the icon
    //    is missing if the subsequent write failed).
    if (input.icon) {
      await saveServiceFile(slug, ICON_CONFIG.filename, input.icon.buffer);
      iconPath = publicUrl(slug, ICON_CONFIG.filename);
    } else if (input.removeIcon && iconPath) {
      await deleteByUrl(iconPath);
      iconPath = null;
    }

    // 2. Remove selected covers.
    if (input.removeCovers?.length) {
      for (const id of input.removeCovers) {
        const target = covers.find((c) => basename(c) === basename(id));
        if (!target) {
          throw ApiError.badRequest(`Cover "${id}" is not part of this service`);
        }
        await deleteByUrl(target);
        covers = covers.filter((c) => c !== target);
      }
    }

    // 3. Add new covers (enforce the total cap after removals).
    if (input.covers?.length) {
      if (covers.length + input.covers.length > COVER_CONFIG.maxCount) {
        throw ApiError.badRequest(
          `A service may have at most ${COVER_CONFIG.maxCount} cover images`,
        );
      }
      for (let i = 0; i < input.covers.length; i++) {
        const filename = await nextCoverFilename(
          slug,
          COVER_CONFIG.baseName,
          coverExts[i],
        );
        await saveServiceFile(slug, filename, input.covers[i].buffer);
        covers.push(publicUrl(slug, filename));
      }
    }

    // 4. Reorder to the requested order (must be exactly the current set).
    if (input.order?.length) {
      covers = this.applyOrder(covers, input.order);
    }

    upsertServiceImageAssetEntry(slug, { iconPath: iconPath ?? undefined, coverImages: covers });
    await removeDirIfEmpty(serviceDir(slug));
    logger.info("Service assets updated", { slug, icon: Boolean(iconPath), covers: covers.length });
    return { iconPath, coverImages: covers };
  }

  /** Reorder `covers` to match `order` (by basename); both must be the same set. */
  private applyOrder(covers: string[], order: string[]): string[] {
    if (order.length !== covers.length) {
      throw ApiError.badRequest(
        "Reorder list must contain exactly the current cover images",
      );
    }
    const result: string[] = [];
    const remaining = [...covers];
    for (const entry of order) {
      const idx = remaining.findIndex((c) => basename(c) === basename(entry));
      if (idx === -1) {
        throw ApiError.badRequest(`Unknown cover in reorder list: "${entry}"`);
      }
      result.push(remaining.splice(idx, 1)[0]);
    }
    return result;
  }

  /** DELETE single cover by its stored filename (e.g. "cover-2.webp"). */
  async deleteCover(slug: string, coverId: string): Promise<CurrentAssets> {
    await this.assertServiceExists(slug);
    const current = this.currentAssets(slug);
    const target = current.coverImages.find((c) => basename(c) === coverId);
    if (!target) throw ApiError.notFound("Cover image not found");

    await deleteByUrl(target);
    const covers = current.coverImages.filter((c) => c !== target);
    upsertServiceImageAssetEntry(slug, {
      iconPath: current.iconPath ?? undefined,
      coverImages: covers,
    });
    await removeDirIfEmpty(serviceDir(slug));
    logger.info("Service cover deleted", { slug, coverId });
    return { iconPath: current.iconPath, coverImages: covers };
  }

  /** PATCH cover order. */
  async reorderCovers(slug: string, coverImages: string[]): Promise<CurrentAssets> {
    await this.assertServiceExists(slug);
    const current = this.currentAssets(slug);
    if (current.coverImages.length === 0) {
      throw ApiError.badRequest("This service has no cover images to reorder");
    }
    const reordered = this.applyOrder(current.coverImages, coverImages);
    upsertServiceImageAssetEntry(slug, {
      iconPath: current.iconPath ?? undefined,
      coverImages: reordered,
    });
    return { iconPath: current.iconPath, coverImages: reordered };
  }

  /** DELETE all assets: remove every file, drop the registry entry and folder. */
  async deleteAll(slug: string): Promise<CurrentAssets> {
    await this.assertServiceExists(slug);
    const current = this.currentAssets(slug);
    if (current.iconPath) await deleteByUrl(current.iconPath);
    for (const cover of current.coverImages) await deleteByUrl(cover);
    removeServiceImageAssetEntry(slug);
    await removeDirIfEmpty(serviceDir(slug));
    logger.info("Service assets deleted", { slug });
    return { iconPath: null, coverImages: [] };
  }
}

export const serviceAssetsService = new ServiceAssetsService();
