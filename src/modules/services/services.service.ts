import type { Prisma } from "@prisma/client";
import { servicesRepository } from "./services.repository";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import type {
  CreateServiceDto,
  UpdateServiceDto,
  ListServicesQuery,
} from "./services.types";

export class ServicesService {
  async list(query: ListServicesQuery) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.ServiceWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const [items, total] = await Promise.all([
      servicesRepository.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
      servicesRepository.count(where),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
  }

  async getById(id: string) {
    const service = await servicesRepository.findById(id);
    if (!service) throw ApiError.notFound("Service not found");
    return service;
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
