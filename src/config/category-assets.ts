/**
 * Category cover image + icon are NOT stored in the database (per product spec).
 * They are resolved from this hardcoded config by category `slug` and merged into
 * API responses, so design can swap artwork without a migration.
 *
 * Implemented as a TypeScript module rather than a raw .json file on purpose:
 * `tsc` does not copy .json assets into `dist/`, so a JSON import would break the
 * production build (`npm run build` + `npm start`). The shape below is plain data
 * and can be lifted into a JSON file later if an asset pipeline copies it.
 */
export interface CategoryAssets {
  coverImagePath: string;
  iconPath: string;
}

/** Fallback used when a slug has no explicit entry. */
const DEFAULT_ASSETS: CategoryAssets = {
  coverImagePath: "/images/categories/default-cover.jpg",
  iconPath: "Sparkles",
};

/** slug -> assets. Keys mirror the catalog category/service slugs. */
const CATEGORY_ASSETS: Record<string, CategoryAssets> = {
  bodywork: { coverImagePath: "/images/categories/bodywork.jpg", iconPath: "HandHelping" },
  massage: { coverImagePath: "/images/categories/massage.jpg", iconPath: "HandHelping" },
  fitness: { coverImagePath: "/images/categories/fitness.jpg", iconPath: "Dumbbell" },
  wellness: { coverImagePath: "/images/categories/wellness.jpg", iconPath: "Salad" },
  therapy: { coverImagePath: "/images/categories/therapy.jpg", iconPath: "Activity" },
};

/** Resolve a category's presentation assets by slug, falling back to defaults. */
export function resolveCategoryAssets(slug: string): CategoryAssets {
  return CATEGORY_ASSETS[slug] ?? DEFAULT_ASSETS;
}
