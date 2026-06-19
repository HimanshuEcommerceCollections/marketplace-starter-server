import type { Request, Response } from "express";
import { categoriesService } from "./categories.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import type { CreateCategoryDto, UpdateCategoryDto, ListCategoriesQuery } from "./categories.types";

export class CategoriesController {
  list = async (req: Request, res: Response) => {
    const { items, meta } = await categoriesService.list(
      req.query as unknown as ListCategoriesQuery,
      req.user?.role,
    );
    sendSuccess(res, items, "Categories fetched", undefined, meta);
  };

  getById = async (req: Request, res: Response) => {
    sendSuccess(res, await categoriesService.getById(req.params.id));
  };

  create = async (req: Request, res: Response) => {
    const category = await categoriesService.create(req.body as CreateCategoryDto);
    sendSuccess(res, category, "Category created", HttpStatus.CREATED);
  };

  update = async (req: Request, res: Response) => {
    const category = await categoriesService.update(
      req.params.id,
      req.body as UpdateCategoryDto,
    );
    sendSuccess(res, category, "Category updated");
  };

  publish = async (req: Request, res: Response) => {
    sendSuccess(res, await categoriesService.publish(req.params.id), "Category published");
  };

  deactivate = async (req: Request, res: Response) => {
    sendSuccess(res, await categoriesService.deactivate(req.params.id), "Category deactivated");
  };
}

export const categoriesController = new CategoriesController();
