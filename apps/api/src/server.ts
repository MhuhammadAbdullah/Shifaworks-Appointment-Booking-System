import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./lib/prisma.js";
import { closeRedis } from "./lib/redis.js";
import { startScheduler, stopScheduler } from "./jobs/scheduler.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "API listening");
  // With RUN_WORKERS=false a separate `npm run worker` process runs the jobs.
  if (env.RUN_WORKERS) startScheduler().catch((err) => logger.error({ err }, "could not start background jobs"));
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  const force = setTimeout(() => {
    logger.error("forced shutdown after timeout");
    process.exit(1);
  }, 15_000);
  force.unref();

  await stopScheduler().catch((err) => logger.error({ err }, "error stopping background jobs"));
  server.close(async (err) => {
    try {
      await prisma.$disconnect();
      await closeRedis();
    } finally {
      process.exit(err ? 1 : 0);
    }
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  void shutdown("uncaughtException");
});
