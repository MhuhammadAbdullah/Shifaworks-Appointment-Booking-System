/**
 * Transactional outbox. Domain code calls queueNotifications(tx, …) inside the
 * same transaction that changes the booking/payment, so a notification row
 * exists if and only if the change committed. Delivery happens later
 * (dispatcher.ts); a unique dedupeKey makes every call idempotent.
 */
import { randomUUID } from "node:crypto";
import type { EmailTemplateKey, NotificationAudience } from "@booking/shared";
import type { DbClient } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { adminEmailsFor, loadInviteContext, loadNotificationContext, recipientsFor } from "./context.js";
import { requestDispatch } from "./dispatcher.js";

export interface QueueNotificationsInput {
  templateKey: EmailTemplateKey;
  bookingId: string;
  /** Limit to these audiences (default: every audience with an active template). */
  audiences?: readonly NotificationAudience[];
  /** Distinguishes repeatable events on one booking (e.g. a second payment rejection, another reschedule). */
  occurrence?: string;
}

/** Queues every active, matching template. Returns the number of new rows (deduped rows are not recounted). */
export async function queueNotifications(db: DbClient, input: QueueNotificationsInput): Promise<number> {
  const ctx = await loadNotificationContext(db, input.bookingId);
  if (!ctx) return 0;
  const templates = await db.emailTemplate.findMany({
    where: {
      organizationId: ctx.organizationId,
      key: input.templateKey,
      isActive: true,
      ...(input.audiences ? { audience: { in: [...input.audiences] } } : {}),
    },
    select: { id: true, audience: true },
  });
  if (!templates.length) return 0;
  const admins = templates.some((t) => t.audience === "ADMIN") ? await adminEmailsFor(ctx.organizationId) : [];

  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const t of templates) {
    for (const r of recipientsFor(t.audience, ctx, admins)) {
      const skip = r.email ? null : "No email address on file";
      rows.push({
        organizationId: ctx.organizationId,
        bookingId: input.bookingId,
        templateId: t.id,
        templateKey: input.templateKey,
        audience: t.audience,
        channel: "EMAIL",
        recipientName: r.name,
        recipientEmail: r.email,
        recipientPhone: r.phone,
        dedupeKey: [input.templateKey, input.bookingId, t.audience, r.key, input.occurrence ?? "-"].join(":"),
        status: skip ? "SKIPPED" : "QUEUED",
        lastError: skip,
      });
    }
  }
  if (!rows.length) return 0;
  const { count } = await db.notification.createMany({ data: rows, skipDuplicates: true });
  if (count) requestDispatch();
  return count;
}

// ---------------------------------------------------------------------------
// Account-level messages (STAFF_INVITE) — one recipient (the invited user
// themselves), so this skips the audience fan-out queueNotifications does.
// ---------------------------------------------------------------------------

export interface QueueInviteEmailInput {
  templateKey: EmailTemplateKey; // STAFF_INVITE
  userId: string;
  /** Admin-set or system-generated plaintext password — never persisted anywhere else once Supabase hashes it. */
  password: string;
}

/** Queues (and requests delivery of) the STAFF_INVITE email. Every call is its own occurrence — a resend always gets a fresh password and must always send again, never dedupe against an earlier one. */
export async function queueInviteEmail(db: DbClient, input: QueueInviteEmailInput): Promise<number> {
  const ctx = await loadInviteContext(db, input.userId, input.password);
  if (!ctx) return 0;
  const template = await db.emailTemplate.findFirst({
    where: { organizationId: ctx.organizationId, key: input.templateKey, audience: "STAFF", isActive: true },
    select: { id: true },
  });
  if (!template) return 0;

  const skip = ctx.recipient.email ? null : "No email address on file";
  const { count } = await db.notification.createMany({
    data: [
      {
        organizationId: ctx.organizationId,
        userId: input.userId,
        credential: input.password,
        templateId: template.id,
        templateKey: input.templateKey,
        audience: "STAFF",
        channel: "EMAIL",
        recipientName: ctx.recipient.name,
        recipientEmail: ctx.recipient.email,
        recipientPhone: ctx.recipient.phone,
        dedupeKey: [input.templateKey, input.userId, randomUUID()].join(":"),
        status: skip ? "SKIPPED" : "QUEUED",
        lastError: skip,
      },
    ],
  });
  if (count) requestDispatch();
  return count;
}
