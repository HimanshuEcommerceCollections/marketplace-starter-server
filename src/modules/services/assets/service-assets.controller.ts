import type { Request, Response } from "express";
import { serviceAssetsService } from "./service-assets.service";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { HttpStatus } from "../../../constants/http-status";
import { ICON_CONFIG, COVER_CONFIG } from "../../../config/upload.config";
import type { UploadedFile, ReorderCoversDto } from "./service-assets.types";

type MulterFiles = Record<string, Express.Multer.File[] | undefined>;

/** Map a multer in-memory file to the slim shape the service expects. */
function toUploadedFile(f: Express.Multer.File): UploadedFile {
  return {
    originalname: f.originalname,
    mimetype: f.mimetype,
    size: f.size,
    buffer: f.buffer,
  };
}

/** Parse a multipart text field that should hold a JSON string[] (e.g. order). */
function parseStringArrayField(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === "") return undefined;
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      throw ApiError.badRequest(`"${field}" must be a JSON array of strings`);
    }
  }
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    throw ApiError.badRequest(`"${field}" must be a JSON array of strings`);
  }
  return raw as string[];
}

function extractFiles(req: Request): {
  icon?: UploadedFile;
  covers?: UploadedFile[];
} {
  const files = (req.files ?? {}) as MulterFiles;
  const icon = files[ICON_CONFIG.field]?.[0];
  const covers = files[COVER_CONFIG.field] ?? [];
  return {
    icon: icon ? toUploadedFile(icon) : undefined,
    covers: covers.length ? covers.map(toUploadedFile) : undefined,
  };
}

export class ServiceAssetsController {
  get = async (req: Request, res: Response) => {
    sendSuccess(res, await serviceAssetsService.getAssets(req.params.slug), "Service assets fetched");
  };

  create = async (req: Request, res: Response) => {
    const { icon, covers } = extractFiles(req);
    if (!icon && !covers) {
      throw ApiError.badRequest("Provide an icon and/or at least one cover image");
    }
    const assets = await serviceAssetsService.applyChanges(req.params.slug, {
      icon,
      covers,
    });
    sendSuccess(res, assets, "Service assets uploaded", HttpStatus.CREATED);
  };

  update = async (req: Request, res: Response) => {
    const { icon, covers } = extractFiles(req);
    const body = req.body as Record<string, unknown>;
    const removeCovers = parseStringArrayField(body.removeCovers, "removeCovers");
    const order = parseStringArrayField(body.order, "order");
    const removeIcon = body.removeIcon === "true" || body.removeIcon === true;
    const assets = await serviceAssetsService.applyChanges(req.params.slug, {
      icon,
      covers,
      removeIcon,
      removeCovers,
      order,
    });
    sendSuccess(res, assets, "Service assets updated");
  };

  deleteAll = async (req: Request, res: Response) => {
    sendSuccess(res, await serviceAssetsService.deleteAll(req.params.slug), "Service assets deleted");
  };

  deleteCover = async (req: Request, res: Response) => {
    const assets = await serviceAssetsService.deleteCover(
      req.params.slug,
      req.params.coverId,
    );
    sendSuccess(res, assets, "Cover image deleted");
  };

  reorder = async (req: Request, res: Response) => {
    const { coverImages } = req.body as ReorderCoversDto;
    const assets = await serviceAssetsService.reorderCovers(req.params.slug, coverImages);
    sendSuccess(res, assets, "Cover order updated");
  };
}

export const serviceAssetsController = new ServiceAssetsController();
