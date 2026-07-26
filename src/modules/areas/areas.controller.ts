import type { Request, Response } from "express";
import { areasService } from "./areas.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import { isStaffRole } from "../../constants/roles";
import type {
  AreaDetailQuery,
  AreaZipLookupQuery,
  CreateAreaDto,
  ListAreaZipCodesQuery,
  ListAreasQuery,
  UpdateAreaDto,
  UpdateAreaStatusDto,
} from "./areas.types";

export class AreasController {
  // PUBLIC (optionalAuthenticate) — anonymous callers get ACTIVE areas only.
  list = async (req: Request, res: Response) => {
    const { items, meta } = await areasService.list(
      req.query as unknown as ListAreasQuery,
      req.user?.role,
    );
    sendSuccess(res, items, "Areas fetched", undefined, meta);
  };

  // PUBLIC (optionalAuthenticate) — "who owns this ZIP?". For non-staff an
  // inactive ZIP or market is indistinguishable from an unknown one.
  lookup = async (req: Request, res: Response) => {
    const { zip } = req.query as unknown as AreaZipLookupQuery;
    const staff = !!req.user && isStaffRole(req.user.role);
    sendSuccess(res, await areasService.lookupByZip(zip, staff));
  };

  // PUBLIC (optionalAuthenticate) — non-staff see ACTIVE areas only.
  getBySlug = async (req: Request, res: Response) => {
    const staff = !!req.user && isStaffRole(req.user.role);
    const { includeZipCodes } = req.query as unknown as AreaDetailQuery;
    sendSuccess(
      res,
      await areasService.getDetailsBySlug(req.params.slug, staff, includeZipCodes),
    );
  };

  // Staff-only below (gated in routes).
  getById = async (req: Request, res: Response) => {
    const { includeZipCodes } = req.query as unknown as AreaDetailQuery;
    sendSuccess(res, await areasService.getDetails(req.params.id, includeZipCodes));
  };

  listZipCodes = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await areasService.listZipCodes(
        req.params.id,
        req.query as unknown as ListAreaZipCodesQuery,
      ),
    );
  };

  create = async (req: Request, res: Response) => {
    const area = await areasService.create(req.body as CreateAreaDto);
    sendSuccess(res, area, "Area created", HttpStatus.CREATED);
  };

  update = async (req: Request, res: Response) => {
    const area = await areasService.update(req.params.id, req.body as UpdateAreaDto);
    sendSuccess(res, area, "Area updated");
  };

  setStatus = async (req: Request, res: Response) => {
    const { status } = req.body as UpdateAreaStatusDto;
    sendSuccess(
      res,
      // Role is passed through: archiving via this generic route must not bypass
      // the admin-only gate on POST /:id/archive.
      await areasService.setStatus(req.params.id, status, req.user?.role),
      "Area status updated",
    );
  };

  activate = async (req: Request, res: Response) => {
    sendSuccess(res, await areasService.activate(req.params.id), "Area activated");
  };

  deactivate = async (req: Request, res: Response) => {
    sendSuccess(res, await areasService.deactivate(req.params.id), "Area deactivated");
  };

  archive = async (req: Request, res: Response) => {
    sendSuccess(res, await areasService.archive(req.params.id), "Area archived");
  };

  restore = async (req: Request, res: Response) => {
    sendSuccess(res, await areasService.restore(req.params.id), "Area restored");
  };
}

export const areasController = new AreasController();
