import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import { GeoStatus, type BookingStatus, type ServiceStatus } from "../../enums";
import type { AreaWithZipCount, ZipCodeLean } from "./areas.types";

/**
 * Attached to every Area read so the serializer always has its total ZIP rollup.
 * One extra aggregate per query (Prisma folds `_count` into the same round trip) —
 * not an N+1.
 */
const withZipCount = { _count: { select: { zipCodes: true } } } as const;

/** The ZIP columns the picker, the coverage band and the ZIP lookup need. */
const zipLeanSelect = {
  id: true,
  zipCode: true,
  city: true,
  stateCode: true,
  status: true,
} as const;

export class AreasRepository {
  findMany(args: {
    where: Prisma.AreaWhereInput;
    orderBy: Prisma.AreaOrderByWithRelationInput[];
    skip: number;
    take: number;
  }): Promise<AreaWithZipCount[]> {
    return prisma.area.findMany({ ...args, include: withZipCount });
  }

  count(where?: Prisma.AreaWhereInput): Promise<number> {
    return prisma.area.count({ where });
  }

  findById(id: string): Promise<AreaWithZipCount | null> {
    return prisma.area.findUnique({ where: { id }, include: withZipCount });
  }

  findByName(name: string): Promise<AreaWithZipCount | null> {
    return prisma.area.findUnique({ where: { name }, include: withZipCount });
  }

  findBySlug(slug: string): Promise<AreaWithZipCount | null> {
    return prisma.area.findUnique({ where: { slug }, include: withZipCount });
  }

  create(data: Prisma.AreaUncheckedCreateInput): Promise<AreaWithZipCount> {
    return prisma.area.create({ data, include: withZipCount });
  }

  update(id: string, data: Prisma.AreaUncheckedUpdateInput): Promise<AreaWithZipCount> {
    return prisma.area.update({ where: { id }, data, include: withZipCount });
  }

  // ── Rollups: one batched query per request, keyed by areaId ────────────────

  /**
   * ACTIVE ZIPs per area. A filtered `_count` on the Area row would need the
   * `filteredRelationCount` preview feature, which this schema does not enable, so
   * this is the design's own grouped query: an index-only scan over
   * ZipCode_areaId_status_idx, ~one row per area. `count(*)::int` (not the default
   * bigint) so the value arrives as a JS number rather than a BigInt that
   * JSON.stringify would throw on.
   */
  groupActiveZipCounts(
    areaIds: string[],
  ): Promise<Array<{ areaId: string; activeZipCodeCount: number }>> {
    return prisma.$queryRaw<Array<{ areaId: string; activeZipCodeCount: number }>>`
      SELECT "areaId", count(*)::int AS "activeZipCodeCount"
      FROM "ZipCode"
      WHERE "areaId" IN (${Prisma.join(areaIds)}) AND "status" = ${GeoStatus.ACTIVE}::"GeoStatus"
      GROUP BY "areaId"`;
  }

  /**
   * Services that reach each area, UNIONing both coverage tiers. Raw SQL because
   * the UNION is the point: counting ServiceAreaCoverage alone undercounts every
   * zip-only (area-DENY + zip-ALLOW) service. UNION — not UNION ALL — dedupes the
   * (areaId, serviceId) pair, so a service with both an area rule and zip rules
   * counts once.
   */
  groupServiceCounts(
    areaIds: string[],
  ): Promise<Array<{ areaId: string; serviceCount: number }>> {
    return prisma.$queryRaw<Array<{ areaId: string; serviceCount: number }>>`
      SELECT s."areaId", count(*)::int AS "serviceCount"
      FROM (
        SELECT "areaId", "serviceId" FROM "ServiceAreaCoverage"
         WHERE "areaId" IN (${Prisma.join(areaIds)}) AND "effect" = 'ALLOW'
        UNION
        SELECT "areaId", "serviceId" FROM "ServiceZipCoverage"
         WHERE "areaId" IN (${Prisma.join(areaIds)}) AND "effect" = 'ALLOW'
      ) s
      GROUP BY s."areaId"`;
  }

  /** Bookings in this market, restricted to the statuses the caller considers open. */
  countBookings(areaId: string, statuses: BookingStatus[]): Promise<number> {
    return prisma.booking.count({ where: { areaId, status: { in: statuses } } });
  }

  // ── ZIP reads (this module owns /areas/lookup and /areas/:id/zip-codes) ────

  findZipCodes(
    where: Prisma.ZipCodeWhereInput,
    take: number,
  ): Promise<ZipCodeLean[]> {
    return prisma.zipCode.findMany({
      where,
      select: zipLeanSelect,
      orderBy: { zipCode: "asc" },
      take,
    });
  }

  /** Inlined ZIPs for a whole page of areas — one query, grouped in the service. */
  findZipCodesForAreas(
    areaIds: string[],
    status: GeoStatus,
    take: number,
  ): Promise<Array<ZipCodeLean & { areaId: string }>> {
    return prisma.zipCode.findMany({
      where: { areaId: { in: areaIds }, status },
      select: { ...zipLeanSelect, areaId: true },
      orderBy: [{ areaId: "asc" }, { zipCode: "asc" }],
      take,
    });
  }

  /** "Who owns 27601?" — the ZIP plus its owning market, in one round trip. */
  findZipCodeByCode(zipCode: string) {
    return prisma.zipCode.findUnique({
      where: { zipCode },
      select: {
        ...zipLeanSelect,
        area: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            stateCode: true,
            countryCode: true,
            timezone: true,
          },
        },
      },
    });
  }

  // ── Service coverage reads for ?serviceSlug= ───────────────────────────────

  findServiceBySlug(
    slug: string,
  ): Promise<{ id: string; status: ServiceStatus } | null> {
    return prisma.service.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
  }

  /**
   * Areas where this service is available: an area-wide ALLOW, or at least one
   * opted-in ZIP. Same UNION as the rollup above, for the same reason.
   */
  findAvailableAreaIdsForService(serviceId: string): Promise<Array<{ areaId: string }>> {
    return prisma.$queryRaw<Array<{ areaId: string }>>`
      SELECT "areaId" FROM "ServiceAreaCoverage"
       WHERE "serviceId" = ${serviceId} AND "effect" = 'ALLOW'
      UNION
      SELECT "areaId" FROM "ServiceZipCoverage"
       WHERE "serviceId" = ${serviceId} AND "effect" = 'ALLOW'`;
  }
}

export const areasRepository = new AreasRepository();
