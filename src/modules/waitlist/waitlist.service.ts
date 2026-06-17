import type { Prisma } from "@prisma/client";
import { waitlistRepository } from "./waitlist.repository";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { WaitlistStatus } from "../../enums";
import type { JoinWaitlistDto, ListWaitlistQuery } from "./waitlist.types";

export class WaitlistService {
  async join(userId: string, dto: JoinWaitlistDto) {
    const existing = await waitlistRepository.findByServiceAndUser(
      dto.serviceId,
      userId,
    );
    if (existing) {
      if (existing.status === WaitlistStatus.ACTIVE) {
        throw ApiError.conflict("You are already on the waitlist for this service");
      }
      // Re-activate a previously cancelled/expired entry.
      return waitlistRepository.update(existing.id, {
        status: WaitlistStatus.ACTIVE,
        desiredDate: dto.desiredDate ?? null,
        notifiedAt: null,
      });
    }
    return waitlistRepository.create({
      serviceId: dto.serviceId,
      userId,
      desiredDate: dto.desiredDate,
    });
  }

  async list(query: ListWaitlistQuery, scope?: { userId?: string }) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.WaitlistEntryWhereInput = {
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(scope?.userId ? { userId: scope.userId } : {}),
    };
    const [items, total] = await Promise.all([
      waitlistRepository.findMany({ where, skip, take, orderBy: { createdAt: "asc" } }),
      waitlistRepository.count(where),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
  }

  async leave(id: string, userId: string) {
    const entry = await waitlistRepository.findById(id);
    if (!entry) throw ApiError.notFound("Waitlist entry not found");
    if (entry.userId !== userId) {
      throw ApiError.forbidden("You cannot modify this waitlist entry");
    }
    return waitlistRepository.update(id, { status: WaitlistStatus.CANCELLED });
  }
}

export const waitlistService = new WaitlistService();
