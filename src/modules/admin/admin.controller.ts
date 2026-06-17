import type { Request, Response } from "express";
import { adminService } from "./admin.service";
import { sendSuccess } from "../../utils/api-response";

export class AdminController {
  dashboard = async (_req: Request, res: Response) => {
    const stats = await adminService.dashboard();
    sendSuccess(res, stats, "Dashboard stats");
  };
}

export const adminController = new AdminController();
