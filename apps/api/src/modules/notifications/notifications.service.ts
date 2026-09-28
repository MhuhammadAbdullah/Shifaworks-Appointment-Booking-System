import type { ChannelStatusDto, ListNotificationsQuery, NotificationDetailDto, NotificationDto, TestNotificationInput } from "@booking/shared";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { pingRedis } from "../../lib/redis.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.service.js";
import { deliverNotification, requestDispatch } from "./dispatcher.js";
import { getEmailProvider } from "./providers/index.js";

const include = { booking: { select: { id: true, bookingNumber: true } } } as const satisfies Prisma.NotificationInclude;
type Row = Prisma.NotificationGetPayload<{ include: typeof include }>;

function toDto(n: Row): NotificationDto {
  return {
    id: n.id,
    templateKey: n.templateKey,
    audience: n.audience,
    channel: n.channel,
    status: n.status,
    recipient: { name: n.recipientName, email: n.recipientEmail, phone: n.recipientPhone },
    booking: n.booking,
    subject: n.subject,
    scheduledFor: n.scheduledFor?.toISOString() ?? null,
    sentAt: n.sentAt?.toISOString() ?? null,
    attempts: n.attempts,
    lastError: n.lastError,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function listNotifications(p: Principal, q: ListNotificationsQuery) {
  const s = q.search?.trim();
  const where: Prisma.NotificationWhereInput = {
    organizationId: p.organizationId,
    ...(q.channel ? { channel: q.channel } : {}),
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.templateKey ? { templateKey: q.templateKey } : {}),
    ...(q.bookingId ? { bookingId: q.bookingId } : {}),
    ...(s
      ? {
          OR: [
            { recipientEmail: { contains: s, mode: "insensitive" } },
            { recipientName: { contains: s, mode: "insensitive" } },
            { subject: { contains: s, mode: "insensitive" } },
            { booking: { bookingNumber: { contains: s, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.notification.count({ where }),
    prisma.notification.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
}

export async function getNotification(p: Principal, id: string): Promise<NotificationDetailDto> {
  const n = await prisma.notification.findFirst({
    where: { id, organizationId: p.organizationId },
    include: { ...include, logs: { orderBy: { createdAt: "asc" } } },
  });
  if (!n) throw AppError.notFound("Notification");
  return {
    ...toDto(n),
    body: n.body,
    logs: n.logs.map((l) => ({ id: l.id, attempt: l.attempt, status: l.status, provider: l.provider, error: l.error, createdAt: l.createdAt.toISOString() })),
  };
}

/** Puts a failed/skipped notification back in the queue with fresh attempts. */
export async function retryNotification(p: Principal, id: string, ctx: AuditContext): Promise<NotificationDetailDto> {
  const r = await prisma.notification.updateMany({
    where: { id, organizationId: p.organizationId, status: { in: ["FAILED", "SKIPPED"] } },
    data: { status: "QUEUED", attempts: 0, lastError: null, scheduledFor: null },
  });
  if (r.count !== 1) throw AppError.badRequest("Only a failed or skipped message can be retried");
  await recordAudit(prisma, ctx, { action: "notification.retry", entityType: "notification", entityId: id });
  requestDispatch(200);
  return getNotification(p, id);
}

/** Sends one message with sample values to check the channel works — no bookingId, delivered synchronously. */
export async function sendTest(p: Principal, input: TestNotificationInput, ctx: AuditContext): Promise<NotificationDetailDto> {
  const template = await prisma.emailTemplate.findFirst({ where: { organizationId: p.organizationId, key: input.templateKey, audience: input.audience } });
  if (!template) throw AppError.badRequest("There is no template for this key and audience");
  const n = await prisma.notification.create({
    data: {
      organizationId: p.organizationId,
      templateId: template.id,
      templateKey: template.key,
      audience: template.audience,
      channel: "EMAIL",
      recipientEmail: input.to,
      bookingId: null,
    },
  });
  await recordAudit(prisma, ctx, { action: "notification.test", entityType: "notification", entityId: n.id, newValues: input });
  await deliverNotification(n.id);
  return getNotification(p, n.id);
}

export async function channelStatus(): Promise<ChannelStatusDto> {
  const email = getEmailProvider();
  return {
    email: { provider: email.name, configured: email.configured, from: email.configured ? env.EMAIL_FROM : null },
    queue: { mode: env.QUEUE_ENABLED ? "bullmq" : "in-process", redis: env.REDIS_URL ? await pingRedis() : false },
  };
}
