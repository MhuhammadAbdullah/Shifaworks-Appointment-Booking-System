import type { Request } from "express";
import { DateTime } from "luxon";
import type { AuditLogDto, ListAuditLogsQuery } from "@booking/shared";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { logger } from "../../config/logger.js";
import { toCsv } from "../../utils/csv.js";
import { AppError } from "../../utils/app-error.js";
import { hasPermission } from "../auth/permission-rules.js";
import type { Principal } from "../auth/principal.service.js";

export interface AuditContext {
  organizationId: string | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface AuditEntry {
  action: string; // "user.roles.update"
  entityType: string; // "user"
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}

const SENSITIVE_KEYS = /pass(word)?|secret|token|authorization|cookie|signature/i;

/** Deep-copies a value into JSON, masking sensitive keys and Dates → ISO. */
function sanitize(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (depth > 6) return "[truncated]";
  if (value === null) return null as unknown as Prisma.InputJsonValue;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1) ?? null) as Prisma.InputJsonValue;
  if (value instanceof Set) return [...value].map((v) => sanitize(v, depth + 1) ?? null) as Prisma.InputJsonValue;
  if (typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[REDACTED]" : (sanitize(v, depth + 1) ?? null);
    }
    return out;
  }
  return value as Prisma.InputJsonValue;
}

export function auditContextFrom(req: Request): AuditContext {
  return {
    organizationId: req.principal?.organizationId ?? null,
    userId: req.principal?.userId ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
    requestId: req.id ? String(req.id) : null,
  };
}

/**
 * Writes an audit record. Pass the transaction client so the audit row
 * commits (or rolls back) together with the change it describes.
 */
export async function recordAudit(db: DbClient, ctx: AuditContext, entry: AuditEntry): Promise<void> {
  const oldValues = sanitize(entry.oldValues);
  const newValues = sanitize(entry.newValues);
  await db.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(oldValues !== undefined ? { oldValues } : {}),
      ...(newValues !== undefined ? { newValues } : {}),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    },
  });
  logger.info({ action: entry.action, entityType: entry.entityType, entityId: entry.entityId, by: ctx.userId }, "audit");
}

// ---------------------------------------------------------------------------
// Read: list / export (Phase 9)
// ---------------------------------------------------------------------------

const logInclude = { user: { select: { id: true, firstName: true, lastName: true } } } as const satisfies Prisma.AuditLogInclude;
type LogRow = Prisma.AuditLogGetPayload<{ include: typeof logInclude }>;

const fullName = (u: { firstName: string; lastName: string | null } | null) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null);

function toDto(l: LogRow): AuditLogDto {
  return {
    id: l.id,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId,
    user: l.user ? { id: l.user.id, name: fullName(l.user)! } : null,
    oldValues: l.oldValues,
    newValues: l.newValues,
    ipAddress: l.ipAddress,
    createdAt: l.createdAt.toISOString(),
  };
}

/** Local calendar range [from, to] → UTC instants. */
function range(tz: string, from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: DateTime.fromISO(from, { zone: tz }).toJSDate() } : {}),
    ...(to ? { lt: DateTime.fromISO(to, { zone: tz }).plus({ days: 1 }).toJSDate() } : {}),
  };
}

function logWhere(p: Principal, q: Partial<ListAuditLogsQuery>): Prisma.AuditLogWhereInput {
  const s = q.search?.trim();
  const dates = range(p.organization.timezone, q.from, q.to);
  return {
    organizationId: p.organizationId,
    ...(q.action ? { action: { contains: q.action, mode: "insensitive" } } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(s
      ? {
          OR: [
            { action: { contains: s, mode: "insensitive" } },
            { entityType: { contains: s, mode: "insensitive" } },
            { entityId: { contains: s, mode: "insensitive" } },
            { user: { is: { OR: [{ firstName: { contains: s, mode: "insensitive" } }, { lastName: { contains: s, mode: "insensitive" } }] } } },
          ],
        }
      : {}),
  };
}

export async function listAuditLogs(p: Principal, q: ListAuditLogsQuery) {
  if (!hasPermission(p, "audit.view")) throw AppError.forbidden();
  const where = logWhere(p, q);
  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, include: logInclude, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
}

export async function exportAuditLogsCsv(p: Principal, q: Partial<ListAuditLogsQuery>): Promise<string> {
  if (!hasPermission(p, "audit.view")) throw AppError.forbidden();
  const tz = p.organization.timezone;
  const rows = await prisma.auditLog.findMany({ where: logWhere(p, q), include: logInclude, orderBy: { createdAt: "asc" }, take: 50_000 });
  const header = ["Date", "Action", "Entity type", "Entity ID", "By", "IP address"];
  return toCsv(
    header,
    rows.map((l) => [DateTime.fromJSDate(l.createdAt, { zone: tz }).toFormat("yyyy-LL-dd HH:mm:ss"), l.action, l.entityType, l.entityId ?? "", fullName(l.user) ?? "System", l.ipAddress ?? ""]),
  );
}
