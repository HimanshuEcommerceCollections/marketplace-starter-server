import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ApiError } from "../utils/api-error";
import {
  COVER_CONFIG,
  ICON_CONFIG,
  MAX_UPLOAD_BYTES,
  formatBytes,
} from "../config/upload.config";

/**
 * Multipart parser for service asset uploads. Files are buffered in memory
 * (small, <=500KB) so the service can validate the bytes before anything is
 * written to disk. `limits.fileSize` is the cover ceiling; the icon's tighter
 * 50KB limit is enforced in the service. Multer errors (oversized file, too
 * many files, unexpected field) are translated into clean 400s.
 */
const multipart = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: ICON_CONFIG.field ? COVER_CONFIG.maxCount + 1 : COVER_CONFIG.maxCount,
  },
}).fields([
  { name: ICON_CONFIG.field, maxCount: 1 },
  { name: COVER_CONFIG.field, maxCount: COVER_CONFIG.maxCount },
]);

/** Express middleware: parse `icon` + `covers` multipart fields. */
export function uploadServiceAssets(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  multipart(req, res, (err: unknown) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      switch (err.code) {
        case "LIMIT_FILE_SIZE":
          return next(
            ApiError.badRequest(
              `File exceeds the maximum allowed size of ${formatBytes(MAX_UPLOAD_BYTES)}`,
            ),
          );
        case "LIMIT_FILE_COUNT":
          return next(
            ApiError.badRequest(
              `Too many files (max ${COVER_CONFIG.maxCount} covers + 1 icon)`,
            ),
          );
        case "LIMIT_UNEXPECTED_FILE":
          return next(
            ApiError.badRequest(
              `Unexpected file field "${err.field ?? ""}". Use "${ICON_CONFIG.field}" or "${COVER_CONFIG.field}".`,
            ),
          );
        default:
          return next(ApiError.badRequest(err.message));
      }
    }
    next(err as Error);
  });
}

/** Convenience type for the parsed file map produced by uploadServiceAssets. */
export type UploadedFiles = {
  [field: string]: Express.Multer.File[] | undefined;
};
