import type { Request, Response } from "express";
import { HttpStatus } from "../constants/http-status";

/** Fallback 404 for unmatched routes. Registered after all real routes. */
export function notFound(req: Request, res: Response): void {
  res.status(HttpStatus.NOT_FOUND).json({
    success: false,
    message: `Not found: ${req.method} ${req.originalUrl}`,
  });
}
