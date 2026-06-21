import type { Prisma, Service } from "@prisma/client";
import { servicesRepository } from "./services.repository";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { slugify } from "../../utils/slugify";
import { resolveServiceImageAssets } from "../../config/service-image-assets";
import { isStaffRole } from "../../constants/roles";
import { ServiceStatus } from "../../enums";
import type { UserRole } from "../../enums";
import type {
  CreateServiceDto,
  UpdateServiceDto,
  ListServicesQuery,
  ServiceResponse,
} from "./services.types";

/** Allowed lifecycle transitions. Any pair not listed here is rejected. */
const ALLOWED_TRANSITIONS: Record<ServiceStatus, ServiceStatus[]> = {
  [ServiceStatus.DRAFT]: [ServiceStatus.ACTIVE, ServiceStatus.COMING_SOON],
  [ServiceStatus.ACTIVE]: [
    ServiceStatus.DRAFT,
    ServiceStatus.COMING_SOON,
    ServiceStatus.INACTIVE,
  ],
  [ServiceStatus.COMING_SOON]: [
    ServiceStatus.DRAFT,
    ServiceStatus.ACTIVE,
    ServiceStatus.INACTIVE,
  ],
  [ServiceStatus.INACTIVE]: [ServiceStatus.ACTIVE, ServiceStatus.COMING_SOON],
};

/** Statuses visible to non-staff (anonymous + customers) on public endpoints. */
const PUBLIC_STATUSES: ServiceStatus[] = [
  ServiceStatus.ACTIVE,
  ServiceStatus.COMING_SOON,
];

export class ServicesService {
  /** Merge DB row with config-resolved image assets into the API response shape. */
  private serialize(service: Service): ServiceResponse {
    const assets = resolveServiceImageAssets(service.slug);
    return {
      id: service.id,
      name: service.name,
      slug: service.slug,
      description: service.description,
      basePrice: service.priceAmount,
      durationMinutes: service.durationMinutes,
      status: service.status,
      iconPath: assets.iconPath,
      coverImages: assets.coverImages,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    };
  }

  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const existing = await servicesRepository.findByName(name);
    if (existing && existing.id !== exceptId) {
      throw ApiError.conflict("Service name already exists");
    }
  }

  private async assertSlugAvailable(slug: string, exceptId?: string): Promise<void> {
    const existing = await servicesRepository.findBySlug(slug);
    if (existing && existing.id !== exceptId) {
      throw ApiError.conflict("Slug already exists");
    }
  }

  /**
   * List services. Visibility is role-aware: staff may filter by any status (or
   * see all); everyone else sees only publicly-visible services
   * (ACTIVE + COMING_SOON). DRAFT and INACTIVE are never exposed to non-staff.
   */
  async list(
    query: ListServicesQuery,
    viewerRole?: UserRole,
  ): Promise<{ items: ServiceResponse[]; meta: ReturnType<typeof buildMeta> }> {
    const { skip, take, page, limit } = buildPagination(query);
    const staff = viewerRole !== undefined && isStaffRole(viewerRole);

    const where: Prisma.ServiceWhereInput = {
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
      servicesRepository.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: query.sort },
      }),
      servicesRepository.count(where),
    ]);

    return {
      items: items.map((s) => this.serialize(s)),
      meta: buildMeta(page, limit, total),
    };
  }

  /**
   * Raw service row for INTERNAL callers (booking-config serializer, bookings).
   * @param staff defaults to true so internal callers bypass the public
   *   visibility check. Public callers pass their real staff flag; non-staff get
   *   a 404 for services that are not publicly visible (DRAFT/INACTIVE).
   */
  async getById(id: string, staff = true): Promise<Service> {
    const service = await servicesRepository.findById(id);
    if (!service) throw ApiError.notFound("Service not found");
    if (!staff && !PUBLIC_STATUSES.includes(service.status)) {
      throw ApiError.notFound("Service not found");
    }
    return service;
  }

  /** Serialized details for the staff management detail route. */
  async getDetails(id: string): Promise<ServiceResponse> {
    const service = await servicesRepository.findById(id);
    if (!service) throw ApiError.notFound("Service not found");
    return this.serialize(service);
  }

  /**
   * Public single-service lookup by slug (for the customer detail/booking pages).
   * Non-staff only see publicly-visible services (ACTIVE/COMING_SOON).
   */
  async getDetailsBySlug(slug: string, staff = false): Promise<ServiceResponse> {
    const service = await servicesRepository.findBySlug(slug);
    if (!service) throw ApiError.notFound("Service not found");
    if (!staff && !PUBLIC_STATUSES.includes(service.status)) {
      throw ApiError.notFound("Service not found");
    }
    return this.serialize(service);
  }

  /** Create a service. Defaults to DRAFT; `publish: true` creates it ACTIVE. */
  async create(dto: CreateServiceDto): Promise<ServiceResponse> {
    await this.assertNameAvailable(dto.name);

    const slug = dto.slug ?? slugify(dto.name);
    if (!slug) {
      throw ApiError.badRequest(
        "Could not generate a slug from the name; please provide a slug explicitly",
      );
    }
    await this.assertSlugAvailable(slug);

    const service = await servicesRepository.create({
      name: dto.name,
      slug,
      description: dto.description,
      priceAmount: dto.basePrice,
      ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
      status: dto.publish ? ServiceStatus.ACTIVE : ServiceStatus.DRAFT,
    });
    return this.serialize(service);
  }

  /** Update editable fields (not status). Re-checks name/slug uniqueness. */
  async update(id: string, dto: UpdateServiceDto): Promise<ServiceResponse> {
    const existing = await servicesRepository.findById(id);
    if (!existing) throw ApiError.notFound("Service not found");

    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, id);
    }
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      await this.assertSlugAvailable(dto.slug, id);
    }

    const data: Prisma.ServiceUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.basePrice !== undefined) data.priceAmount = dto.basePrice;
    if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;

    const updated = await servicesRepository.update(id, data);
    return this.serialize(updated);
  }

  /** Move to ACTIVE (shortcut; valid from DRAFT|COMING_SOON|INACTIVE). */
  publish(id: string): Promise<ServiceResponse> {
    return this.transition(id, ServiceStatus.ACTIVE);
  }

  /** Move to INACTIVE (valid from ACTIVE|COMING_SOON). */
  deactivate(id: string): Promise<ServiceResponse> {
    return this.transition(id, ServiceStatus.INACTIVE);
  }

  /** Generic lifecycle change to any target status, subject to the transition map. */
  setStatus(id: string, to: ServiceStatus): Promise<ServiceResponse> {
    return this.transition(id, to);
  }

  private async transition(id: string, to: ServiceStatus): Promise<ServiceResponse> {
    const existing = await servicesRepository.findById(id);
    if (!existing) throw ApiError.notFound("Service not found");

    if (!ALLOWED_TRANSITIONS[existing.status].includes(to)) {
      throw ApiError.conflict(
        `Invalid status transition: ${existing.status} -> ${to}`,
      );
    }

    const updated = await servicesRepository.update(id, { status: to });
    return this.serialize(updated);
  }
}

export const servicesService = new ServicesService();
