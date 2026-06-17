import type { UserRole } from "../enums";

/** Identity attached to a request after authentication. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

/** Pagination metadata returned alongside list responses. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Standard success envelope. */
export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta;
}

/** Standard failure envelope. */
export interface ApiFailure {
  success: false;
  message: string;
  errors?: unknown;
}
