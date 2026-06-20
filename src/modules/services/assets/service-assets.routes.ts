import { Router } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { authenticate } from "../../../middleware/authenticate";
import { authorize } from "../../../middleware/authorize";
import { validate } from "../../../middleware/validate";
import { uploadServiceAssets } from "../../../middleware/upload";
import { serviceAssetsController } from "./service-assets.controller";
import {
  assetSlugParamSchema,
  coverParamSchema,
  reorderCoversSchema,
} from "./service-assets.validation";
import { UserRole } from "../../../enums";

/**
 * Service asset management, mounted under /services/:slug/assets.
 * `mergeParams` so the parent's :slug is visible here. All routes are staff-only
 * (same roles that may mutate services). Uploads parse multipart BEFORE
 * validation/handler so req.files and text fields are available.
 */
export const serviceAssetsRouter = Router({ mergeParams: true });

const staffOnly = [
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
] as const;

serviceAssetsRouter.get(
  "/",
  ...staffOnly,
  validate({ params: assetSlugParamSchema }),
  asyncHandler(serviceAssetsController.get),
);

serviceAssetsRouter.post(
  "/",
  ...staffOnly,
  uploadServiceAssets,
  validate({ params: assetSlugParamSchema }),
  asyncHandler(serviceAssetsController.create),
);

serviceAssetsRouter.put(
  "/",
  ...staffOnly,
  uploadServiceAssets,
  validate({ params: assetSlugParamSchema }),
  asyncHandler(serviceAssetsController.update),
);

serviceAssetsRouter.delete(
  "/",
  ...staffOnly,
  validate({ params: assetSlugParamSchema }),
  asyncHandler(serviceAssetsController.deleteAll),
);

serviceAssetsRouter.patch(
  "/covers/order",
  ...staffOnly,
  validate({ params: assetSlugParamSchema, body: reorderCoversSchema }),
  asyncHandler(serviceAssetsController.reorder),
);

serviceAssetsRouter.delete(
  "/covers/:coverId",
  ...staffOnly,
  validate({ params: coverParamSchema }),
  asyncHandler(serviceAssetsController.deleteCover),
);
