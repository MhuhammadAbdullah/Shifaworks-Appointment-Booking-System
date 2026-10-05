/**
 * Weekly housekeeping: audit logs and email logs older than
 * LOG_ARCHIVE_RETENTION_DAYS are exported to a CSV in the archive bucket,
 * then deleted from the hot table (keeps both tables — and their indexes —
 * small under normal load). A batch is only deleted after its CSV upload
 * succeeds, so a storage failure never loses rows.
 */
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../lib/prisma.js";
import { uploadBuffer } from "../lib/cloudinary.js";
import { toCsv } from "../utils/csv.js";

const BATCH_SIZE = 5_000;
const MAX_ROUNDS = 20; // per table, per run — well above one week's worth of normal traffic

async function upload(path: string, csv: string): Promise<void> {
  try {
    await uploadBuffer(Buffer.from(csv, "utf-8"), path, { resourceType: "raw", type: "authenticated" });
  } catch (err) {
    throw new Error(`archive upload failed for ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));

async function archiveAuditLogs(cutoff: Date, now: Date): Promise<number> {
  const header = ["ID", "Organization ID", "User ID", "Action", "Entity type", "Entity ID", "Old values", "New values", "IP address", "User agent", "Request ID", "Created at"];
  let archived = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const rows = await prisma.auditLog.findMany({ where: { createdAt: { lt: cutoff } }, orderBy: { createdAt: "asc" }, take: BATCH_SIZE });
    if (!rows.length) break;
    const csv = toCsv(
      header,
      rows.map((r) => [r.id, r.organizationId ?? "", r.userId ?? "", r.action, r.entityType, r.entityId ?? "", json(r.oldValues), json(r.newValues), r.ipAddress ?? "", r.userAgent ?? "", r.requestId ?? "", r.createdAt.toISOString()]),
    );
    await upload(`audit-logs/${now.toISOString().slice(0, 10)}_${randomUUID()}.csv`, csv);
    await prisma.auditLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    archived += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
  return archived;
}

async function archiveEmailLogs(cutoff: Date, now: Date): Promise<number> {
  const header = ["ID", "Notification ID", "Recipient", "Subject", "Template", "Status", "Provider", "Provider message ID", "Provider response", "Error", "Sent at", "Created at"];
  let archived = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const rows = await prisma.emailLog.findMany({ where: { createdAt: { lt: cutoff } }, orderBy: { createdAt: "asc" }, take: BATCH_SIZE });
    if (!rows.length) break;
    const csv = toCsv(
      header,
      rows.map((r) => [r.id, r.notificationId ?? "", r.recipient, r.subject, r.template ?? "", r.status, r.provider, r.providerMessageId ?? "", json(r.providerResponse), r.error ?? "", r.sentAt?.toISOString() ?? "", r.createdAt.toISOString()]),
    );
    await upload(`email-logs/${now.toISOString().slice(0, 10)}_${randomUUID()}.csv`, csv);
    await prisma.emailLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    archived += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
  return archived;
}

/** Runs both archive sweeps. Safe to call repeatedly — a no-op once nothing is older than the retention window. */
export async function archiveOldLogs(now = new Date()): Promise<{ auditLogs: number; emailLogs: number }> {
  const cutoff = new Date(now.getTime() - env.LOG_ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const auditLogs = await archiveAuditLogs(cutoff, now);
  const emailLogs = await archiveEmailLogs(cutoff, now);
  if (auditLogs || emailLogs) logger.info({ auditLogs, emailLogs, cutoff }, "log archive sweep completed");
  return { auditLogs, emailLogs };
}
