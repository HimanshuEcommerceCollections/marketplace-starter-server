import type { Prisma } from "@prisma/client";
import { availabilityRepository } from "./availability.repository";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import type { CreateSlotDto, ListSlotsQuery } from "./availability.types";

export class AvailabilityService {
  async list(query: ListSlotsQuery) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.AvailabilitySlotWhereInput = {
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(query.from || query.to
        ? {
            startTime: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      availabilityRepository.findMany({ where, skip, take, orderBy: { startTime: "asc" } }),
      availabilityRepository.count(where),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
  }

  create(dto: CreateSlotDto) {
    return availabilityRepository.create(dto);
  }

  async remove(id: string) {
    const slot = await availabilityRepository.findById(id);
    if (!slot) throw ApiError.notFound("Availability slot not found");
    await availabilityRepository.delete(id);
  }
}

export const availabilityService = new AvailabilityService();
