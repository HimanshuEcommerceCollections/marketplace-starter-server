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
}

export const serviceConfigController = new ServiceConfigController();
