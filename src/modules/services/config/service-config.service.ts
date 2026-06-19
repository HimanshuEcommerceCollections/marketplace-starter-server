import type { Prisma, ServiceConfigOption } from "@prisma/client";
import { serviceConfigRepository } from "./service-config.repository";
import { servicesService } from "../services.service";
import { ApiError } from "../../../utils/api-error";
import { resolveServiceAssets } from "../../../config/service-assets";
import { ConfigInputType } from "../../../enums";
import type {
  CreateConfigGroupDto,
  UpdateConfigGroupDto,
  CreateConfigOptionDto,
  UpdateConfigOptionDto,
  ConfigOptionResponse,
  ConfigGroupResponse,
  ServiceWithConfigResponse,
} from "./service-config.types";

type GroupWithOptions = Prisma.ServiceConfigGroupGetPayload<{ include: { options: true } }>;
type ServiceRow = Awaited<ReturnType<typeof servicesService.getById>>;

/** Input types that own an options[] list. QUANTITY/TOGGLE are modeled but not yet
 *  accepted by the API (design decision — no real data uses them). */
const OPTION_BEARING: ConfigInputType[] = [ConfigInputType.SELECT, ConfigInputType.MULTISELECT];

export class ServiceConfigService {
  // ── serialization ────────────────────────────────────────────────────────
  private serializeOption(o: ServiceConfigOption): ConfigOptionResponse {
    return {
      id: o.id,
      key: o.key,
      label: o.label,
      priceDelta: o.priceDelta,
      isDefault: o.isDefault,
      sortOrder: o.sortOrder,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  }

  private serializeGroup(g: GroupWithOptions): ConfigGroupResponse {
    return {
      id: g.id,
      serviceId: g.serviceId,
      key: g.key,
      label: g.label,
      inputType: g.inputType,
      applies: g.applies,
      isRequired: g.isRequired,
      sortOrder: g.sortOrder,
      priceDelta: g.priceDelta,
      selectMin: g.selectMin,
      selectMax: g.selectMax,
      quantityMin: g.quantityMin,
      quantityMax: g.quantityMax,
      quantityStep: g.quantityStep,
      options: g.options.map((o) => this.serializeOption(o)),
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }

  private serializeServiceWithConfig(
    svc: ServiceRow,
    groups: GroupWithOptions[],
  ): ServiceWithConfigResponse {
    const { iconPath } = resolveServiceAssets(svc.slug);
    return {
      id: svc.id,
      name: svc.name,
      slug: svc.slug,
      pricingRef: svc.pricingRef,
      summary: svc.summary,
      description: svc.description,
      categoryId: svc.categoryId,
      priceAmount: svc.priceAmount,
      fromPrice: svc.fromPrice,
      minBooking: svc.minBooking,
      currency: svc.currency,
      durationMinutes: svc.durationMinutes,
      locationMode: svc.locationMode,
      locationModes: svc.locationModes,
      serviceType: svc.serviceType,
      comingSoon: svc.comingSoon,
      badges: svc.badges,
      iconPath,
      isActive: svc.isActive,
      configGroups: groups.map((g) => this.serializeGroup(g)),
      createdAt: svc.createdAt,
      updatedAt: svc.updatedAt,
    };
  }

  // ── ownership / existence guards ───────────────────────────────────────────
  /** Assert the service exists (and, for non-staff, is publicly visible). Returns the row. */
  private ensureService(serviceId: string, staff = true) {
    return servicesService.getById(serviceId, staff);
  }

  private async ensureGroup(serviceId: string, groupId: string) {
    const group = await serviceConfigRepository.findGroupById(groupId);
    if (!group || group.serviceId !== serviceId) {
      throw ApiError.notFound("Config group not found");
    }
    return group;
  }

  private async ensureOption(groupId: string, optionId: string) {
    const option = await serviceConfigRepository.findOptionById(optionId);
    if (!option || option.groupId !== groupId) {
      throw ApiError.notFound("Config option not found");
    }
    return option;
  }

  private assertSupportedInput(inputType: ConfigInputType) {
    if (!OPTION_BEARING.includes(inputType)) {
      throw ApiError.badRequest(
        "QUANTITY and TOGGLE input types are not supported yet; use SELECT or MULTISELECT",
      );
    }
  }

  // ── reads ────────────────────────────────────────────────────────────────
  async listGroups(serviceId: string, staff = false): Promise<ConfigGroupResponse[]> {
    await this.ensureService(serviceId, staff);
    const groups = await serviceConfigRepository.findGroupsByService(serviceId);
    return groups.map((g) => this.serializeGroup(g));
  }

  async getServiceWithConfig(
    serviceId: string,
    staff = false,
  ): Promise<ServiceWithConfigResponse> {
    const svc = await this.ensureService(serviceId, staff);
    const groups = await serviceConfigRepository.findGroupsByService(serviceId);
    return this.serializeServiceWithConfig(svc, groups);
  }

  // ── group mutations (staff) ────────────────────────────────────────────────
  async createGroup(serviceId: string, dto: CreateConfigGroupDto): Promise<ConfigGroupResponse> {
    await this.ensureService(serviceId);
    this.assertSupportedInput(dto.inputType);

    const existing = await serviceConfigRepository.findGroupByServiceAndKey(serviceId, dto.key);
    if (existing) {
      throw ApiError.conflict("A config group with this key already exists for this service");
    }

    const created = await serviceConfigRepository.createGroup({ serviceId, ...dto });
    const full = await serviceConfigRepository.findGroupWithOptions(created.id);
    return this.serializeGroup(full!);
  }

  async updateGroup(
    serviceId: string,
    groupId: string,
    dto: UpdateConfigGroupDto,
  ): Promise<ConfigGroupResponse> {
    await this.ensureService(serviceId);
    const group = await this.ensureGroup(serviceId, groupId);

    if (dto.inputType !== undefined) this.assertSupportedInput(dto.inputType);
    if (dto.key !== undefined && dto.key !== group.key) {
      const clash = await serviceConfigRepository.findGroupByServiceAndKey(serviceId, dto.key);
      if (clash) {
        throw ApiError.conflict("A config group with this key already exists for this service");
      }
    }

    await serviceConfigRepository.updateGroup(groupId, dto);
    const full = await serviceConfigRepository.findGroupWithOptions(groupId);
    return this.serializeGroup(full!);
  }

  async deleteGroup(serviceId: string, groupId: string): Promise<void> {
    await this.ensureService(serviceId);
    await this.ensureGroup(serviceId, groupId);
    await serviceConfigRepository.deleteGroup(groupId); // cascades to options
  }

  // ── option mutations (staff) ───────────────────────────────────────────────
  async createOption(
    serviceId: string,
    groupId: string,
    dto: CreateConfigOptionDto,
  ): Promise<ConfigOptionResponse> {
    await this.ensureService(serviceId);
    const group = await this.ensureGroup(serviceId, groupId);
    if (!OPTION_BEARING.includes(group.inputType)) {
      throw ApiError.badRequest("This group's input type does not support options");
    }

    const existing = await serviceConfigRepository.findOptionByGroupAndKey(groupId, dto.key);
    if (existing) {
      throw ApiError.conflict("A config option with this key already exists in this group");
    }

    // "At most one default per SELECT": clear siblings before setting a new default.
    if (dto.isDefault && group.inputType === ConfigInputType.SELECT) {
      await serviceConfigRepository.clearDefaults(groupId);
    }

    const created = await serviceConfigRepository.createOption({ groupId, ...dto });
    return this.serializeOption(created);
  }

  async updateOption(
    serviceId: string,
    groupId: string,
    optionId: string,
    dto: UpdateConfigOptionDto,
  ): Promise<ConfigOptionResponse> {
    await this.ensureService(serviceId);
    const group = await this.ensureGroup(serviceId, groupId);
    const option = await this.ensureOption(groupId, optionId);

    if (dto.key !== undefined && dto.key !== option.key) {
      const clash = await serviceConfigRepository.findOptionByGroupAndKey(groupId, dto.key);
      if (clash) {
        throw ApiError.conflict("A config option with this key already exists in this group");
      }
    }

    if (dto.isDefault === true && group.inputType === ConfigInputType.SELECT) {
      await serviceConfigRepository.clearDefaults(groupId);
    }

    const updated = await serviceConfigRepository.updateOption(optionId, dto);
    return this.serializeOption(updated);
  }

  async deleteOption(serviceId: string, groupId: string, optionId: string): Promise<void> {
    await this.ensureService(serviceId);
    await this.ensureGroup(serviceId, groupId);
    await this.ensureOption(groupId, optionId);
    await serviceConfigRepository.deleteOption(optionId);
  }
}

export const serviceConfigService = new ServiceConfigService();
