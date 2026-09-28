import type { RequestHandler } from "express";
import type { z } from "zod";

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

declare global {
  namespace Express {
    interface Request {
      /** Parsed + coerced request parts. Populated by validate(). */
      valid: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

/**
 * Validates request parts at the API boundary. Controllers read the parsed
 * values via `validated(req)` so they get coerced, typed data (Express 5 makes
 * req.query read-only, so parsed values are stored on req.valid instead).
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    req.valid ??= {};
    if (schemas.params) req.valid.params = schemas.params.parse(req.params);
    if (schemas.query) req.valid.query = schemas.query.parse(req.query);
    if (schemas.body) req.valid.body = schemas.body.parse(req.body);
    next();
  };
}

export function validated<B = unknown, Q = unknown, P = unknown>(
  req: Express.Request,
): { body: B; query: Q; params: P } {
  return req.valid as { body: B; query: Q; params: P };
}
