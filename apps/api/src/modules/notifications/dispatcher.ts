/**
 * Delivery. The notifications table is the source of truth; workers only
 * deliver rows that are due.
 *
 *  - claim:  one conditional UPDATE (QUEUED/FAILED → SENDING, attempts + 1),
 *            so concurrent workers/processes never send the same row twice;
 *  - send:   render fresh from the booking, call the email provider, log;
 *  - retry:  transient failures stay FAILED and become due again after an
 *            exponential backoff (1, 2, 4, 8 min …) until MAX attempts;
 *            permanent failures are closed immediately;
 *  - sweep:  every 30 s (jobs/scheduler.ts) and ~1 s after new rows are
 *            queued, due rows are delivered in-process, or handed to BullMQ
 *            when QUEUE_ENABLED (jobs/queues.ts).
 * Delivery is at-least-once: a crash between the provider call and the status
 * update can resend once after the stuck-row recovery (10 min).
 */
import { waitUntil } from "@vercel/functions";
import { MAX_NOTIFICATION_ATTEMPTS, SAMPLE_TEMPLATE_VALUES, type EmailTemplateKey } from "@booking/shared";
import { env, isTest } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { enqueueTasks, registerTaskQueue } from "../../jobs/queues.js";
import { absoluteUrl, loadInviteContext, loadNotificationContext } from "./context.js";
import { DeliveryError, getEmailProvider, type SendResult } from "./providers/index.js";
import { TemplateError, emailLayout, htmlToText, renderTemplate } from "./render.js";

const MINUTE = 60_000;
const STUCK_AFTER_MS = 10 * MINUTE;
const INLINE_CONCURRENCY = 5;
const TASK_QUEUE = "notification-delivery";

/** Delay before retry number `attempts + 1`. */
export const backoffMs = (attempts: number) => Math.min(MINUTE * 2 ** Math.max(0, attempts - 1), 60 * MINUTE);

export type DeliveryOutcome = "SENT" | "FAILED" | "RETRY" | "SKIPPED" | "NOT_CLAIMED";

class SkipError extends Error {}

/** Deep link shown to staff/provider recipients; customers never get one (no portal). */
function linkFor(audience: string, bookingId: string): string {
  if (audience === "ADMIN") return absoluteUrl(`/admin/bookings/${bookingId}`, env.APP_URL);
  if (audience === "PROVIDER") return absoluteUrl(`/provider/appointments/${bookingId}`, env.APP_URL);
  return "";
}

/** Delivers one notification if it is due and nobody else holds it. */
export async function deliverNotification(id: string, now = new Date()): Promise<DeliveryOutcome> {
  const claimed = await prisma.notification.updateMany({
    where: {
      id,
      status: { in: ["QUEUED", "FAILED"] },
      attempts: { lt: MAX_NOTIFICATION_ATTEMPTS },
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return "NOT_CLAIMED";

  const n = await prisma.notification.findUniqueOrThrow({
    where: { id },
    include: { template: true, organization: { select: { name: true } } },
  });
  const key = n.templateKey as EmailTemplateKey;
  let provider: string | null = null;

  try {
    const t = n.template;
    if (!t || !t.isActive) throw new SkipError("Template is disabled or was removed");
    if (!n.recipientEmail) throw new SkipError("No email address");

    let vars: Record<string, string>;
    let orgName = n.organization.name;
    if (n.bookingId) {
      const ctx = await loadNotificationContext(prisma, n.bookingId, key);
      if (!ctx) throw new SkipError("The booking no longer exists");
      orgName = ctx.orgName;
      vars = { ...ctx.vars, link: linkFor(n.audience, n.bookingId) };
    } else if (n.userId) {
      if (!n.credential) throw new SkipError("No credential recorded for this message");
      const ctx = await loadInviteContext(prisma, n.userId, n.credential);
      if (!ctx) throw new SkipError("The account no longer exists");
      orgName = ctx.orgName;
      vars = ctx.vars;
    } else {
      vars = { ...SAMPLE_TEMPLATE_VALUES, orgName }; // a "send test" row
    }

    const email = getEmailProvider();
    provider = email.name;
    const subject = renderTemplate(t.subject, key, vars, "text");
    const fragment = renderTemplate(t.bodyHtml, key, vars, "html");
    const text = htmlToText(fragment);
    const result: SendResult = await email.send({ to: n.recipientEmail, subject, html: emailLayout(orgName, fragment), text });

    await prisma.$transaction([
      prisma.notification.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), subject, body: fragment, lastError: null } }),
      prisma.notificationLog.create({ data: { notificationId: id, channel: "EMAIL", attempt: n.attempts, status: "SENT", provider, providerResponse: toJson(result.response) } }),
      prisma.emailLog.create({
        data: { notificationId: id, recipient: n.recipientEmail, subject, template: `${key}:${n.audience}`, status: "SENT", provider, providerMessageId: result.providerMessageId, sentAt: new Date() },
      }),
    ]);
    return "SENT";
  } catch (err) {
    const skipped = err instanceof SkipError;
    const permanent = skipped || err instanceof TemplateError || (err instanceof DeliveryError && err.permanent);
    const message = (err as Error).message ?? String(err);
    const finalAttempt = n.attempts >= MAX_NOTIFICATION_ATTEMPTS;
    const status = skipped ? "SKIPPED" : "FAILED";
    if (!skipped && !(err instanceof DeliveryError) && !(err instanceof TemplateError)) {
      logger.error({ err, notificationId: id }, "notification delivery crashed");
    }
    await prisma.$transaction([
      prisma.notification.update({
        where: { id },
        // Permanent problems are closed by exhausting the attempts; transient ones retry after backoff.
        data: { status, lastError: message.slice(0, 1000), ...(permanent ? { attempts: MAX_NOTIFICATION_ATTEMPTS } : {}) },
      }),
      prisma.notificationLog.create({
        data: {
          notificationId: id,
          channel: "EMAIL",
          attempt: n.attempts,
          status: "FAILED",
          provider,
          error: message.slice(0, 1000),
          providerResponse: err instanceof DeliveryError ? toJson(err.response) : undefined,
        },
      }),
      ...(provider && !skipped && n.recipientEmail
        ? [
            prisma.emailLog.create({
              data: { notificationId: id, recipient: n.recipientEmail, subject: n.subject ?? key, template: `${key}:${n.audience}`, status: "FAILED", provider, error: message.slice(0, 1000) },
            }),
          ]
        : []),
    ]);
    if (skipped) return "SKIPPED";
    return permanent || finalAttempt ? "FAILED" : "RETRY";
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return { text: v.slice(0, 2000) };
  try {
    return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

/** Rows ready for delivery now, oldest first. */
export async function findDueNotifications(limit: number, now = new Date()): Promise<{ id: string; attempts: number }[]> {
  return prisma.$queryRaw<{ id: string; attempts: number }[]>`
    SELECT "id", "attempts" FROM "notifications"
    WHERE ("status" = 'QUEUED' AND ("scheduledFor" IS NULL OR "scheduledFor" <= ${now}))
       OR ("status" = 'FAILED' AND "attempts" < ${MAX_NOTIFICATION_ATTEMPTS}
           AND "updatedAt" <= ${now}::timestamptz - make_interval(mins => LEAST(60, power(2, GREATEST("attempts" - 1, 0)))::int))
    ORDER BY COALESCE("scheduledFor", "createdAt")
    LIMIT ${limit}`;
}

/** A worker died mid-send: make the row retryable again. */
export async function recoverStuckNotifications(now = new Date()): Promise<number> {
  const r = await prisma.notification.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    data: { status: "FAILED", lastError: "Interrupted while sending; will retry" },
  });
  return r.count;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(lanes);
}

/** Delivers (or enqueues, with BullMQ) everything that is due. Returns rows handled. */
export async function dispatchDue(now = new Date()): Promise<number> {
  await recoverStuckNotifications(now);
  let handled = 0;
  for (let round = 0; round < 20; round++) {
    const due = await findDueNotifications(100, now);
    if (!due.length) break;
    if (env.QUEUE_ENABLED) {
      await enqueueTasks(TASK_QUEUE, due.map((d) => ({ jobId: d.id, data: { id: d.id } })));
      return handled + due.length; // workers take it from here
    }
    await runPool(due, INLINE_CONCURRENCY, (d) =>
      deliverNotification(d.id, now).catch((err) => logger.error({ err, notificationId: d.id }, "notification delivery failed")),
    );
    handled += due.length;
    if (due.length < 100) break;
  }
  return handled;
}

registerTaskQueue(TASK_QUEUE, async (data) => {
  await deliverNotification(String(data.id));
});

// ---------------------------------------------------------------------------
// Prompt dispatch after new rows are queued (the cron/scheduler sweep is the
// backstop — see jobs/scheduler.ts locally, or the /internal/cron routes on
// Vercel). waitUntil() keeps a serverless function alive long enough to
// finish this after the response is sent; outside Vercel it's a no-op and
// the promise just runs in the background as it always did.
// ---------------------------------------------------------------------------

let running = false;
let again = false;
let autoDispatch = !isTest;

/** Tests drive delivery explicitly. */
export function setAutoDispatch(on: boolean): void {
  autoDispatch = on;
}

export function requestDispatch(): void {
  if (!autoDispatch) return;
  waitUntil(runDispatchOnce());
}

/** Single-flight wrapper used by the timer and the scheduler. */
export async function runDispatchOnce(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await dispatchDue();
    } while (again);
  } catch (err) {
    logger.error({ err }, "notification dispatch failed");
  } finally {
    running = false;
  }
}
