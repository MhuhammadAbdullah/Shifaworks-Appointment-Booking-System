import type { Request, RequestHandler } from "express";
import type { PermissionKey } from "@booking/shared";
import { AppError } from "../utils/app-error.js";
import { verifyAccessToken, type VerifiedToken } from "../modules/auth/token-verifier.js";
import { resolvePrincipal, type Principal } from "../modules/auth/principal.service.js";
import { hasPermission } from "../modules/auth/permission-rules.js";

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

export type TokenVerifier = (token: string) => Promise<VerifiedToken>;
export type PrincipalResolver = (token: VerifiedToken) => Promise<Principal>;

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Factory so tests can inject a fake verifier/resolver. Tokens are accepted
 * only from the Authorization header (never cookies), so the API is not
 * exposed to CSRF.
 */
export function createAuthenticate(
  verify: TokenVerifier = verifyAccessToken,
  resolve: PrincipalResolver = resolvePrincipal,
): { authenticate: RequestHandler; requireAuth: RequestHandler } {
  async function attach(req: Request, required: boolean): Promise<void> {
    if (req.principal) return;
    const token = extractBearer(req);
    if (!token) {
      if (required) throw AppError.unauthenticated();
      return;
    }
    try {
      req.principal = await resolve(await verify(token));
    } catch (err) {
      if (err instanceof AppError && (err.code === "UNAUTHENTICATED" || err.code === "FORBIDDEN")) {
        req.log.warn({ code: err.code, reason: err.message, ip: req.ip }, "authentication failed");
      }
      throw err;
    }
  }

  return {
    /** Attaches req.principal when a valid token is present; anonymous otherwise. */
    authenticate: async (req, _res, next) => {
      await attach(req, false);
      next();
    },
    /** Rejects the request with 401 unless a valid token is present. */
    requireAuth: async (req, _res, next) => {
      await attach(req, true);
      next();
    },
  };
}

export const { authenticate, requireAuth } = createAuthenticate();

/** Requires ALL listed permissions. Must run after requireAuth. */
export function requirePermission(...keys: PermissionKey[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.principal) throw AppError.unauthenticated();
    const missing = keys.filter((k) => !hasPermission(req.principal, k));
    if (missing.length) {
      req.log.warn({ userId: req.principal.userId, missing }, "permission denied");
      throw AppError.forbidden();
    }
    next();
  };
}

/** Requires AT LEAST ONE of the listed permissions. Must run after requireAuth. */
export function requireAnyPermission(...keys: PermissionKey[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.principal) throw AppError.unauthenticated();
    if (!keys.some((k) => hasPermission(req.principal, k))) {
      req.log.warn({ userId: req.principal.userId, anyOf: keys }, "permission denied");
      throw AppError.forbidden();
    }
    next();
  };
}

/** Narrowing helper for controllers behind requireAuth. */
export function principalOf(req: Request): Principal {
  if (!req.principal) throw AppError.unauthenticated();
  return req.principal;
}
