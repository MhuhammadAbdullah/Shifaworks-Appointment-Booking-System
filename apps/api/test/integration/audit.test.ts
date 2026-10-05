/**
 * Phase 9 against real PostgreSQL: the audit log's read side (list, filter,
 * CSV export). Writing is already exercised end-to-end by every other
 * module's tests via recordAudit — this file only checks the query/export
 * layer added in audit.service.ts, using a handful of rows recorded directly
 * with a TAG-embedded action so they can be found and cleaned up precisely.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { exportAuditLogsCsv, listAuditLogs, recordAudit } from "../../src/modules/audit/audit.service.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
const createdUserIds: string[] = [];

function principal(permissions: readonly PermissionKey[]): Principal {
  return {
    userId: actorId,
    authUserId: actorId,
    organizationId: org.id,
    organization: org,
    email: null,
    phone: null,
    firstName: "Actor",
    lastName: "Auditor",
    status: "ACTIVE",
    locale: null,
    timezone: null,
    roles: [],
    roleKeys: ["ADMIN"],
    permissions: new Set(permissions),
    isSuperAdmin: false,
    staffProfileId: "staff",
    providerProfileId: null,
    providerType: null,
    avatarUrl: null,
  };
}
const admin = () => principal(ALL_PERMISSIONS.filter((p) => p !== "roles.manage"));

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
    throw new Error("expected a rejection");
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  const actor = await prisma.user.create({ data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG, lastName: "Auditor" } });
  actorId = actor.id;
  createdUserIds.push(actor.id);

  const ctx = { organizationId: org.id, userId: actorId, ipAddress: "203.0.113.1", userAgent: "integration-test", requestId: TAG };
  await recordAudit(prisma, ctx, { action: `${TAG}.widget.create`, entityType: "widget", entityId: "w1", newValues: { name: "First" } });
  await recordAudit(prisma, ctx, { action: `${TAG}.widget.update`, entityType: "widget", entityId: "w1", oldValues: { name: "First" }, newValues: { name: "Second" } });
  await recordAudit(prisma, ctx, { action: `${TAG}.widget.delete`, entityType: "widget", entityId: "w1" });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: TAG } } });
  if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("audit logs", () => {
  it("lists entries filtered by action, newest first, with the actor's name attached", async () => {
    const { items, total } = await listAuditLogs(admin(), { page: 1, pageSize: 20, action: TAG });
    expect(total).toBe(3);
    expect(items.map((i) => i.action)).toEqual([`${TAG}.widget.delete`, `${TAG}.widget.update`, `${TAG}.widget.create`]);
    expect(items[0]!.user).toEqual({ id: actorId, name: `${TAG} Auditor` });
  });

  it("filters by entityType and search", async () => {
    const byEntity = await listAuditLogs(admin(), { page: 1, pageSize: 20, action: TAG, entityType: "widget" });
    expect(byEntity.total).toBe(3);
    const bySearch = await listAuditLogs(admin(), { page: 1, pageSize: 20, search: `${TAG}.widget.create` });
    expect(bySearch.total).toBe(1);
  });

  it("keeps old/new values intact for the update entry", async () => {
    const { items } = await listAuditLogs(admin(), { page: 1, pageSize: 20, action: `${TAG}.widget.update` });
    expect(items[0]!.oldValues).toEqual({ name: "First" });
    expect(items[0]!.newValues).toEqual({ name: "Second" });
  });

  it("exports a CSV with a header row and one line per entry", async () => {
    const csv = await exportAuditLogsCsv(admin(), { action: TAG });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Action,Entity type,Entity ID,By,IP address");
    expect(lines).toHaveLength(4); // header + 3 entries
    expect(csv).toContain(`${TAG} Auditor`);
  });

  it("needs audit.view to list or export", async () => {
    const listErr = await errorOf(listAuditLogs(principal([]), { page: 1, pageSize: 20 }));
    expect(listErr.code).toBe("FORBIDDEN");
    const exportErr = await errorOf(exportAuditLogsCsv(principal([]), {}));
    expect(exportErr.code).toBe("FORBIDDEN");
  });
});
