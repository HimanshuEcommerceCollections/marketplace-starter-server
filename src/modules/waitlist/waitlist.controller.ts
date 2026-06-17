import type { Request, Response } from "express";
import { waitlistService } from "./waitlist.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import { ApiError } from "../../utils/api-error";
import { isStaffRole } from "../../constants/roles";
import type { JoinWaitlistDto, ListWaitlistQuery } from "./waitlist.types";

export class WaitlistController {
  join = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const entry = await waitlistService.join(req.user.id, req.body as JoinWaitlistDto);
    sendSuccess(res, entry, "Joined waitlist", HttpStatus.CREATED);
  };

  list = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const staff = isStaffRole(req.user.role);
    const { items, meta } = await waitlistService.list(
      req.query as unknown as ListWaitlistQuery,
      staff ? undefined : { userId: req.user.id },
    );
    sendSuccess(res, items, "Waitlist fetched", undefined, meta);
  };

  leave = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const entry = await waitlistService.leave(req.params.id, req.user.id);
    sendSuccess(res, entry, "Left waitlist");
  };
}

export const waitlistController = new WaitlistController();
