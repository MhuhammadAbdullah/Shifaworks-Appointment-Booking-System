import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import multer from "multer";
import type { ApiFailure } from "@booking/shared";
import { isProduction } from "../config/env.js";
import { AppError } from "../utils/app-error.js";
import {
  getPgConstraint,
  isExclusionViolation,
  isNotFound,
  isTxStartTimeout,
  isUniqueViolation,
  getPgErrorCode,
  PG,
} from "../utils/db-errors.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError("NOT_FOUND", `Route ${req.method} ${req.path} not found`));
};

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return AppError.validation(
      err.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })),
    );
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return new AppError("PAYLOAD_TOO_LARGE", "The file is too large");
    return AppError.badRequest(`Invalid upload: ${err.message}`);
  }

  // body-parser errors
  if (typeof err === "object" && err !== null && "type" in err) {
    const type = (err as { type: unknown }).type;
    if (type === "entity.parse.failed") return AppError.badRequest("Malformed JSON body");
    if (type === "entity.too.large") return new AppError("PAYLOAD_TOO_LARGE", "Request body too large");
  }

  // Database constraint violations that escaped service-level handling.
  // Messages stay generic so schema details never leak.
  if (isExclusionViolation(err)) {
    return new AppError("SLOT_UNAVAILABLE", "The selected time is no longer available");
  }
  if (isUniqueViolation(err)) return AppError.conflict("A record with these details already exists");
  if (isTxStartTimeout(err)) {
    return new AppError("SERVICE_UNAVAILABLE", "The system is busy right now. Please try again in a moment.");
  }
  if (isNotFound(err)) return AppError.notFound();
  if (getPgErrorCode(err) === PG.CHECK_VIOLATION) {
    const constraint = getPgConstraint(err) ?? "";
    if (constraint.includes("capacity")) {
      return new AppError("CAPACITY_EXCEEDED", "Not enough capacity remaining");
    }
    return AppError.badRequest("The request violates a data rule");
  }
  if (getPgErrorCode(err) === PG.FOREIGN_KEY_VIOLATION) {
    return AppError.badRequest("A referenced record does not exist or is still in use");
  }
  return null;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);
  const requestId = req.id ? String(req.id) : undefined;

  if (appError) {
    if (appError.statusCode >= 500) req.log.error({ err }, appError.message);
    else if (appError.code === "UNAUTHENTICATED" || appError.code === "FORBIDDEN") {
      req.log.warn({ code: appError.code, path: req.path }, "access denied");
    }
    const body: ApiFailure = {
      success: false,
      message: appError.message,
      code: appError.code,
      ...(appError.errors?.length ? { errors: appError.errors } : {}),
      ...(requestId ? { requestId } : {}),
    };
    res.status(appError.statusCode).json(body);
    return;
  }

  req.log.error({ err }, "unhandled error");
  const body: ApiFailure & { stack?: string } = {
    success: false,
    message: "An unexpected error occurred",
    code: "INTERNAL_ERROR",
    ...(requestId ? { requestId } : {}),
    ...(!isProduction && err instanceof Error && err.stack ? { stack: err.stack } : {}),
  };
  res.status(500).json(body);
};
