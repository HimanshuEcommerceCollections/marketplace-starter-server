import type { Prisma, ServiceConfigOption } from "@prisma/client";
import { serviceConfigRepository } from "./service-config.repository";
import { servicesService } from "../services.service";
import { ApiError } from "../../../utils/api-error";
import { resolveServiceAssets } from "../../../config/service-assets";
import { ConfigStatus } from "../../../enums";
import { ConfigSelectionType } from "../../../enums";
import type {
  CreateConfigGroupDto,
  UpdateConfigGroupDto,
  CreateConfigOptionDto,
  UpdateConfigOptionDto,
  ConfigOptionResponse,
  ConfigGroupResponse,
  ServiceWithConfigResponse,
  PriceLineItem,
  PriceQuoteResponse,
} from "./service-config.types";

type GroupWithOptions = Prisma.ServiceConfigGroupGetPayload<{ include: { options: true } }>;
type ServiceRow = Awaited<ReturnType<typeof servicesService.getById>>;

export class ServiceConfigService {
  // ── serialization ────────────────────────────────────────────────────────
  private serializeOption(o: ServiceConfigOption): ConfigOptionResponse {
    return {
      id: o.id,
      key: o.key,
      label: o.label,
      priceModifier: o.priceModifier,
      description: o.description,
      sortOrder: o.sortOrder,
      status: o.status,
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
      selectionType: g.selectionType,
      isRequired: g.isRequired,
      sortOrder: g.sortOrder,
      status: g.status,
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
      priceAmount: svc.priceAmount,
      fromPrice: svc.fromPrice,
      minBooking: svc.minBooking,
      currency: svc.currency,
      durationMinutes: svc.durationMinutes,
      locationMode: svc.locationMode,
      locationModes: svc.locationModes,
      serviceType: svc.serviceType,
      badges: svc.badges,
      iconPath,
      status: svc.status,
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

    const existing = await serviceConfigRepository.findGroupByServiceAndKey(serviceId, dto.key);
    if (existing) {
      throw ApiError.conflict("A config group with this key already exists for this service");
    }

    // New groups start INACTIVE (schema default) — they must gain >= 1 option
    // before they can be activated.
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

    if (dto.key !== undefined && dto.key !== group.key) {
      const clash = await serviceConfigRepository.findGroupByServiceAndKey(serviceId, dto.key);
      if (clash) {
        throw ApiError.conflict("A config group with this key already exists for this service");
      }
    }

    // A group may only be ACTIVE if it has >= 1 option.
    if (dto.status === ConfigStatus.ACTIVE) {
      const full = await serviceConfigRepository.findGroupWithOptions(groupId);
      if (!full || full.options.length === 0) {
        throw ApiError.badRequest(
          "A config group must have at least one option before it can be activated",
        );
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

  /** Reorder all groups for a service; `groupIds` must be exactly the current set. */
  async reorderGroups(serviceId: string, groupIds: string[]): Promise<ConfigGroupResponse[]> {
    await this.ensureService(serviceId);
    const current = await serviceConfigRepository.findGroupsByService(serviceId);
    this.assertSameSet(current.map((g) => g.id), groupIds, "group");
    await serviceConfigRepository.reorderGroups(groupIds);
    const groups = await serviceConfigRepository.findGroupsByService(serviceId);
    return groups.map((g) => this.serializeGroup(g));
  }

  // ── option mutations (staff) ───────────────────────────────────────────────
  async createOption(
    serviceId: string,
    groupId: string,
    dto: CreateConfigOptionDto,
  ): Promise<ConfigOptionResponse> {
    await this.ensureService(serviceId);
    await this.ensureGroup(serviceId, groupId);

    const existing = await serviceConfigRepository.findOptionByGroupAndKey(groupId, dto.key);
    if (existing) {
      throw ApiError.conflict("A config option with this key already exists in this group");
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
    await this.ensureGroup(serviceId, groupId);
    const option = await this.ensureOption(groupId, optionId);

    if (dto.key !== undefined && dto.key !== option.key) {
      const clash = await serviceConfigRepository.findOptionByGroupAndKey(groupId, dto.key);
      if (clash) {
        throw ApiError.conflict("A config option with this key already exists in this group");
      }
    }

    const updated = await serviceConfigRepository.updateOption(optionId, dto);
    return this.serializeOption(updated);
  }

  async deleteOption(serviceId: string, groupId: string, optionId: string): Promise<void> {
    await this.ensureService(serviceId);
    const group = await this.ensureGroup(serviceId, groupId);
    await this.ensureOption(groupId, optionId);

    // Deleting the last option of an ACTIVE group would break the
    // "ACTIVE ⟹ >= 1 option" invariant — block it (deactivate the group first).
    if (group.status === ConfigStatus.ACTIVE) {
      const full = await serviceConfigRepository.findGroupWithOptions(groupId);
      if (full && full.options.length <= 1) {
        throw ApiError.badRequest(
          "Cannot delete the last option of an active group; deactivate the group first",
        );
      }
    }

    await serviceConfigRepository.deleteOption(optionId);
  }

  /** Reorder options within a group; `optionIds` must be exactly the current set. */
  async reorderOptions(
    serviceId: string,
    groupId: string,
    optionIds: string[],
  ): Promise<ConfigGroupResponse> {
    await this.ensureService(serviceId);
    await this.ensureGroup(serviceId, groupId);
    const full = await serviceConfigRepository.findGroupWithOptions(groupId);
    this.assertSameSet((full?.options ?? []).map((o) => o.id), optionIds, "option");
    await serviceConfigRepository.reorderOptions(optionIds);
    const updated = await serviceConfigRepository.findGroupWithOptions(groupId);
    return this.serializeGroup(updated!);
  }

  // ── pricing ("Option A": base + sum of selected option modifiers) ─────────────
  /**
   * Compute a price quote for a set of selected options. Validates selections
   * against the service's ACTIVE configuration per the selection rules:
   *   - every selected option must be ACTIVE and belong to an ACTIVE group here;
   *   - a SINGLE_SELECT group accepts at most one selection;
   *   - a required ACTIVE group must have at least one selection.
   * Returns the base price, one line item per selected option, and the total.
   */
  async quotePrice(
    serviceId: string,
    optionIds: string[],
    staff = false,
  ): Promise<PriceQuoteResponse> {
    const svc = await this.ensureService(serviceId, staff);
    const groups = await serviceConfigRepository.findGroupsByService(serviceId);

    // Index the only selectable options: ACTIVE options within ACTIVE groups.
    const selectable = new Map<string, { group: GroupWithOptions; option: ServiceConfigOption }>();
    for (const group of groups) {
      if (group.status !== ConfigStatus.ACTIVE) continue;
      for (const option of group.options) {
        if (option.status === ConfigStatus.ACTIVE) {
          selectable.set(option.id, { group, option });
        }
      }
    }

    // Dedupe + validate availability; bucket selections by group.
    const selectedIds = new Set(optionIds);
    const selectedByGroup = new Map<string, number>();
    for (const id of selectedIds) {
      const hit = selectable.get(id);
      if (!hit) {
        throw ApiError.badRequest(`Option "${id}" is not available for this service`);
      }
      selectedByGroup.set(hit.group.id, (selectedByGroup.get(hit.group.id) ?? 0) + 1);
    }

    // Per-group selection rules over ACTIVE groups.
    for (const group of groups) {
      if (group.status !== ConfigStatus.ACTIVE) continue;
      const chosen = selectedByGroup.get(group.id) ?? 0;
      if (group.selectionType === ConfigSelectionType.SINGLE_SELECT && chosen > 1) {
        throw ApiError.badRequest(`"${group.label}" allows only one option`);
      }
      if (group.isRequired && chosen === 0) {
        throw ApiError.badRequest(`"${group.label}" is required`);
      }
    }

    // Build line items in group/option order; total = base + sum(modifiers).
    const lineItems: PriceLineItem[] = [];
    for (const group of groups) {
      if (group.status !== ConfigStatus.ACTIVE) continue;
      for (const option of group.options) {
        if (selectedIds.has(option.id) && option.status === ConfigStatus.ACTIVE) {
          lineItems.push({
            groupId: group.id,
            groupLabel: group.label,
            optionId: option.id,
            optionKey: option.key,
            optionLabel: option.label,
            priceModifier: option.priceModifier,
          });
        }
      }
    }
    const total = lineItems.reduce((sum, li) => sum + li.priceModifier, svc.priceAmount);

    return {
      serviceId: svc.id,
      currency: svc.currency,
      basePrice: svc.priceAmount,
      lineItems,
      total,
    };
  }

  /** A reorder list must be a permutation of the current set (no adds/drops). */
  private assertSameSet(currentIds: string[], providedIds: string[], noun: string): void {
    const current = new Set(currentIds);
    const provided = new Set(providedIds);
    if (
      providedIds.length !== currentIds.length ||
      provided.size !== providedIds.length ||
      ![...provided].every((id) => current.has(id))
    ) {
      throw ApiError.badRequest(
        `The reorder list must contain exactly the current ${noun} ids, each once`,
      );
    }
  }
}

export const serviceConfigService = new ServiceConfigService();
