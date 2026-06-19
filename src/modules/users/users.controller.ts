import type { Request, Response } from "express";
import { usersService } from "./users.service";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { HttpStatus } from "../../constants/http-status";
import type {
  ListUsersQuery,
  CreateUserDto,
  UpdateMeDto,
  UpdateRoleDto,
  UpdateStatusDto,
} from "./users.types";

export class UsersController {
  list = async (req: Request, res: Response) => {
    const { items, meta } = await usersService.list(
      req.query as unknown as ListUsersQuery,
    );
    sendSuccess(res, items, "Users fetched", undefined, meta);
  };

  getById = async (req: Request, res: Response) => {
    sendSuccess(res, await usersService.getById(req.params.id));
  };

  create = async (req: Request, res: Response) => {
    const user = await usersService.create(req.body as CreateUserDto);
    sendSuccess(res, user, "User created", HttpStatus.CREATED);
  };

  getMe = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    sendSuccess(res, await usersService.getById(req.user.id));
  };

  updateMe = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const user = await usersService.updateProfile(req.user.id, req.body as UpdateMeDto);
    sendSuccess(res, user, "Profile updated");
  };

  updateRole = async (req: Request, res: Response) => {
    const user = await usersService.updateRole(req.params.id, req.body as UpdateRoleDto);
    sendSuccess(res, user, "Role updated");
  };

  updateStatus = async (req: Request, res: Response) => {
    const user = await usersService.updateStatus(
      req.params.id,
      req.body as UpdateStatusDto,
    );
    sendSuccess(res, user, "Status updated");
  };
}

export const usersController = new UsersController();
