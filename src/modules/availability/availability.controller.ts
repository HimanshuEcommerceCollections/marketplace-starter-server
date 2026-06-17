import type { Request, Response } from "express";
import { availabilityService } from "./availability.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import type { CreateSlotDto, ListSlotsQuery } from "./availability.types";

export class AvailabilityController {
  list = async (req: Request, res: Response) => {
    const { items, meta } = await availabilityService.list(
      req.query as unknown as ListSlotsQuery,
    );
    sendSuccess(res, items, "Availability fetched", undefined, meta);
  };

  create = async (req: Request, res: Response) => {
    const slot = await availabilityService.create(req.body as CreateSlotDto);
    sendSuccess(res, slot, "Availability slot created", HttpStatus.CREATED);
  };

  remove = async (req: Request, res: Response) => {
    await availabilityService.remove(req.params.id);
    sendSuccess(res, null, "Availability slot deleted");
  };
}

export const availabilityController = new AvailabilityController();
