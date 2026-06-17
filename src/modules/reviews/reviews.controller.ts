import type { Request, Response } from "express";
import { reviewsService } from "./reviews.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import { ApiError } from "../../utils/api-error";
import { isStaffRole } from "../../constants/roles";
import type {
  CreateReviewDto,
  ListReviewsQuery,
  ModerateReviewDto,
} from "./reviews.types";

export class ReviewsController {
  create = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const review = await reviewsService.create(req.user.id, req.body as CreateReviewDto);
    sendSuccess(res, review, "Review submitted", HttpStatus.CREATED);
  };

  list = async (req: Request, res: Response) => {
    const includeUnpublished = req.user ? isStaffRole(req.user.role) : false;
    const { items, meta } = await reviewsService.list(
      req.query as unknown as ListReviewsQuery,
      includeUnpublished,
    );
    sendSuccess(res, items, "Reviews fetched", undefined, meta);
  };

  getById = async (req: Request, res: Response) => {
    sendSuccess(res, await reviewsService.getById(req.params.id));
  };

  moderate = async (req: Request, res: Response) => {
    const review = await reviewsService.moderate(
      req.params.id,
      req.body as ModerateReviewDto,
    );
    sendSuccess(res, review, "Review updated");
  };
}

export const reviewsController = new ReviewsController();
