import type { ApiFieldError, ErrorCode } from "@booking/shared";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SLOT_UNAVAILABLE: 409,
  CAPACITY_EXCEEDED: 409,
  // The service's form is closed (inactive or booking disabled).
  SERVICE_CLOSED: 410,
  PAYMENT_REQUIRED: 402,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * Expected, client-facing error. Anything thrown that is NOT an AppError is
 * treated as a bug: logged with its stack and returned as a generic 500.
 */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly errors?: ApiFieldError[],
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = STATUS_BY_CODE[code];
  }

  static badRequest(message: string, errors?: ApiFieldError[]) {
    return new AppError("BAD_REQUEST", message, errors);
  }
  static validation(errors: ApiFieldError[], message = "Validation failed") {
    return new AppError("VALIDATION_ERROR", message, errors);
  }
  static unauthenticated(message = "Authentication required") {
    return new AppError("UNAUTHENTICATED", message);
  }
  static forbidden(message = "You do not have permission to perform this action") {
    return new AppError("FORBIDDEN", message);
  }
  static notFound(entity = "Resource") {
    return new AppError("NOT_FOUND", `${entity} not found`);
  }
  static conflict(message: string) {
    return new AppError("CONFLICT", message);
  }
}
