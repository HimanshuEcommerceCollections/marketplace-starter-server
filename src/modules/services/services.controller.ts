import type { Request, Response } from "express";
import { servicesService } from "./services.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import type { ServiceStatus } from "../../enums";
import type {
  CreateServiceDto,
  UpdateServiceDto,
  ListServicesQuery,
} from "./services.types";

export class ServicesController {
  list = async (req: Request, res: Response) => {
    const { items, meta } = await servicesService.list(
      req.query as unknown as ListServicesQuery,
      req.user?.role,
    );
    sendSuccess(res, items, "Services fetched", undefined, meta);
  };

  getById = async (req: Request, res: Response) => {
    sendSuccess(res, await servicesService.getDetails(req.params.id));
  };

  create = async (req: Request, res: Response) => {
    const service = await servicesService.create(req.body as CreateServiceDto);
    sendSuccess(res, service, "Service created", HttpStatus.CREATED);
  };

  update = async (req: Request, res: Response) => {
    const service = await servicesService.update(
      req.params.id,
      req.body as UpdateServiceDto,
    );
    sendSuccess(res, service, "Service updated");
  };

  publish = async (req: Request, res: Response) => {
    sendSuccess(res, await servicesService.publish(req.params.id), "Service published");
  };

  deactivate = async (req: Request, res: Response) => {
    sendSuccess(res, await servicesService.deactivate(req.params.id), "Service deactivated");
  };

  setStatus = async (req: Request, res: Response) => {
    const { status } = req.body as { status: ServiceStatus };
    sendSuccess(
      res,
      await servicesService.setStatus(req.params.id, status),
      "Service status updated",
    );
  };
}

export const servicesController = new ServicesController();
