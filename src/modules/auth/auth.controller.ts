import type { Request, Response } from "express";
import { authService } from "./auth.service";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { HttpStatus } from "../../constants/http-status";
import type { RegisterDto, LoginDto, RefreshDto } from "./auth.types";

/** HTTP layer: parse request, call service, shape response. No business logic. */
export class AuthController {
  register = async (req: Request, res: Response) => {
    const result = await authService.register(req.body as RegisterDto);
    sendSuccess(res, result, "Registration successful", HttpStatus.CREATED);
  };

  login = async (req: Request, res: Response) => {
    const result = await authService.login(req.body as LoginDto);
    sendSuccess(res, result, "Login successful");
  };

  refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as RefreshDto;
    const result = await authService.refresh(refreshToken);
    sendSuccess(res, result, "Token refreshed");
  };

  logout = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as RefreshDto;
    await authService.logout(refreshToken);
    sendSuccess(res, null, "Logged out");
  };

  me = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const user = await authService.me(req.user.id);
    sendSuccess(res, user);
  };
}

export const authController = new AuthController();
