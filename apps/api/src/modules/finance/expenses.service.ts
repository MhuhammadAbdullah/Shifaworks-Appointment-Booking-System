/**
 * Expenses: draft → approved/rejected → paid. Approval needs expenses.approve
 * and cannot be done by the person who submitted it (separation of duties;
 * super admins excepted). Marking paid posts the EXPENSE ledger entry.
 */
import { DateTime } from "luxon";
import { slugify, type CreateExpenseInput, type ExpenseActionInput, type ExpenseCategoryDto, type ExpenseDto, type ListExpensesQuery, type UpdateExpenseInput } from "@booking/shared";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { nextDocumentNumber } from "../../lib/document-sequence.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { toCsv } from "../../utils/csv.js";
import { dateOnly, definedOnly, money, parseDateOnly } from "../../utils/serialize.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { hasPermission } from "../auth/permission-rules.js";
import type { Principal } from "../auth/principal.service.js";
import { assertPrivateFile } from "../files/files.service.js";
import { D } from "./money.js";
import { postLedgerEntry } from "./ledger.js";

const include = {
  category: { select: { id: true, name: true, slug: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  approvedBy: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.ExpenseInclude;
type Row = Prisma.ExpenseGetPayload<{ include: typeof include }>;
const full = (u: { firstName: string; lastName: string | null } | null) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null);

function toDto(e: Row): ExpenseDto {
  return {
    id: e.id,
    expenseNumber: e.expenseNumber,
    category: { id: e.category.id, name: e.category.name },
    vendor: e.vendor,
    description: e.description,
    amount: money(e.amount),
    currency: e.currency,
    paymentMethod: e.paymentMethod,
    reference: e.reference,
    expenseDate: dateOnly(e.expenseDate)!,
    status: e.status,
    receiptFileId: e.receiptFileId,
    createdBy: full(e.createdBy),
    approvedBy: full(e.approvedBy),
    approvedAt: e.approvedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

async function load(db: DbClient, p: Principal, id: string) {
  const row = await db.expense.findFirst({ where: { id, organizationId: p.organizationId }, include });
  if (!row) throw AppError.notFound("Expense");
  return row;
}

async function assertRefs(db: DbClient, p: Principal, input: Partial<CreateExpenseInput>) {
  if (input.categoryId) {
    const cat = await db.expenseCategory.findFirst({ where: { id: input.categoryId, organizationId: p.organizationId, status: "ACTIVE" } });
    if (!cat) throw AppError.validation([{ path: "categoryId", message: "Category not found" }]);
  }
  await assertPrivateFile(db, p.organizationId, input.receiptFileId, "receiptFileId");
}

function expensesWhere(p: Principal, q: Partial<ListExpensesQuery>): Prisma.ExpenseWhereInput {
  return {
    organizationId: p.organizationId,
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.from || q.to ? { expenseDate: { ...(q.from ? { gte: parseDateOnly(q.from) } : {}), ...(q.to ? { lte: parseDateOnly(q.to) } : {}) } } : {}),
    ...(q.search
      ? {
          OR: [
            { expenseNumber: { contains: q.search, mode: "insensitive" } },
            { vendor: { contains: q.search, mode: "insensitive" } },
            { description: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listExpenses(p: Principal, q: ListExpensesQuery) {
  if (!hasPermission(p, "expenses.view")) throw AppError.forbidden();
  const where = expensesWhere(p, q);
  const [total, rows, totals] = await prisma.$transaction([
    prisma.expense.count({ where }),
    prisma.expense.findMany({ where, include, orderBy: [{ expenseDate: "desc" }, { expenseNumber: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
  ]);
  return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize, sum: money(D(totals._sum.amount ?? 0)) };
}

export async function getExpense(p: Principal, id: string) {
  if (!hasPermission(p, "expenses.view")) throw AppError.forbidden();
  return toDto(await load(prisma, p, id));
}

export async function createExpense(p: Principal, input: CreateExpenseInput, ctx: AuditContext) {
  if (!hasPermission(p, "expenses.create")) throw AppError.forbidden();
  const id = await prisma.$transaction(async (tx) => {
    await assertRefs(tx, p, input);
    const e = await tx.expense.create({
      data: {
        organizationId: p.organizationId,
        expenseNumber: await nextDocumentNumber(tx, p.organizationId, "EXP", DateTime.now().setZone(p.organization.timezone).year),
        categoryId: input.categoryId,
        vendor: input.vendor ?? null,
        description: input.description,
        amount: input.amount,
        currency: p.organization.currency,
        paymentMethod: input.paymentMethod ?? null,
        reference: input.reference ?? null,
        expenseDate: parseDateOnly(input.expenseDate),
        receiptFileId: input.receiptFileId ?? null,
        status: "DRAFT",
        createdById: p.userId,
      },
    });
    await recordAudit(tx, ctx, { action: "expense.create", entityType: "expense", entityId: e.id, newValues: input });
    return e.id;
  });
  return getExpense(p, id);
}

export async function updateExpense(p: Principal, id: string, input: UpdateExpenseInput, ctx: AuditContext) {
  if (!hasPermission(p, "expenses.update")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const before = await load(tx, p, id);
    if (before.status !== "DRAFT" && before.status !== "REJECTED") throw AppError.badRequest("Approved or paid expenses cannot be edited");
    await assertRefs(tx, p, input);
    const { expenseDate, ...rest } = input;
    await tx.expense.update({
      where: { id },
      data: { ...definedOnly(rest), ...(expenseDate ? { expenseDate: parseDateOnly(expenseDate) } : {}), status: "DRAFT" } as Prisma.ExpenseUncheckedUpdateInput,
    });
    await recordAudit(tx, ctx, { action: "expense.update", entityType: "expense", entityId: id, oldValues: toDto(before), newValues: input });
  });
  return getExpense(p, id);
}

export async function expenseAction(p: Principal, id: string, input: ExpenseActionInput, ctx: AuditContext) {
  if (!hasPermission(p, "expenses.approve")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const e = await load(tx, p, id);
    const now = new Date();
    if (input.action === "approve" || input.action === "reject") {
      if (e.status !== "DRAFT") throw AppError.badRequest(`A ${e.status.toLowerCase()} expense cannot be ${input.action === "approve" ? "approved" : "rejected"}`);
      if (e.createdById === p.userId && !p.isSuperAdmin) throw AppError.forbidden("You cannot approve or reject your own expense");
      await tx.expense.update({ where: { id }, data: { status: input.action === "approve" ? "APPROVED" : "REJECTED", approvedById: p.userId, approvedAt: now } });
    } else {
      if (e.status !== "APPROVED") throw AppError.badRequest("Only approved expenses can be marked as paid");
      const method = input.paymentMethod ?? e.paymentMethod;
      await tx.expense.update({ where: { id }, data: { status: "PAID", paymentMethod: method, reference: input.reference ?? e.reference } });
      await postLedgerEntry(tx, {
        organizationId: p.organizationId,
        orgTimezone: p.organization.timezone,
        type: "EXPENSE",
        amount: e.amount,
        currency: e.currency,
        paymentMethod: method,
        categorySlug: e.category.slug,
        expenseId: e.id,
        reference: e.expenseNumber,
        notes: [e.vendor, e.description].filter(Boolean).join(": "),
        transactionDate: DateTime.fromJSDate(e.expenseDate, { zone: "UTC" }).setZone(p.organization.timezone, { keepLocalTime: true }).set({ hour: 12 }).toJSDate(),
        createdById: p.userId,
      });
    }
    await recordAudit(tx, ctx, { action: `expense.${input.action}`, entityType: "expense", entityId: id, oldValues: { status: e.status } });
  });
  return getExpense(p, id);
}

export async function deleteExpense(p: Principal, id: string, ctx: AuditContext) {
  if (!hasPermission(p, "expenses.update")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const e = await load(tx, p, id);
    if (e.status === "APPROVED" || e.status === "PAID") throw AppError.badRequest("Approved or paid expenses cannot be deleted");
    await tx.expense.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: "expense.delete", entityType: "expense", entityId: id, oldValues: toDto(e) });
  });
}

export async function exportExpensesCsv(p: Principal, q: Partial<ListExpensesQuery>): Promise<string> {
  if (!hasPermission(p, "expenses.view")) throw AppError.forbidden();
  const rows = await prisma.expense.findMany({ where: expensesWhere(p, q), include, orderBy: [{ expenseDate: "desc" }, { expenseNumber: "desc" }], take: 50_000 });
  const header = ["Number", "Category", "Vendor", "Description", "Amount", "Currency", "Method", "Reference", "Date", "Status", "Created by", "Approved by"];
  return toCsv(
    header,
    rows.map((e) => [
      e.expenseNumber,
      e.category.name,
      e.vendor ?? "",
      e.description,
      e.amount.toFixed(2),
      e.currency,
      e.paymentMethod ?? "",
      e.reference ?? "",
      dateOnly(e.expenseDate) ?? "",
      e.status,
      full(e.createdBy) ?? "",
      full(e.approvedBy) ?? "",
    ]),
  );
}

export async function listExpenseCategories(p: Principal): Promise<ExpenseCategoryDto[]> {
  if (!hasPermission(p, "expenses.view") && !hasPermission(p, "finance.view")) throw AppError.forbidden();
  return prisma.expenseCategory.findMany({ where: { organizationId: p.organizationId, status: "ACTIVE" }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } });
}

export async function createExpenseCategory(p: Principal, nameInput: string, ctx: AuditContext) {
  if (!hasPermission(p, "expenses.approve")) throw AppError.forbidden();
  const slug = slugify(nameInput);
  const exists = await prisma.expenseCategory.findFirst({ where: { organizationId: p.organizationId, slug } });
  if (exists) throw AppError.conflict("A category with this name already exists");
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.expenseCategory.create({ data: { organizationId: p.organizationId, name: nameInput, slug } });
    // Mirror as a finance category so paid expenses are reported under the same name.
    await tx.financeCategory.upsert({
      where: { organizationId_type_slug: { organizationId: p.organizationId, type: "EXPENSE", slug } },
      create: { organizationId: p.organizationId, type: "EXPENSE", name: nameInput, slug },
      update: {},
    });
    await recordAudit(tx, ctx, { action: "expense.category.create", entityType: "expense_category", entityId: c.id, newValues: { name: nameInput } });
    return c;
  });
  return { id: row.id, name: row.name, slug: row.slug };
}
