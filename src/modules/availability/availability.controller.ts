import type { Request, Response } from "express";
import { availabilityService } from "./availability.service";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { HttpStatus } from "../../constants/http-status";
import { isStaffRole } from "../../constants/roles";
import type { CreateSlotDto, ListSlotsQuery } from "./availability.types";

export class AvailabilityController {
  list = async (req: Request, res: Response) => {
    const { items, meta } = await availabilityService.list(
      req.query as unknown as ListSlotsQuery,
    );
    sendSuccess(res, items, "Availability fetched", undefined, meta);
  };

  create = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const slot = await availabilityService.create(
      { id: req.user.id, isStaff: isStaffRole(req.user.role) },
      req.body as CreateSlotDto,
    );
    sendSuccess(res, slot, "Availability slot created", HttpStatus.CREATED);
  };

  remove = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    await availabilityService.remove(
      { id: req.user.id, isStaff: isStaffRole(req.user.role) },
      req.params.id,
    );
    sendSuccess(res, null, "Availability slot deleted");
  };
}

export const availabilityController = new AvailabilityController();
