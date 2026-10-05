/**
 * HTTP envelope used by every /api/v1 endpoint.
 */

export interface ApiFieldError {
  path: string;
  message: string;
  code?: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
  meta?: PaginationMeta;
}

export interface ApiFailure {
  success: false;
  message: string;
  code: ErrorCode;
  errors?: ApiFieldError[];
  requestId?: string;
  /** Machine-readable extras for a specific error (e.g. `{ reason: "recovery_locked" }`) — the frontend may branch on these, never just display them. */
  details?: Record<string, unknown>;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "SLOT_UNAVAILABLE",
  "CAPACITY_EXCEEDED",
  "SERVICE_CLOSED",
  "PAYMENT_REQUIRED",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
