import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { categoriesController } from "./categories.controller";
import {
  createCategorySchema,
  updateCategorySchema,
  updateCategoryStatusSchema,
  listCategoriesSchema,
  categoryIdSchema,
} from "./categories.validation";
import { categoryAssetsRouter } from "./assets/category-assets.routes";
import { UserRole } from "../../enums";

export const categoriesRouter = Router();

// Asset management (icon + cover images), scoped by slug. Mounted before the
// /:id routes is unnecessary (distinct path shape), but kept near the top so the
// asset surface is easy to find.
categoriesRouter.use("/:slug/assets", categoryAssetsRouter);

// Public list — role-aware: anonymous callers see ACTIVE only; staff see all.
categoriesRouter.get(
  "/",
  optionalAuthenticate,
  validate({ query: listCategoriesSchema }),
  asyncHandler(categoriesController.list),
);

// Management (staff) — details incl. linked-services count.
categoriesRouter.get(
  "/:id",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: categoryIdSchema }),
  asyncHandler(categoriesController.getById),
);

categoriesRouter.post(
  "/",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ body: createCategorySchema }),
  asyncHandler(categoriesController.create),
);

categoriesRouter.patch(
  "/:id",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: categoryIdSchema, body: updateCategorySchema }),
  asyncHandler(categoriesController.update),
);

// Lifecycle transitions.
// Generic transition to any valid target status (Available / Coming Soon /
// Draft / Inactive); guarded by the service-layer transition map.
categoriesRouter.post(
  "/:id/status",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: categoryIdSchema, body: updateCategoryStatusSchema }),
  asyncHandler(categoriesController.setStatus),
);

categoriesRouter.post(
  "/:id/publish",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: categoryIdSchema }),
  asyncHandler(categoriesController.publish),
);

categoriesRouter.post(
  "/:id/deactivate",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
  validate({ params: categoryIdSchema }),
  asyncHandler(categoriesController.deactivate),
);
