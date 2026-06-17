import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error";
import type { UserRole } from "../enums";

/**
 * Role-based access control. Use after `authenticate`:
 *   router.post("/", authenticate, authorize(UserRole.ADMIN), handler)
 */
export function authorize(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(
        ApiError.forbidden("You do not have permission to perform this action"),
      );
    }
    next();
  };
}
