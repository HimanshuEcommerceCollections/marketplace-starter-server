import { Prisma } from "@prisma/client";
import { areasRepository } from "./areas.repository";
import { ApiError } from "../../utils/api-error";
import { HttpStatus } from "../../constants/http-status";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { slugify } from "../../utils/slugify";
import { isStaffRole } from "../../constants/roles";
import { BookingStatus, GeoStatus, ServiceStatus, UserRole } from "../../enums";
import type {
  AreaDetail,
  AreaLean,
  AreaResponse,
  AreaRollup,
  AreaWithZipCount,
  AreaZipCodesResult,
  AreaZipLookupResult,
  CreateAreaDto,
  ListAreaZipCodesQuery,
  ListAreasQuery,
  UpdateAreaDto,
  ZipCodeLean,
} from "./areas.types";

/**
 * Machine-readable error codes from the API design's error catalogue.
 *
 * `ApiError` does not yet carry a top-level `code` (that edit belongs to the
 * shared src/utils/api-error.ts + error-handler.ts, which this module does not
 * own), so the code travels inside `details` and reaches the client as
 * `errors.code`. The strings are already the catalogue's, so when
 * `ApiError.coded()` lands these call sites move over with no contract change.
 */
export const AreaErrorCode = {
  NOT_FOUND: "AREA_NOT_FOUND",
  NAME_EXISTS: "AREA_NAME_EXISTS",
  SLUG_EXISTS: "AREA_SLUG_EXISTS",
  ARCHIVED_EXISTS: "AREA_ARCHIVED_EXISTS",
  SLUG_UNDERIVABLE: "AREA_SLUG_UNDERIVABLE",
  STATUS_TRANSITION_INVALID: "AREA_STATUS_TRANSITION_INVALID",
  ARCHIVED: "AREA_ARCHIVED",
  NOT_ARCHIVED: "AREA_NOT_ARCHIVED",
  ZIP_CODE_NOT_FOUND: "ZIP_CODE_NOT_FOUND",
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
} as const;

/**
 * Statuses the admin list returns when no `status` filter is supplied. ARCHIVED
 * is reachable only via an explicit `?status=ARCHIVED` — retired markets keep
 * their unique name/slug slot forever, so they must not clutter the default view.
 */
const ADMIN_DEFAULT_STATUSES: GeoStatus[] = [GeoStatus.ACTIVE, GeoStatus.INACTIVE];

/** Statuses a non-staff caller may resolve a `?serviceSlug=` filter against. */
const PUBLIC_SERVICE_STATUSES: ServiceStatus[] = [
  ServiceStatus.ACTIVE,
  ServiceStatus.COMING_SOON,
];

/** "Open" bookings for the archive confirm dialog's blast-radius number. */
const OPEN_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
];

/**
 * GET /areas/:id/zip-codes is deliberately NOT run through buildPagination (whose
 * MAX_LIMIT is 100): paging a picker over 300 ZIPs is unusable. It hard-caps and
 * reports `truncated` instead.
 */
const MAX_AREA_ZIP_CODES = 2000;

/**
 * Row budget for `?includeZipCodes=true` across a whole page of areas. The flag
 * exists for the marketing coverage band (12 markets, ~41 ZIPs); the admin picker
 * uses GET /areas/:id/zip-codes, which has its own per-area cap.
 */
const MAX_INLINE_ZIP_CODES = 2000;

const EMPTY_ROLLUP: AreaRollup = { activeZipCodeCount: 0, serviceCount: 0 };

export class AreasService {
  /** DB row + rollups -> the stable API shape. */
  private serialize(
    area: AreaWithZipCount,
    rollup: AreaRollup,
    zipCodes?: ZipCodeLean[],
  ): AreaResponse {
    return {
      id: area.id,
      name: area.name,
      slug: area.slug,
      stateCode: area.stateCode,
      countryCode: area.countryCode,
      timezone: area.timezone,
      status: area.status,
      sortOrder: area.sortOrder,
      zipCodeCount: area._count.zipCodes,
      activeZipCodeCount: rollup.activeZipCodeCount,
      serviceCount: rollup.serviceCount,
      ...(zipCodes ? { zipCodes } : {}),
      createdAt: area.createdAt,
      updatedAt: area.updatedAt,
    };
  }

  /**
   * Load both rollups for a whole set of areas in TWO queries, never per row.
   * Areas with no matching rows are filled with zeros so the serializer stays
   * total (an ALLOW area with zero ZIPs is "covered area-wide", not missing).
   */
  private async loadRollups(areaIds: string[]): Promise<Map<string, AreaRollup>> {
    const rollups = new Map<string, AreaRollup>();
    if (areaIds.length === 0) return rollups;
    for (const id of areaIds) rollups.set(id, { ...EMPTY_ROLLUP });

    const [activeZips, serviceCounts] = await Promise.all([
      areasRepository.groupActiveZipCounts(areaIds),
      areasRepository.groupServiceCounts(areaIds),
    ]);

    for (const row of activeZips) {
      const entry = rollups.get(row.areaId);
      if (entry) entry.activeZipCodeCount = row.activeZipCodeCount;
    }
    for (const row of serviceCounts) {
      const entry = rollups.get(row.areaId);
      if (entry) entry.serviceCount = row.serviceCount;
    }
    return rollups;
  }

  /** Serialize a single row, fetching its rollups. Used by every mutation reply. */
  private async toResponse(area: AreaWithZipCount): Promise<AreaResponse> {
    const rollups = await this.loadRollups([area.id]);
    return this.serialize(area, rollups.get(area.id) ?? EMPTY_ROLLUP);
  }

  /**
   * Serialize a single row as an AreaDetail. `activeBookingCount` is fetched for
   * staff only — open-booking volume per market is internal data and must not
   * leak through the public by-slug route.
   */
  private async toDetail(
    area: AreaWithZipCount,
    options: { staff: boolean; includeZipCodes: boolean },
  ): Promise<AreaDetail> {
    const [rollups, zipCodes, activeBookingCount] = await Promise.all([
      this.loadRollups([area.id]),
      options.includeZipCodes
        ? areasRepository.findZipCodes(
            { areaId: area.id, status: GeoStatus.ACTIVE },
            MAX_INLINE_ZIP_CODES,
          )
        : Promise.resolve(undefined),
      options.staff
        ? areasRepository.countBookings(area.id, OPEN_BOOKING_STATUSES)
        : Promise.resolve(undefined),
    ]);

    return {
      ...this.serialize(area, rollups.get(area.id) ?? EMPTY_ROLLUP, zipCodes),
      ...(activeBookingCount !== undefined ? { activeBookingCount } : {}),
    };
  }

  /**
   * 404 carrying a machine code. `ApiError.notFound()` takes no `details`, so the
   * constructor is used directly rather than dropping the catalogue's code.
   */
  private notFound(code: string, message: string): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, message, { code });
  }

  private async load(id: string): Promise<AreaWithZipCount> {
    const area = await areasRepository.findById(id);
    if (!area) throw this.notFound(AreaErrorCode.NOT_FOUND, "Area not found");
    return area;
  }

  /**
   * Mutation freeze. Every write path rejects an ARCHIVED row with the same 409,
   * which is what keeps the state space at three statuses instead of six: an
   * archived market has exactly one legal transition, and it is /restore.
   */
  private assertNotArchived(area: AreaWithZipCount): void {
    if (area.status === GeoStatus.ARCHIVED) {
      throw ApiError.conflict(
        `${area.name} is archived. Restore it before making changes.`,
        { code: AreaErrorCode.ARCHIVED, archivedId: area.id },
      );
    }
  }

  private invalidTransition(from: GeoStatus, to: GeoStatus): ApiError {
    return ApiError.conflict(`Invalid status transition: ${from} -> ${to}`, {
      code: AreaErrorCode.STATUS_TRANSITION_INVALID,
      from,
      to,
    });
  }

  /**
   * A name/slug collision. When the colliding row is ARCHIVED the admin gets
   * `archivedId` back so the UI can offer **Restore** — without it the only way
   * past a retired market holding the name is a support ticket.
   */
  private collisionError(
    existing: AreaWithZipCount,
    field: "name" | "slug",
    value: string,
  ): ApiError {
    if (existing.status === GeoStatus.ARCHIVED) {
      return ApiError.conflict(
        `An archived area already uses the ${field} "${value}". Restore it instead.`,
        { code: AreaErrorCode.ARCHIVED_EXISTS, field, archivedId: existing.id },
      );
    }
    return field === "name"
      ? ApiError.conflict(`An area named "${value}" already exists`, {
          code: AreaErrorCode.NAME_EXISTS,
          field,
        })
      : ApiError.conflict(`Slug "${value}" is already in use`, {
          code: AreaErrorCode.SLUG_EXISTS,
          field,
        });
  }

  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const existing = await areasRepository.findByName(name);
    if (existing && existing.id !== exceptId) {
      throw this.collisionError(existing, "name", name);
    }
  }

  private async assertSlugAvailable(slug: string, exceptId?: string): Promise<void> {
    const existing = await areasRepository.findBySlug(slug);
    if (existing && existing.id !== exceptId) {
      throw this.collisionError(existing, "slug", slug);
    }
  }

  /**
   * Backstop for the race the pre-checks above cannot win (two coordinators
   * creating "Dallas" at once). Turns Postgres' unique violation into the same
   * precise 409 instead of the generic "A record with these details already
   * exists" the global handler would emit. Anything else is rethrown untouched.
   */
  private toConflictError(err: unknown, ctx: { name?: string; slug?: string }): unknown {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
      return err;
    }
    const target = err.meta?.target;
    const fields = (
      Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : []
    ).join(",");

    if (fields.includes("slug")) {
      return ApiError.conflict(`Slug "${ctx.slug ?? ""}" is already in use`, {
        code: AreaErrorCode.SLUG_EXISTS,
        field: "slug",
      });
    }
    if (fields.includes("name")) {
      return ApiError.conflict(`An area named "${ctx.name ?? ""}" already exists`, {
        code: AreaErrorCode.NAME_EXISTS,
        field: "name",
      });
    }
    return ApiError.conflict("An area with these details already exists");
  }

  /**
   * Areas where a service is actually available: an area-wide ALLOW, or at least
   * one opted-in ZIP. An ALLOW area whose every ZIP is excluded still counts — the
   * design says surface that as "0 of 14 available", never silently drop it.
   */
  private async availableAreaIds(serviceSlug: string, staff: boolean): Promise<string[]> {
    const service = await areasRepository.findServiceBySlug(serviceSlug);
    if (!service || (!staff && !PUBLIC_SERVICE_STATUSES.includes(service.status))) {
      throw this.notFound(AreaErrorCode.SERVICE_NOT_FOUND, "Service not found");
    }
    const rows = await areasRepository.findAvailableAreaIdsForService(service.id);
    return [...new Set(rows.map((row) => row.areaId))];
  }

  /**
   * List areas. Visibility is role-aware exactly like GET /services: staff may
   * filter by any status; everyone else — including anonymous callers on the
   * marketing coverage band — sees ACTIVE only, and a caller-supplied `status`
   * is ignored rather than honoured, so INACTIVE/ARCHIVED markets can never leak
   * through the public path.
   *
   * Default order is sortOrder asc then name asc, so the admin table and the
   * public band are stable without a sort argument.
   */
  async list(
    query: ListAreasQuery,
    viewerRole?: UserRole,
  ): Promise<{ items: AreaResponse[]; meta: ReturnType<typeof buildMeta> }> {
    const { skip, take, page, limit } = buildPagination(query);
    const staff = viewerRole !== undefined && isStaffRole(viewerRole);

    const where: Prisma.AreaWhereInput = {
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(staff
        ? query.status
          ? { status: query.status }
          : { status: { in: ADMIN_DEFAULT_STATUSES } }
        : { status: GeoStatus.ACTIVE }),
      // An empty `in` matches nothing, which is the right answer for a service
      // with no coverage anywhere.
      ...(query.serviceSlug
        ? { id: { in: await this.availableAreaIds(query.serviceSlug, staff) } }
        : {}),
    };

    const primary: Prisma.AreaOrderByWithRelationInput =
      query.sortBy === "name"
        ? { name: query.sort }
        : query.sortBy === "createdAt"
          ? { createdAt: query.sort }
          : query.sortBy === "updatedAt"
            ? { updatedAt: query.sort }
            : { sortOrder: query.sort };
    // Tie-break by name so equal sortOrder values (the seed uses steps of 10, but
    // nothing forbids duplicates) never produce a nondeterministic page order.
    const orderBy: Prisma.AreaOrderByWithRelationInput[] =
      query.sortBy === "name" ? [primary] : [primary, { name: "asc" }];

    const [items, total] = await Promise.all([
      areasRepository.findMany({ where, orderBy, skip, take }),
      areasRepository.count(where),
    ]);

    const areaIds = items.map((area) => area.id);
    const [rollups, inlineZips] = await Promise.all([
      this.loadRollups(areaIds),
      query.includeZipCodes && areaIds.length > 0
        ? areasRepository.findZipCodesForAreas(
            areaIds,
            GeoStatus.ACTIVE,
            MAX_INLINE_ZIP_CODES,
          )
        : Promise.resolve([]),
    ]);

    // One query, grouped in memory — the alternative is an N+1 at limit=100.
    const zipsByArea = new Map<string, ZipCodeLean[]>();
    if (query.includeZipCodes) {
      for (const id of areaIds) zipsByArea.set(id, []);
      for (const row of inlineZips) {
        zipsByArea.get(row.areaId)?.push({
          id: row.id,
          zipCode: row.zipCode,
          city: row.city,
          stateCode: row.stateCode,
          status: row.status,
        });
      }
    }

    return {
      items: items.map((area) =>
        this.serialize(
          area,
          rollups.get(area.id) ?? EMPTY_ROLLUP,
          query.includeZipCodes ? (zipsByArea.get(area.id) ?? []) : undefined,
        ),
      ),
      meta: buildMeta(page, limit, total),
    };
  }

  /** Staff detail route. */
  async getDetails(id: string, includeZipCodes = false): Promise<AreaDetail> {
    return this.toDetail(await this.load(id), { staff: true, includeZipCodes });
  }

  /**
   * Lookup by natural key. Non-staff callers only ever see ACTIVE markets; an
   * INACTIVE or ARCHIVED slug is a 404 for them, never a different error, so the
   * public surface cannot be probed for retired markets.
   */
  async getDetailsBySlug(
    slug: string,
    staff = false,
    includeZipCodes = false,
  ): Promise<AreaDetail> {
    const area = await areasRepository.findBySlug(slug);
    if (!area || (!staff && area.status !== GeoStatus.ACTIVE)) {
      throw this.notFound(AreaErrorCode.NOT_FOUND, "Area not found");
    }
    return this.toDetail(area, { staff, includeZipCodes });
  }

  /**
   * "Who owns 27601?" — the ZIP-to-market lookup behind the booking form's
   * city/market autofill and the admin ZIP search box.
   *
   * For non-staff an inactive ZIP and an inactive market are both collapsed into
   * the SAME 404 as an unknown ZIP, so the public surface cannot be probed for
   * switched-off geography.
   */
  async lookupByZip(zip: string, staff = false): Promise<AreaZipLookupResult> {
    const notFound = this.notFound(AreaErrorCode.ZIP_CODE_NOT_FOUND, "ZIP code not found");
    const row = await areasRepository.findZipCodeByCode(zip);
    if (!row) throw notFound;
    if (
      !staff &&
      (row.status !== GeoStatus.ACTIVE || row.area.status !== GeoStatus.ACTIVE)
    ) {
      throw notFound;
    }

    const area: AreaLean = {
      id: row.area.id,
      name: row.area.name,
      slug: row.area.slug,
      status: row.area.status,
      stateCode: row.area.stateCode,
      countryCode: row.area.countryCode,
      timezone: row.area.timezone,
    };
    return {
      area,
      zipCode: {
        id: row.id,
        zipCode: row.zipCode,
        city: row.city,
        stateCode: row.stateCode,
        status: row.status,
      },
    };
  }

  /**
   * The coverage picker's ZIP list for one market. Capped rather than paginated,
   * and `truncated` tells the UI to fall back to search instead of silently
   * showing a partial list.
   */
  async listZipCodes(
    areaId: string,
    query: ListAreaZipCodesQuery,
  ): Promise<AreaZipCodesResult> {
    await this.load(areaId); // 404s before any ZIP work

    // Split search on the input shape: an OR of `LIKE 'x%'` and `ILIKE '%x%'` can
    // never use a btree, so each branch targets its own text_pattern_ops index.
    const where: Prisma.ZipCodeWhereInput = {
      areaId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? /^\d+$/.test(query.search)
          ? { zipCode: { startsWith: query.search } }
          : { city: { startsWith: query.search, mode: "insensitive" } }
        : {}),
    };

    const rows = await areasRepository.findZipCodes(where, MAX_AREA_ZIP_CODES + 1);
    const truncated = rows.length > MAX_AREA_ZIP_CODES;
    return {
      items: truncated ? rows.slice(0, MAX_AREA_ZIP_CODES) : rows,
      truncated,
    };
  }

  /** Create a market. Starts ACTIVE (schema default); slug derives from the name. */
  async create(dto: CreateAreaDto): Promise<AreaResponse> {
    await this.assertNameAvailable(dto.name);

    const slug = dto.slug ?? slugify(dto.name);
    if (!slug) {
      throw ApiError.badRequest(
        "Could not generate a slug from the name; please provide a slug explicitly",
        { code: AreaErrorCode.SLUG_UNDERIVABLE },
      );
    }
    await this.assertSlugAvailable(slug);

    try {
      const created = await areasRepository.create({
        name: dto.name,
        slug,
        ...(dto.stateCode !== undefined ? { stateCode: dto.stateCode } : {}),
        ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      });
      // A brand-new areaId cannot be referenced by a ZipCode or a coverage rule
      // yet, so both rollups are provably zero — no queries needed.
      return this.serialize(created, EMPTY_ROLLUP);
    } catch (err) {
      throw this.toConflictError(err, { name: dto.name, slug });
    }
  }

  /** Update editable fields (never status). Re-checks name/slug uniqueness. */
  async update(id: string, dto: UpdateAreaDto): Promise<AreaResponse> {
    const existing = await this.load(id);
    this.assertNotArchived(existing);

    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, id);
    }
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      await this.assertSlugAvailable(dto.slug, id);
    }

    const data: Prisma.AreaUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.stateCode !== undefined) data.stateCode = dto.stateCode;
    if (dto.countryCode !== undefined) data.countryCode = dto.countryCode;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    try {
      return await this.toResponse(await areasRepository.update(id, data));
    } catch (err) {
      throw this.toConflictError(err, { name: dto.name, slug: dto.slug });
    }
  }

  /** INACTIVE -> ACTIVE. An archived market must be restored, not activated. */
  async activate(id: string): Promise<AreaResponse> {
    const existing = await this.load(id);
    this.assertNotArchived(existing);
    if (existing.status === GeoStatus.ACTIVE) {
      throw this.invalidTransition(existing.status, GeoStatus.ACTIVE);
    }
    return this.toResponse(await areasRepository.update(id, { status: GeoStatus.ACTIVE }));
  }

  /**
   * ACTIVE -> INACTIVE. This is the whole-market kill switch: the resolver's area
   * gate makes every ZIP beneath it unbookable while it is paused, and nothing is
   * written down into the children, so re-activating restores the exact prior
   * state (including ZIPs an admin had deliberately switched off).
   */
  async deactivate(id: string): Promise<AreaResponse> {
    const existing = await this.load(id);
    this.assertNotArchived(existing);
    if (existing.status === GeoStatus.INACTIVE) {
      throw this.invalidTransition(existing.status, GeoStatus.INACTIVE);
    }
    return this.toResponse(
      await areasRepository.update(id, { status: GeoStatus.INACTIVE }),
    );
  }

  /**
   * Retirement. There is no hard delete anywhere in this module — bookings and
   * ZIPs hold Restrict FKs, so ARCHIVED *is* the delete.
   *
   * Deliberately NOT blocked by live ZIPs or open bookings. The area gate makes
   * every ZIP beneath an archived market unbookable at read time, and the ZIP and
   * coverage rows are left untouched so restore is lossless. A block would create
   * permanently un-archivable rows: every seeded market owns ACTIVE ZIPs, so a
   * "no active ZIPs" precondition would reject all twelve of them forever. The
   * warning path is data, not a veto — AreaDetail carries `activeZipCodeCount` and
   * `activeBookingCount` so the confirm dialog can state the real blast radius.
   */
  async archive(id: string): Promise<AreaResponse> {
    const existing = await this.load(id);
    if (existing.status === GeoStatus.ARCHIVED) {
      throw this.invalidTransition(existing.status, GeoStatus.ARCHIVED);
    }
    return this.toResponse(
      await areasRepository.update(id, { status: GeoStatus.ARCHIVED }),
    );
  }

  /**
   * ARCHIVED -> INACTIVE. The only way out of ARCHIVED.
   *
   * Restore lands on INACTIVE, not ACTIVE, on purpose: restore is how an admin
   * reclaims a retired market's name/slug slot ("restore, then rename"), and a
   * market that has been retired for months must not silently reappear on the
   * public coverage band and become bookable mid-edit. Publishing it is the very
   * next call to /activate, which is an explicit, audited decision.
   */
  async restore(id: string): Promise<AreaResponse> {
    const existing = await this.load(id);
    if (existing.status !== GeoStatus.ARCHIVED) {
      throw ApiError.conflict(
        `${existing.name} is not archived, so it cannot be restored.`,
        { code: AreaErrorCode.NOT_ARCHIVED, status: existing.status },
      );
    }
    return this.toResponse(
      await areasRepository.update(id, { status: GeoStatus.INACTIVE }),
    );
  }

  /**
   * Generic lifecycle change. Delegates to the named transitions so there is
   * exactly one implementation of every guard — in particular ARCHIVED -> ACTIVE
   * through here is still refused with AREA_ARCHIVED ("restore it first").
   *
   * `viewerRole` is required because POST /:id/status is staff-wide while
   * POST /:id/archive is admin-only: without this check the generic route would
   * be a one-body bypass of that gate.
   */
  setStatus(id: string, to: GeoStatus, viewerRole?: UserRole): Promise<AreaResponse> {
    if (to === GeoStatus.ACTIVE) return this.activate(id);
    if (to === GeoStatus.INACTIVE) return this.deactivate(id);
    if (viewerRole !== UserRole.SYSTEM_ADMIN) {
      throw ApiError.forbidden("Only a system admin can archive an area");
    }
    return this.archive(id);
  }
}

export const areasService = new AreasService();
