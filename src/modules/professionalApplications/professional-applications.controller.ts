import type { Request, Response } from "express";
import { professionalApplicationsService } from "./professional-applications.service";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { HttpStatus } from "../../constants/http-status";
import type {
  CreateProfessionalApplicationDto,
  ListProfessionalApplicationsQuery,
  UpdateProfessionalApplicationStatusDto,
  AcceptProfessionalApplicationDto,
} from "./professional-applications.types";

export class ProfessionalApplicationsController {
  // Public — no auth. Anyone can apply to join as a practitioner.
  create = async (req: Request, res: Response) => {
    const entry = await professionalApplicationsService.create(
      req.body as CreateProfessionalApplicationDto,
    );
    sendSuccess(res, entry, "Application submitted", HttpStatus.CREATED);
  };

  // Staff-only from here down (gated in routes).
  list = async (req: Request, res: Response) => {
    const { items, meta } = await professionalApplicationsService.list(
      req.query as unknown as ListProfessionalApplicationsQuery,
    );
    sendSuccess(res, items, "Applications fetched", undefined, meta);
  };

  getById = async (req: Request, res: Response) => {
    const entry = await professionalApplicationsService.getById(req.params.id);
    sendSuccess(res, entry);
  };

  updateStatus = async (req: Request, res: Response) => {
    const entry = await professionalApplicationsService.updateStatus(
      req.params.id,
      req.body as UpdateProfessionalApplicationStatusDto,
    );
    sendSuccess(res, entry, "Application updated");
  };

  accept = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { application, inviteEmailSent } =
      await professionalApplicationsService.accept(
        req.params.id,
        req.user.id,
        req.body as AcceptProfessionalApplicationDto,
      );
    sendSuccess(
      res,
      { application, inviteEmailSent },
      inviteEmailSent
        ? "Application accepted — invitation sent"
        : "Application accepted, but the invitation email could not be sent. Resend it from the roster.",
    );
  };

  reject = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const entry = await professionalApplicationsService.reject(
      req.params.id,
      req.user.id,
    );
    sendSuccess(res, entry, "Application rejected");
  };
}

export const professionalApplicationsController =
  new ProfessionalApplicationsController();
