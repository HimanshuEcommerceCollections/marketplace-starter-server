import type { Response } from "express";
import { HttpStatus } from "../constants/http-status";
import type { PaginationMeta } from "../types/common.types";

/** Send a standardized success envelope: { success, message, data, meta? }. */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message = "Success",
  statusCode: number = HttpStatus.OK,
  meta?: PaginationMeta,
): Response {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  });
}
