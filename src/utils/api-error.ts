import { HttpStatus } from "../constants/http-status";

/**
 * Operational error carrying an HTTP status. Thrown anywhere in the request
 * lifecycle and translated to a JSON response by the global error handler.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    message: string,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, ApiError.prototype);
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message = "Bad request", details?: unknown): ApiError {
    return new ApiError(HttpStatus.BAD_REQUEST, message, details);
  }
  static unauthorized(message = "Unauthorized"): ApiError {
    return new ApiError(HttpStatus.UNAUTHORIZED, message);
  }
  static forbidden(message = "Forbidden"): ApiError {
    return new ApiError(HttpStatus.FORBIDDEN, message);
  }
  static notFound(message = "Resource not found"): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, message);
  }
  static conflict(message = "Conflict", details?: unknown): ApiError {
    return new ApiError(HttpStatus.CONFLICT, message, details);
  }
  static unprocessable(message = "Validation failed", details?: unknown): ApiError {
    return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, message, details);
  }
  static tooMany(message = "Too many requests"): ApiError {
    return new ApiError(HttpStatus.TOO_MANY_REQUESTS, message);
  }
  static internal(message = "Internal server error"): ApiError {
    return new ApiError(HttpStatus.INTERNAL_SERVER_ERROR, message, undefined, false);
  }
  static notImplemented(message = "Not implemented"): ApiError {
    return new ApiError(HttpStatus.NOT_IMPLEMENTED, message);
  }
}
