import { Router } from "express";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { pingRedis } from "../../lib/redis.js";
import { sendOk } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";

export const healthRouter = Router();

/** Liveness: the process is up. */
healthRouter.get("/live", (_req, res) => {
  sendOk(res, { status: "ok" });
});

/**
 * Readiness: required dependencies are reachable. Redis is only required
 * when queues are enabled; otherwise its status is informational.
 */
healthRouter.get("/ready", async (_req, res) => {
  const checks: Record<string, "ok" | "down" | "disabled"> = { database: "down", redis: "disabled" };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "down";
  }
  if (env.REDIS_URL) checks.redis = (await pingRedis()) ? "ok" : "down";

  const redisRequired = env.QUEUE_ENABLED;
  if (checks.database === "down" || (redisRequired && checks.redis === "down")) {
    throw new AppError("SERVICE_UNAVAILABLE", "One or more dependencies are unavailable", undefined, checks);
  }
  sendOk(res, { status: "ok", checks });
});
