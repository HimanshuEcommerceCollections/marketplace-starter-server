import type { Request, Response } from "express";
import { serviceConfigService } from "./service-config.service";
import { sendSuccess } from "../../../utils/api-response";
import { HttpStatus } from "../../../constants/http-status";
import { isStaffRole } from "../../../constants/roles";
import type {
  CreateConfigGroupDto,
  UpdateConfigGroupDto,
  CreateConfigOptionDto,
  UpdateConfigOptionDto,
  ReorderGroupsDto,
  ReorderOptionsDto,
  PriceQuoteDto,
} from "./service-config.types";

export class ServiceConfigController {
  // Reads (role-aware visibility via optionalAuthenticate).
  getServiceConfig = async (req: Request, res: Response) => {
    const staff = !!req.user && isStaffRole(req.user.role);
    const data = await serviceConfigService.getServiceWithConfig(req.params.serviceId, staff);
    sendSuccess(res, data, "Service configuration fetched");
  };

  listGroups = async (req: Request, res: Response) => {
    const staff = !!req.user && isStaffRole(req.user.role);
    const data = await serviceConfigService.listGroups(req.params.serviceId, staff);
    sendSuccess(res, data, "Config groups fetched");
  };

  // Price quote for a set of selected options ("Option A": base + modifiers).
  quotePrice = async (req: Request, res: Response) => {
    const staff = !!req.user && isStaffRole(req.user.role);
    const { optionIds } = req.body as PriceQuoteDto;
    const quote = await serviceConfigService.quotePrice(req.params.serviceId, optionIds, staff);
    sendSuccess(res, quote, "Price quoted");
  };

  // Group mutations (staff).
  createGroup = async (req: Request, res: Response) => {
    const group = await serviceConfigService.createGroup(
      req.params.serviceId,
      req.body as CreateConfigGroupDto,
    );
    sendSuccess(res, group, "Config group created", HttpStatus.CREATED);
  };

  updateGroup = async (req: Request, res: Response) => {
    const group = await serviceConfigService.updateGroup(
      req.params.serviceId,
      req.params.groupId,
      req.body as UpdateConfigGroupDto,
    );
    sendSuccess(res, group, "Config group updated");
  };

  deleteGroup = async (req: Request, res: Response) => {
    await serviceConfigService.deleteGroup(req.params.serviceId, req.params.groupId);
    sendSuccess(res, null, "Config group deleted");
  };

  reorderGroups = async (req: Request, res: Response) => {
    const { groupIds } = req.body as ReorderGroupsDto;
    const groups = await serviceConfigService.reorderGroups(req.params.serviceId, groupIds);
    sendSuccess(res, groups, "Config groups reordered");
  };

  // Option mutations (staff).
  createOption = async (req: Request, res: Response) => {
    const option = await serviceConfigService.createOption(
      req.params.serviceId,
      req.params.groupId,
      req.body as CreateConfigOptionDto,
    );
    sendSuccess(res, option, "Config option created", HttpStatus.CREATED);
  };

  updateOption = async (req: Request, res: Response) => {
    const option = await serviceConfigService.updateOption(
      req.params.serviceId,
      req.params.groupId,
      req.params.optionId,
      req.body as UpdateConfigOptionDto,
    );
    sendSuccess(res, option, "Config option updated");
  };

  deleteOption = async (req: Request, res: Response) => {
    await serviceConfigService.deleteOption(
      req.params.serviceId,
      req.params.groupId,
      req.params.optionId,
    );
    sendSuccess(res, null, "Config option deleted");
  };

  reorderOptions = async (req: Request, res: Response) => {
    const { optionIds } = req.body as ReorderOptionsDto;
    const group = await serviceConfigService.reorderOptions(
      req.params.serviceId,
      req.params.groupId,
      optionIds,
    );
    sendSuccess(res, group, "Config options reordered");
  };
}

export const serviceConfigController = new ServiceConfigController();
