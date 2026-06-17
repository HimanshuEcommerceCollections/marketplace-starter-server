import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ApiError } from "../utils/api-error";
import { HttpStatus } from "../constants/http-status";
import { logger } from "../utils/logger";
import { isProd } from "../config/env";

/**
 * Global error handler. Translates ApiError, ZodError, and known Prisma errors
 * into consistent JSON responses. Must be registered LAST. Express identifies
 * error handlers by their 4-argument arity, so `_next` stays in the signature.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
  let message = "Internal server error";
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
    message = "Validation failed";
    details = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      statusCode = HttpStatus.CONFLICT;
      message = "A record with these details already exists";
    } else if (err.code === "P2025") {
      statusCode = HttpStatus.NOT_FOUND;
      message = "Record not found";
    } else {
      statusCode = HttpStatus.BAD_REQUEST;
      message = "Database request error";
    }
  } else if (err instanceof Error) {
    message = err.message;
  }

  if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
    logger.error(message, err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { errors: details } : {}),
    ...(!isProd && err instanceof Error ? { stack: err.stack } : {}),
  });
}
