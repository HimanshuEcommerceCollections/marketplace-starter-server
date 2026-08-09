import type { Prisma } from "@prisma/client";
import { availabilityRepository } from "./availability.repository";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import type { CreateSlotDto, ListSlotsQuery, SlotActor } from "./availability.types";

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

  async create(actor: SlotActor, dto: CreateSlotDto) {
    // Staff may create slots for any provider; a provider is always pinned to
    // their OWN ServiceProvider record — the client-sent providerId is never
    // trusted for them, or provider A could file slots under provider B.
    if (actor.isStaff) return availabilityRepository.create(dto);
    const provider = await this.requireProviderProfile(actor.id);
    return availabilityRepository.create({ ...dto, providerId: provider.id });
  }

  async remove(actor: SlotActor, id: string) {
    const slot = await availabilityRepository.findById(id);
    if (!slot) throw ApiError.notFound("Availability slot not found");
    // Same ownership rule as create: non-staff callers may only delete slots
    // belonging to their own provider profile (service-level slots with no
    // providerId are staff-managed and fail this check on purpose).
    if (!actor.isStaff) {
      const provider = await this.requireProviderProfile(actor.id);
      if (slot.providerId !== provider.id) {
        throw ApiError.forbidden("You can only manage your own availability slots");
      }
    }
    await availabilityRepository.delete(id);
  }

  /** Providers must have a ServiceProvider profile to manage slots at all. */
  private async requireProviderProfile(userId: string) {
    const provider = await availabilityRepository.findProviderByUserId(userId);
    if (!provider) {
      throw ApiError.forbidden("No provider profile is linked to this account");
    }
    return provider;
  }
}

export const availabilityService = new AvailabilityService();
