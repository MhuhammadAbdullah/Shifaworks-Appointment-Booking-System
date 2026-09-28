import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/app-error.js";

export interface VerifiedToken {
  /** Supabase auth.users.id */
  sub: string;
  email: string | null;
  sessionId: string | null;
  payload: JWTPayload;
}

export interface TokenVerifierOptions {
  issuer: string;
  audience: string;
  /** Key resolver for asymmetric tokens (ES256/RS256) — the Supabase JWKS. */
  jwks: JWTVerifyGetKey;
  /** Legacy HS256 shared secret, only for projects that have not migrated. */
  hs256Secret?: string;
}

const ASYMMETRIC_ALGS = ["ES256", "RS256", "EdDSA"];

/**
 * Builds a verifier for Supabase access tokens. Signature, issuer, audience
 * and expiry are all checked; anonymous sessions are rejected because every
 * API user must map to a real account.
 */
export function createTokenVerifier(opts: TokenVerifierOptions) {
  const hsKey = opts.hs256Secret ? new TextEncoder().encode(opts.hs256Secret) : undefined;

  return async function verifyAccessToken(token: string): Promise<VerifiedToken> {
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      throw AppError.unauthenticated("Malformed access token");
    }

    let payload: JWTPayload;
    try {
      const common = { issuer: opts.issuer, audience: opts.audience, clockTolerance: 5 };
      if (alg === "HS256") {
        if (!hsKey) throw AppError.unauthenticated("Unsupported token signature");
        ({ payload } = await jwtVerify(token, hsKey, { ...common, algorithms: ["HS256"] }));
      } else {
        ({ payload } = await jwtVerify(token, opts.jwks, { ...common, algorithms: ASYMMETRIC_ALGS }));
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof joseErrors.JWTExpired) throw AppError.unauthenticated("Session expired");
      throw AppError.unauthenticated("Invalid access token");
    }

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw AppError.unauthenticated("Invalid access token");
    }
    if (payload["is_anonymous"] === true) {
      throw AppError.unauthenticated("Anonymous sessions are not allowed");
    }
    return {
      sub: payload.sub,
      email: typeof payload["email"] === "string" && payload["email"] ? payload["email"].toLowerCase() : null,
      sessionId: typeof payload["session_id"] === "string" ? payload["session_id"] : null,
      payload,
    };
  };
}

const supabaseAuthUrl = `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;

export const verifyAccessToken = createTokenVerifier({
  issuer: env.SUPABASE_JWT_ISSUER ?? supabaseAuthUrl,
  audience: env.SUPABASE_JWT_AUDIENCE,
  // jose caches keys and refetches on unknown `kid` (key rotation) with a cooldown.
  jwks: createRemoteJWKSet(new URL(`${supabaseAuthUrl}/.well-known/jwks.json`), {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
  }),
  ...(env.SUPABASE_JWT_SECRET ? { hs256Secret: env.SUPABASE_JWT_SECRET } : {}),
});
