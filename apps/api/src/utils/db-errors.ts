import { Prisma } from "../generated/prisma/client.js";

/** PostgreSQL SQLSTATE codes the application reacts to. */
export const PG = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  EXCLUSION_VIOLATION: "23P01",
  SERIALIZATION_FAILURE: "40001",
  DEADLOCK_DETECTED: "40P01",
} as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

/**
 * Extracts the underlying PostgreSQL SQLSTATE from an error thrown by Prisma
 * (driver-adapter errors nest it under meta/cause) or by `pg` directly.
 */
export function getPgErrorCode(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length) {
    const cur = queue.shift();
    if (!isObj(cur) || seen.has(cur)) continue;
    seen.add(cur);
    for (const key of ["originalCode", "code"] as const) {
      const v = cur[key];
      // Prisma's own codes ("P2039") are also 5 characters: skip them and keep
      // digging for the SQLSTATE under meta.driverAdapterError.cause.
      if (typeof v === "string" && /^[0-9A-Z]{5}$/.test(v) && !/^P\d{4}$/.test(v)) return v;
    }
    queue.push(cur["cause"], cur["meta"], cur["driverAdapterError"]);
  }
  return undefined;
}

/** Name of the violated constraint when the driver reports it. */
export function getPgConstraint(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length) {
    const cur = queue.shift();
    if (!isObj(cur) || seen.has(cur)) continue;
    seen.add(cur);
    const v = cur["constraint"];
    if (typeof v === "string") return v;
    if (isObj(v) && typeof v["index"] === "string") return v["index"];
    const msg = cur["message"];
    if (typeof msg === "string") {
      const m = /constraint "([^"]+)"/.exec(msg);
      if (m?.[1]) return m[1];
    }
    queue.push(cur["cause"], cur["meta"], cur["driverAdapterError"]);
  }
  return undefined;
}

export function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return true;
  return getPgErrorCode(err) === PG.UNIQUE_VIOLATION;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export function isExclusionViolation(err: unknown): boolean {
  return getPgErrorCode(err) === PG.EXCLUSION_VIOLATION;
}

/** Could not obtain a pooled connection / start the transaction in time (load spike). */
export function isTxStartTimeout(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028";
}

export function isRetryableTxError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2028")) return true;
  const code = getPgErrorCode(err);
  return code === PG.SERIALIZATION_FAILURE || code === PG.DEADLOCK_DETECTED;
}

/**
 * Runs a transactional unit of work, retrying transient failures (pool wait
 * timeout, deadlock, serialization failure) with jittered backoff. Business
 * errors — including exclusion violations — are never retried.
 */
export async function withTxRetry<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      if (attempt >= attempts || !isRetryableTxError(err)) throw err;
      await new Promise((r) => setTimeout(r, 50 * attempt + Math.random() * 150));
    }
  }
}

/** Interactive transaction limits for booking-critical work. */
export const BOOKING_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
