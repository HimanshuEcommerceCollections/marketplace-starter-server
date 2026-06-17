import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodTypeAny } from "zod";
import { ApiError } from "../utils/api-error";

interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates and COERCES request parts against Zod schemas, replacing the raw
 * values with the parsed (typed/defaulted) output so controllers receive clean
 * data. On failure, forwards a 422 ApiError with per-field details.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as unknown as Request["query"];
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as unknown as Request["params"];
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }));
        return next(ApiError.unprocessable("Validation failed", details));
      }
      next(err as Error);
    }
  };
}
