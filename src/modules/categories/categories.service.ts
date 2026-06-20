import type { Prisma, ServiceCategory } from "@prisma/client";
import { categoriesRepository } from "./categories.repository";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { slugify } from "../../utils/slugify";
import { resolveCategoryAssets } from "../../config/category-assets";
import { isStaffRole } from "../../constants/roles";
import { CategoryStatus } from "../../enums";
import type { UserRole } from "../../enums";
import type {
  CreateCategoryDto,
  UpdateCategoryDto,
  ListCategoriesQuery,
  CategoryResponse,
  CategoryDetailsResponse,
} from "./categories.types";

/** Allowed lifecycle transitions. Any pair not listed here is rejected. */
const ALLOWED_TRANSITIONS: Record<CategoryStatus, CategoryStatus[]> = {
  [CategoryStatus.DRAFT]: [CategoryStatus.ACTIVE, CategoryStatus.COMING_SOON],
  [CategoryStatus.ACTIVE]: [
    CategoryStatus.DRAFT,
    CategoryStatus.COMING_SOON,
    CategoryStatus.INACTIVE,
  ],
  [CategoryStatus.COMING_SOON]: [
    CategoryStatus.DRAFT,
    CategoryStatus.ACTIVE,
    CategoryStatus.INACTIVE,
  ],
  [CategoryStatus.INACTIVE]: [CategoryStatus.ACTIVE, CategoryStatus.COMING_SOON],
};

/** Statuses visible to non-staff (anonymous + customers) on public endpoints. */
const PUBLIC_STATUSES: CategoryStatus[] = [
  CategoryStatus.ACTIVE,
  CategoryStatus.COMING_SOON,
];

export class CategoriesService {
  /** Merge DB row with config-resolved assets into the API response shape. */
  private serialize(category: ServiceCategory, servicesCount?: number): CategoryResponse {
    const assets = resolveCategoryAssets(category.slug);
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      basePrice: category.basePrice,
      status: category.status,
      iconPath: assets.iconPath,
      coverImages: assets.coverImages,
      ...(servicesCount !== undefined ? { servicesCount } : {}),
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }

  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const existing = await categoriesRepository.findByName(name);
    if (existing && existing.id !== exceptId) {
      throw ApiError.conflict("Category name already exists");
    }
  }

  private async assertSlugAvailable(slug: string, exceptId?: string): Promise<void> {
    const existing = await categoriesRepository.findBySlug(slug);
    if (existing && existing.id !== exceptId) {
      throw ApiError.conflict("Slug already exists");
    }
  }

  /**
   * List categories. Visibility is role-aware: staff may filter by any status
   * (or see all); everyone else sees only publicly-visible categories
   * (ACTIVE + COMING_SOON). DRAFT and INACTIVE are never exposed to non-staff.
   */
  async list(
    query: ListCategoriesQuery,
    viewerRole?: UserRole,
  ): Promise<{ items: CategoryResponse[]; meta: ReturnType<typeof buildMeta> }> {
    const { skip, take, page, limit } = buildPagination(query);
    const staff = viewerRole !== undefined && isStaffRole(viewerRole);

    const where: Prisma.ServiceCategoryWhereInput = {
      ...(query.search
        ? { name: { contains: query.search, mode: "insensitive" } }
        : {}),
      ...(staff
        ? query.status
          ? { status: query.status }
          : {}
        : query.status && PUBLIC_STATUSES.includes(query.status)
          ? { status: query.status }
          : { status: { in: PUBLIC_STATUSES } }),
    };

    const [items, total] = await Promise.all([
      categoriesRepository.findManyWithServiceCount({
        where,
        skip,
        take,
        orderBy: { createdAt: query.sort },
      }),
      categoriesRepository.count(where),
    ]);

    return {
      items: items.map((c) => this.serialize(c, c._count.services)),
      meta: buildMeta(page, limit, total),
    };
  }

  /** Details view incl. number of linked services (staff-only route). */
  async getById(id: string): Promise<CategoryDetailsResponse> {
    const category = await categoriesRepository.findByIdWithServiceCount(id);
    if (!category) throw ApiError.notFound("Category not found");
    const { _count, ...row } = category;
    return { ...this.serialize(row), servicesCount: _count.services };
  }

  /** Create a category. Defaults to DRAFT; `publish: true` creates it ACTIVE. */
  async create(dto: CreateCategoryDto): Promise<CategoryResponse> {
    await this.assertNameAvailable(dto.name);

    const slug = dto.slug ?? slugify(dto.name);
    if (!slug) {
      throw ApiError.badRequest(
        "Could not generate a slug from the name; please provide a slug explicitly",
      );
    }
    await this.assertSlugAvailable(slug);

    const category = await categoriesRepository.create({
      name: dto.name,
      slug,
      description: dto.description,
      basePrice: dto.basePrice,
      status: dto.publish ? CategoryStatus.ACTIVE : CategoryStatus.DRAFT,
    });
    return this.serialize(category);
  }

  /** Update editable fields (not status). Re-checks name/slug uniqueness. */
  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryResponse> {
    const existing = await categoriesRepository.findById(id);
    if (!existing) throw ApiError.notFound("Category not found");

    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, id);
    }
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      await this.assertSlugAvailable(dto.slug, id);
    }

    const updated = await categoriesRepository.update(id, {
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      basePrice: dto.basePrice,
    });
    return this.serialize(updated);
  }

  /** Move to ACTIVE (shortcut endpoint; valid from DRAFT|COMING_SOON|INACTIVE). */
  publish(id: string): Promise<CategoryResponse> {
    return this.transition(id, CategoryStatus.ACTIVE);
  }

  /** Move to INACTIVE (valid from ACTIVE|COMING_SOON). Linked services retained. */
  deactivate(id: string): Promise<CategoryResponse> {
    return this.transition(id, CategoryStatus.INACTIVE);
  }

  /** Generic lifecycle change to any target status, subject to the transition map. */
  setStatus(id: string, to: CategoryStatus): Promise<CategoryResponse> {
    return this.transition(id, to);
  }

  private async transition(
    id: string,
    to: CategoryStatus,
  ): Promise<CategoryResponse> {
    const existing = await categoriesRepository.findById(id);
    if (!existing) throw ApiError.notFound("Category not found");

    if (!ALLOWED_TRANSITIONS[existing.status].includes(to)) {
      throw ApiError.conflict(
        `Invalid status transition: ${existing.status} -> ${to}`,
      );
    }

    const updated = await categoriesRepository.update(id, { status: to });
    return this.serialize(updated);
  }
}

export const categoriesService = new CategoriesService();
