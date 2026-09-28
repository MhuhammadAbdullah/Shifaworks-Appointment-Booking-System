/**
 * BullMQ wiring (only used when QUEUE_ENABLED=true).
 *
 *  - "maintenance": one job scheduler per periodic job, so across any number
 *    of API/worker processes each job runs once per interval;
 *  - task queues: modules register a handler (e.g. Phase 7 email delivery)
 *    and enqueue jobs with deterministic ids so re-enqueueing is a no-op.
 *    BullMQ-level retries are off: the database decides when work is due.
 */
import { Queue, Worker, type Job as BullJob } from "bullmq";
import { logger } from "../config/logger.js";
import { createQueueConnection } from "../lib/redis.js";

export interface PeriodicJob {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
}

type TaskHandler = (data: Record<string, unknown>) => Promise<void>;

const PREFIX = "shifaworks";
const queues = new Map<string, Queue>();
const handlers = new Map<string, { handler: TaskHandler; concurrency: number }>();
const workers: Worker[] = [];

function queue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: createQueueConnection(), prefix: PREFIX });
    queues.set(name, q);
  }
  return q;
}

/** Called by a module at import time; the worker starts it with the others. */
export function registerTaskQueue(name: string, handler: TaskHandler, concurrency = 5): void {
  handlers.set(name, { handler, concurrency });
}

export async function enqueueTasks(name: string, items: { jobId: string; data: Record<string, unknown> }[]): Promise<void> {
  if (!items.length) return;
  await queue(name).addBulk(
    items.map((i) => ({ name, data: i.data, opts: { jobId: i.jobId, attempts: 1, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } } })),
  );
}

/** Registers the periodic jobs and starts every worker in this process. */
export async function startQueueWorkers(jobs: PeriodicJob[]): Promise<void> {
  const maintenance = queue("maintenance");
  for (const job of jobs) {
    await maintenance.upsertJobScheduler(job.name, { every: job.everyMs }, { name: job.name, opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } } });
  }
  const byName = new Map(jobs.map((j) => [j.name, j]));
  workers.push(
    new Worker(
      "maintenance",
      async (j: BullJob) => {
        await byName.get(j.name)?.run();
      },
      { connection: createQueueConnection(), prefix: PREFIX, concurrency: 2 },
    ),
  );
  for (const [name, { handler, concurrency }] of handlers) {
    workers.push(new Worker(name, async (j: BullJob<Record<string, unknown>>) => handler(j.data), { connection: createQueueConnection(), prefix: PREFIX, concurrency }));
  }
  for (const w of workers) w.on("failed", (j, err) => logger.error({ err, job: j?.name, queue: w.name }, "queue job failed"));
  logger.info({ jobs: jobs.map((j) => j.name), queues: [...handlers.keys()] }, "queue workers started (BullMQ)");
}

export async function stopQueueWorkers(): Promise<void> {
  await Promise.allSettled(workers.splice(0).map((w) => w.close()));
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  queues.clear();
}
