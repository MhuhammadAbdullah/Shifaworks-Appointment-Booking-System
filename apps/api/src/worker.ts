/**
 * Background worker process (no HTTP): periodic jobs + notification delivery.
 * Run it next to API instances started with RUN_WORKERS=false, usually with
 * QUEUE_ENABLED=true so several workers share the load through BullMQ.
 *
 *   npm run worker -w @booking/api
 */
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./lib/prisma.js";
import { closeRedis } from "./lib/redis.js";
import { startScheduler, stopScheduler } from "./jobs/scheduler.js";

await startScheduler();
logger.info({ queue: env.QUEUE_ENABLED ? "bullmq" : "in-process" }, "worker running");

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "worker shutting down");
  setTimeout(() => process.exit(1), 15_000).unref();
  await stopScheduler().catch((err) => logger.error({ err }, "error stopping jobs"));
  await prisma.$disconnect();
  await closeRedis();
  process.exit(0);
}

process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandled promise rejection"));
