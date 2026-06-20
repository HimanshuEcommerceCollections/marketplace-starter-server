import { prisma } from "../../../db/client";
import type { Prisma } from "@prisma/client";

export class ServiceConfigRepository {
  // ── Groups ─────────────────────────────────────────────────────────────────
  /** All groups for a service, each with options, both ordered by sortOrder. */
  findGroupsByService(serviceId: string) {
    return prisma.serviceConfigGroup.findMany({
      where: { serviceId },
      orderBy: { sortOrder: "asc" },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
  }
  findGroupById(id: string) {
    return prisma.serviceConfigGroup.findUnique({ where: { id } });
  }
  findGroupWithOptions(id: string) {
    return prisma.serviceConfigGroup.findUnique({
      where: { id },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
  }
  findGroupByServiceAndKey(serviceId: string, key: string) {
    return prisma.serviceConfigGroup.findUnique({
      where: { serviceId_key: { serviceId, key } },
    });
  }
  createGroup(data: Prisma.ServiceConfigGroupUncheckedCreateInput) {
    return prisma.serviceConfigGroup.create({ data });
  }
  updateGroup(id: string, data: Prisma.ServiceConfigGroupUncheckedUpdateInput) {
    return prisma.serviceConfigGroup.update({ where: { id }, data });
  }
  deleteGroup(id: string) {
    return prisma.serviceConfigGroup.delete({ where: { id } });
  }

  // ── Options ──────────────────────────────────────────────────────────────────
  findOptionById(id: string) {
    return prisma.serviceConfigOption.findUnique({ where: { id } });
  }
  findOptionByGroupAndKey(groupId: string, key: string) {
    return prisma.serviceConfigOption.findUnique({
      where: { groupId_key: { groupId, key } },
    });
  }
  createOption(data: Prisma.ServiceConfigOptionUncheckedCreateInput) {
    return prisma.serviceConfigOption.create({ data });
  }
  updateOption(id: string, data: Prisma.ServiceConfigOptionUncheckedUpdateInput) {
    return prisma.serviceConfigOption.update({ where: { id }, data });
  }
  deleteOption(id: string) {
    return prisma.serviceConfigOption.delete({ where: { id } });
  }

  // ── Reorder (sortOrder = position in the provided id list) ────────────────────
  /** Set each group's sortOrder to its index in `orderedIds`, atomically. */
  reorderGroups(orderedIds: string[]) {
    return prisma.$transaction(
      orderedIds.map((id, i) =>
        prisma.serviceConfigGroup.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
  }
  /** Set each option's sortOrder to its index in `orderedIds`, atomically. */
  reorderOptions(orderedIds: string[]) {
    return prisma.$transaction(
      orderedIds.map((id, i) =>
        prisma.serviceConfigOption.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
  }
}

export const serviceConfigRepository = new ServiceConfigRepository();
