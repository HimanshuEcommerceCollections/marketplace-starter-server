import { Router } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { authenticate } from "../../../middleware/authenticate";
import { authorize } from "../../../middleware/authorize";
import { validate } from "../../../middleware/validate";
import { uploadCategoryAssets } from "../../../middleware/upload";
import { categoryAssetsController } from "./category-assets.controller";
import {
  assetSlugParamSchema,
  coverParamSchema,
  reorderCoversSchema,
} from "./category-assets.validation";
import { UserRole } from "../../../enums";

/**
 * Category asset management, mounted under /categories/:slug/assets.
 * `mergeParams` so the parent's :slug is visible here. All routes are staff-only
 * (same roles that may mutate categories). Uploads parse multipart BEFORE
 * validation/handler so req.files and text fields are available.
 */
export const categoryAssetsRouter = Router({ mergeParams: true });

const staffOnly = [
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
] as const;

categoryAssetsRouter.get(
  "/",
  ...staffOnly,
  validate({ params: assetSlugParamSchema }),
  asyncHandler(categoryAssetsController.get),
);

categoryAssetsRouter.post(
  "/",
  ...staffOnly,
  uploadCategoryAssets,
  validate({ params: assetSlugParamSchema }),
  asyncHandler(categoryAssetsController.create),
);

categoryAssetsRouter.put(
  "/",
  ...staffOnly,
  uploadCategoryAssets,
  validate({ params: assetSlugParamSchema }),
  asyncHandler(categoryAssetsController.update),
);

categoryAssetsRouter.delete(
  "/",
  ...staffOnly,
  validate({ params: assetSlugParamSchema }),
  asyncHandler(categoryAssetsController.deleteAll),
);

// Reorder must be registered before the parameterized cover route is irrelevant
// here (distinct method), but keep covers routes grouped for clarity.
categoryAssetsRouter.patch(
  "/covers/order",
  ...staffOnly,
  validate({ params: assetSlugParamSchema, body: reorderCoversSchema }),
  asyncHandler(categoryAssetsController.reorder),
);

categoryAssetsRouter.delete(
  "/covers/:coverId",
  ...staffOnly,
  validate({ params: coverParamSchema }),
  asyncHandler(categoryAssetsController.deleteCover),
);
