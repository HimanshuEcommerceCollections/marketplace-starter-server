import type { PaginationMeta } from "../types/common.types";

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Normalize page/limit and compute Prisma `skip`/`take`. */
export function buildPagination(params: PaginationParams): PaginationResult {
  const page = Math.max(params.page ?? DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/** Build the pagination metadata block for a list response. */
export function buildMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) };
}
