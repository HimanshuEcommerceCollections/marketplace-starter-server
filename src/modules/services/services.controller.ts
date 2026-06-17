import type { Request, Response } from "express";
import { servicesService } from "./services.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import type {
  CreateServiceDto,
  UpdateServiceDto,
  ListServicesQuery,
} from "./services.types";

export class ServicesController {
  list = async (req: Request, res: Response) => {
    const { items, meta } = await servicesService.list(
      req.query as unknown as ListServicesQuery,
    );
    sendSuccess(res, items, "Services fetched", undefined, meta);
  };

  getById = async (req: Request, res: Response) => {
    sendSuccess(res, await servicesService.getById(req.params.id));
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

  remove = async (req: Request, res: Response) => {
    await servicesService.remove(req.params.id);
    sendSuccess(res, null, "Service deleted");
  };
}

export const servicesController = new ServicesController();
