import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { dispatchDue } from "../modules/notifications/dispatcher.js";
import { archiveOldLogs } from "./log-archive.js";
import type { PeriodicJob } from "./queues.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Periodic jobs. With QUEUE_ENABLED they run as BullMQ job schedulers (once
 * per interval across all processes); otherwise on in-process timers. Every
 * job must be idempotent, so overlapping runs on several instances are harmless.
 *
 * Jobs arrive with their phases: unpaid-booking expiry (Phase 5, optional
 * payment window), email dispatch (Phase 7, done).
 */
export const periodicJobs: PeriodicJob[] = [
  // The 30 s backstop sweep; queued rows are also dispatched ~1 s after they're written (outbox.ts).
  { name: "email-dispatch", everyMs: 30_000, run: () => dispatchDue().then(() => undefined) },
  // Keeps audit_logs/email_logs small: rows past retention are CSV-exported to storage, then deleted.
  { name: "log-archive", everyMs: WEEK_MS, run: () => archiveOldLogs().then(() => undefined) },
];

const timers: NodeJS.Timeout[] = [];
let queueMode = false;

export async function startScheduler(): Promise<void> {
  if (env.QUEUE_ENABLED) {
    const { startQueueWorkers } = await import("./queues.js");
    await startQueueWorkers(periodicJobs);
    queueMode = true;
    return;
  }
  if (!periodicJobs.length) return;
  for (const job of periodicJobs) {
    let running = false;
    const tick = async () => {
      if (running) return; // never overlap runs of the same job
      running = true;
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, "scheduled job failed");
      } finally {
        running = false;
      }
    };
    timers.push(setInterval(() => void tick(), job.everyMs));
    setTimeout(() => void tick(), 5_000).unref();
  }
  logger.info({ jobs: periodicJobs.map((j) => j.name) }, "scheduler started (in-process)");
}

export async function stopScheduler(): Promise<void> {
  for (const t of timers.splice(0)) clearInterval(t);
  if (queueMode) {
    const { stopQueueWorkers } = await import("./queues.js");
    await stopQueueWorkers();
  }
}
