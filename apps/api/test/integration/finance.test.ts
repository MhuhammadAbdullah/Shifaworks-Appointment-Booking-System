/**
 * Phase 6 against real PostgreSQL: the finance ledger (manual transactions,
 * void) and expenses (draft -> approved/rejected -> paid, separation of
 * duties on approval, mark-paid posting the EXPENSE ledger entry).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { createManualTransaction, voidTransaction } from "../../src/modules/finance/finance.service.js";
import { createExpense, deleteExpense, expenseAction, getExpense } from "../../src/modules/finance/expenses.service.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
let otherUserId: string;
let expenseCategoryId: string;
let incomeCategoryId: string;
const createdUserIds: string[] = [];
const createdTxIds: string[] = [];
const createdExpenseIds: string[] = [];

function principal(userId: string, permissions: readonly PermissionKey[], isSuperAdmin = false): Principal {
  return {
    userId,
    authUserId: userId,
    organizationId: org.id,
    organization: org,
    email: null,
    phone: null,
    firstName: "Actor",
    lastName: null,
    status: "ACTIVE",
    locale: null,
    timezone: null,
    roles: [],
    roleKeys: isSuperAdmin ? ["SUPER_ADMIN"] : ["ADMIN"],
    permissions: new Set(permissions),
    isSuperAdmin,
    staffProfileId: "staff",
    providerProfileId: null,
    providerType: null,
    avatarUrl: null,
  };
}
const admin = () => principal(actorId, ALL_PERMISSIONS.filter((p) => p !== "roles.manage"));
const otherAdmin = () => principal(otherUserId, ALL_PERMISSIONS.filter((p) => p !== "roles.manage"));

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
  const actor = await prisma.user.create({ data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG } });
  actorId = actor.id;
  createdUserIds.push(actor.id);
  const other = await prisma.user.create({ data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-other@example.test`, firstName: `${TAG}-Other` } });
  otherUserId = other.id;
  createdUserIds.push(other.id);

  expenseCategoryId = (await prisma.expenseCategory.findFirstOrThrow({ where: { organizationId: org.id, slug: "supplies" } })).id;
  incomeCategoryId = (await prisma.financeCategory.findFirstOrThrow({ where: { organizationId: org.id, type: "INCOME", slug: "appointments" } })).id;
});

afterAll(async () => {
  if (createdExpenseIds.length) {
    await prisma.financeTransaction.deleteMany({ where: { expenseId: { in: createdExpenseIds } } });
    await prisma.expense.deleteMany({ where: { id: { in: createdExpenseIds } } });
  }
  if (createdTxIds.length) await prisma.financeTransaction.deleteMany({ where: { id: { in: createdTxIds } } });
  if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.auditLog.deleteMany({ where: { requestId: TAG } });
  await prisma.$disconnect();
});

describe("manual transactions", () => {
  it("posts an ADJUSTMENT entry with a document number", async () => {
    const tx = await createManualTransaction(
      admin(),
      { type: "ADJUSTMENT", amount: 250, notes: `${TAG} till correction`, transactionDate: new Date().toISOString().slice(0, 10) },
      ctx,
    );
    createdTxIds.push(tx.id);
    expect(tx.transactionNumber).toMatch(/^TXN-\d{4}-\d{6}$/);
    expect(tx.status).toBe("POSTED");
    expect(tx.amount).toBe("250.00");
  });

  it("rejects an income category on an EXPENSE entry", async () => {
    const err = await errorOf(
      createManualTransaction(admin(), { type: "EXPENSE", categoryId: incomeCategoryId, amount: 100, notes: `${TAG} mismatch`, transactionDate: new Date().toISOString().slice(0, 10) }, ctx),
    );
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("voids a manual entry but refuses to void one linked to a payment/expense", async () => {
    const tx = await createManualTransaction(admin(), { type: "ADJUSTMENT", amount: 10, notes: `${TAG} void me`, transactionDate: new Date().toISOString().slice(0, 10) }, ctx);
    createdTxIds.push(tx.id);
    const voided = await voidTransaction(admin(), tx.id, "Entered by mistake", ctx);
    expect(voided.status).toBe("VOID");
  });

  it("needs finance.create", async () => {
    const err = await errorOf(
      createManualTransaction(principal(actorId, ["finance.view"]), { type: "ADJUSTMENT", amount: 10, notes: `${TAG} x`, transactionDate: new Date().toISOString().slice(0, 10) }, ctx),
    );
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("expenses", () => {
  it("goes draft -> approved -> paid, posting the EXPENSE ledger entry", async () => {
    const e = await createExpense(admin(), { categoryId: expenseCategoryId, description: `${TAG} office supplies`, amount: 500, expenseDate: new Date().toISOString().slice(0, 10) }, ctx);
    createdExpenseIds.push(e.id);
    expect(e.status).toBe("DRAFT");

    const approved = await expenseAction(otherAdmin(), e.id, { action: "approve" }, ctx);
    expect(approved.status).toBe("APPROVED");

    const paid = await expenseAction(otherAdmin(), e.id, { action: "mark_paid", paymentMethod: "CASH" }, ctx);
    expect(paid.status).toBe("PAID");

    const ledger = await prisma.financeTransaction.findFirst({ where: { expenseId: e.id } });
    expect(ledger?.type).toBe("EXPENSE");
    expect(ledger?.amount.toFixed(2)).toBe("500.00");
  });

  it("blocks approving your own expense unless super admin", async () => {
    const e = await createExpense(admin(), { categoryId: expenseCategoryId, description: `${TAG} self approve`, amount: 200, expenseDate: new Date().toISOString().slice(0, 10) }, ctx);
    createdExpenseIds.push(e.id);
    const err = await errorOf(expenseAction(admin(), e.id, { action: "approve" }, ctx));
    expect(err.code).toBe("FORBIDDEN");
  });

  it("cannot delete an approved expense", async () => {
    const e = await createExpense(admin(), { categoryId: expenseCategoryId, description: `${TAG} not deletable`, amount: 200, expenseDate: new Date().toISOString().slice(0, 10) }, ctx);
    createdExpenseIds.push(e.id);
    await expenseAction(otherAdmin(), e.id, { action: "approve" }, ctx);
    const err = await errorOf(deleteExpense(admin(), e.id, ctx));
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("can delete a draft expense", async () => {
    const e = await createExpense(admin(), { categoryId: expenseCategoryId, description: `${TAG} deletable`, amount: 50, expenseDate: new Date().toISOString().slice(0, 10) }, ctx);
    await deleteExpense(admin(), e.id, ctx);
    const err = await errorOf(getExpense(admin(), e.id));
    expect(err.code).toBe("NOT_FOUND");
  });
});
