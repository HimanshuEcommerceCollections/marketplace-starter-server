import type { z } from "zod";
import type { reorderCoversSchema } from "./category-assets.validation";

/** Asset payload returned by every asset endpoint (mirrors ResolvedCategoryAssets). */
export interface CategoryAssetsResponse {
  iconPath: string;
  coverImages: string[];
}

export type ReorderCoversDto = z.infer<typeof reorderCoversSchema>;

/** A buffered upload (multer in-memory file) passed into the service. */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Mutation payload for create (POST) / update (PUT). All parts optional. */
export interface ApplyAssetsInput {
  icon?: UploadedFile;
  covers?: UploadedFile[];
  /** Remove the existing icon (ignored when a replacement icon is supplied). */
  removeIcon?: boolean;
  /** Cover filenames (e.g. "cover-2.webp") to delete in this operation. */
  removeCovers?: string[];
  /** Final cover order as filenames or full paths; first becomes the default. */
  order?: string[];
}
