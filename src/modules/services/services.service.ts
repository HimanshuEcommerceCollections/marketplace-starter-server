import type { Prisma } from "@prisma/client";
import { servicesRepository } from "./services.repository";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { CategoryStatus } from "../../enums";
import type {
  CreateServiceDto,
  UpdateServiceDto,
  ListServicesQuery,
} from "./services.types";

export class ServicesService {
  /**
   * @param staff when false (public callers), only services whose parent
   *   category is ACTIVE are returned — deactivated/draft categories hide their
   *   services from the customer site. Internal/staff callers see everything.
   */
  async list(query: ListServicesQuery, staff = false) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.ServiceWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(staff ? {} : { category: { status: CategoryStatus.ACTIVE } }),
    };
    const [items, total] = await Promise.all([
      servicesRepository.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
      servicesRepository.count(where),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
  }

  /**
   * @param staff defaults to true so internal callers (update/remove) bypass the
   *   public visibility check. Public routes pass the caller's real staff flag;
   *   non-staff get a 404 for services under a non-ACTIVE category.
   */
  async getById(id: string, staff = true) {
    const service = await servicesRepository.findByIdWithCategoryStatus(id);
    if (!service) throw ApiError.notFound("Service not found");
    if (!staff && service.category.status !== CategoryStatus.ACTIVE) {
      throw ApiError.notFound("Service not found");
    }
    const { category: _category, ...rest } = service;
    return rest;
  }

  create(dto: CreateServiceDto) {
    return servicesRepository.create(dto);
  }

  async update(id: string, dto: UpdateServiceDto) {
    await this.getById(id);
    return servicesRepository.update(id, dto);
  }

  async remove(id: string) {
    await this.getById(id);
    await servicesRepository.delete(id);
  }
}

export const servicesService = new ServicesService();
