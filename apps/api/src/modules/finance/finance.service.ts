/**
 * The finance ledger: transactions (posted by payments, refunds, paid
 * expenses, or entered by hand) and their categories. Every row here is
 * append-only — voiding an entry marks it VOID rather than deleting it.
 */
import { DateTime } from "luxon";
import {
  PAYMENT_METHOD_LABELS,
  slugify,
  type CreateFinanceTxInput,
  type FinanceCategoryDto,
  type FinanceSummaryDto,
  type FinanceTransactionDto,
  type ListFinanceTxQuery,
  type PaymentMethod,
} from "@booking/shared";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { money } from "../../utils/serialize.js";
import { toCsv } from "../../utils/csv.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { hasPermission } from "../auth/permission-rules.js";
import type { Principal } from "../auth/principal.service.js";
import { D, ZERO } from "./money.js";
import { postLedgerEntry } from "./ledger.js";

const txInclude = {
  category: { select: { id: true, name: true } },
  booking: { select: { id: true, bookingNumber: true } },
  createdBy: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.FinanceTransactionInclude;
type TxRow = Prisma.FinanceTransactionGetPayload<{ include: typeof txInclude }>;

const full = (u: { firstName: string; lastName: string | null } | null) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null);

function toDto(t: TxRow): FinanceTransactionDto {
  return {
    id: t.id,
    transactionNumber: t.transactionNumber,
    type: t.type,
    status: t.status,
    category: t.category,
    amount: money(t.amount),
    currency: t.currency,
    paymentMethod: t.paymentMethod,
    reference: t.reference,
    booking: t.booking,
    paymentId: t.paymentId,
    expenseId: t.expenseId,
    notes: t.notes,
    transactionDate: t.transactionDate.toISOString(),
    createdBy: full(t.createdBy),
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

function txWhere(p: Principal, q: Partial<ListFinanceTxQuery>): Prisma.FinanceTransactionWhereInput {
  const dates = range(p.organization.timezone, q.from, q.to);
  return {
    organizationId: p.organizationId,
    ...(q.type ? { type: q.type } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(dates ? { transactionDate: dates } : {}),
    ...(q.search
      ? {
          OR: [
            { transactionNumber: { contains: q.search, mode: "insensitive" } },
            { reference: { contains: q.search, mode: "insensitive" } },
            { notes: { contains: q.search, mode: "insensitive" } },
            { booking: { bookingNumber: { contains: q.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

export async function listTransactions(p: Principal, q: ListFinanceTxQuery) {
  if (!hasPermission(p, "finance.view")) throw AppError.forbidden();
  const where = txWhere(p, q);
  const [total, rows] = await prisma.$transaction([
    prisma.financeTransaction.count({ where }),
    prisma.financeTransaction.findMany({ where, include: txInclude, orderBy: [{ transactionDate: "desc" }, { transactionNumber: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
}

export async function createManualTransaction(p: Principal, input: CreateFinanceTxInput, ctx: AuditContext) {
  if (!hasPermission(p, "finance.create")) throw AppError.forbidden();
  if (input.categoryId) {
    const cat = await prisma.financeCategory.findFirst({ where: { id: input.categoryId, organizationId: p.organizationId } });
    if (!cat) throw AppError.validation([{ path: "categoryId", message: "Category not found" }]);
    if (input.type !== "ADJUSTMENT" && cat.type !== input.type) {
      throw AppError.validation([{ path: "categoryId", message: `Choose a${input.type === "INCOME" ? "n income" : "n expense"} category` }]);
    }
  }
  const id = await prisma.$transaction(async (tx) => {
    const txId = await postLedgerEntry(tx, {
      organizationId: p.organizationId,
      orgTimezone: p.organization.timezone,
      type: input.type,
      amount: D(input.amount),
      currency: p.organization.currency,
      paymentMethod: input.paymentMethod ?? null,
      categoryId: input.categoryId ?? null,
      reference: input.reference ?? null,
      notes: input.notes,
      transactionDate: DateTime.fromISO(input.transactionDate, { zone: p.organization.timezone }).set({ hour: 12 }).toJSDate(),
      createdById: p.userId,
    });
    await recordAudit(tx, ctx, { action: "finance.transaction.create", entityType: "finance_transaction", entityId: txId, newValues: input });
    return txId;
  });
  return toDto(await prisma.financeTransaction.findUniqueOrThrow({ where: { id }, include: txInclude }));
}

/** Only manual entries can be voided; payment/expense entries are reversed by refunds. */
export async function voidTransaction(p: Principal, id: string, reason: string, ctx: AuditContext) {
  if (!hasPermission(p, "finance.update")) throw AppError.forbidden();
  await prisma.$transaction(async (tx) => {
    const t = await tx.financeTransaction.findFirst({ where: { id, organizationId: p.organizationId } });
    if (!t) throw AppError.notFound("Transaction");
    if (t.paymentId || t.expenseId) throw AppError.badRequest("This entry comes from a payment or expense. Refund or change that instead.");
    if (t.status === "VOID") return;
    await tx.financeTransaction.update({ where: { id }, data: { status: "VOID", notes: [t.notes, `Voided: ${reason}`].filter(Boolean).join("\n") } });
    await recordAudit(tx, ctx, { action: "finance.transaction.void", entityType: "finance_transaction", entityId: id, newValues: { reason } });
  });
  return toDto(await prisma.financeTransaction.findUniqueOrThrow({ where: { id }, include: txInclude }));
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listFinanceCategories(p: Principal): Promise<FinanceCategoryDto[]> {
  if (!hasPermission(p, "finance.view") && !hasPermission(p, "expenses.view")) throw AppError.forbidden();
  return prisma.financeCategory.findMany({
    where: { organizationId: p.organizationId, status: "ACTIVE" },
    select: { id: true, type: true, name: true, slug: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

export async function createFinanceCategory(p: Principal, input: { name: string; type: "INCOME" | "EXPENSE" }, ctx: AuditContext) {
  if (!hasPermission(p, "finance.update")) throw AppError.forbidden();
  const slug = slugify(input.name);
  const exists = await prisma.financeCategory.findFirst({ where: { organizationId: p.organizationId, type: input.type, slug } });
  if (exists) throw AppError.conflict("A category with this name already exists");
  const row = await prisma.financeCategory.create({ data: { organizationId: p.organizationId, type: input.type, name: input.name, slug } });
  await recordAudit(prisma, ctx, { action: "finance.category.create", entityType: "finance_category", entityId: row.id, newValues: input });
  return { id: row.id, type: row.type, name: row.name, slug: row.slug };
}

// ---------------------------------------------------------------------------
// Summary & export
// ---------------------------------------------------------------------------

export async function financeSummary(p: Principal, from: string, to: string): Promise<FinanceSummaryDto> {
  if (!hasPermission(p, "finance.view")) throw AppError.forbidden();
  const tz = p.organization.timezone;
  const where: Prisma.FinanceTransactionWhereInput = { ...txWhere(p, { from, to }), status: "POSTED" };
  const fromUtc = DateTime.fromISO(from, { zone: tz }).toJSDate();
  const toUtc = DateTime.fromISO(to, { zone: tz }).plus({ days: 1 }).toJSDate();

  const [byType, byMethod, byCategory, categories, daily, outstanding] = await Promise.all([
    prisma.financeTransaction.groupBy({ by: ["type"], where, _sum: { amount: true } }),
    prisma.financeTransaction.groupBy({ by: ["paymentMethod"], where: { ...where, type: "INCOME" }, _sum: { amount: true } }),
    prisma.financeTransaction.groupBy({ by: ["categoryId", "type"], where, _sum: { amount: true } }),
    prisma.financeCategory.findMany({ where: { organizationId: p.organizationId }, select: { id: true, name: true } }),
    prisma.$queryRaw<{ day: string; type: string; total: string }[]>`
      SELECT to_char(("transactionDate" AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day, "type"::text AS type, SUM("amount")::text AS total
      FROM "finance_transactions"
      WHERE "organizationId" = ${p.organizationId}::uuid AND "status" = 'POSTED'
        AND "transactionDate" >= ${fromUtc} AND "transactionDate" < ${toUtc}
      GROUP BY 1, 2 ORDER BY 1`,
    prisma.$queryRaw<{ due: string | null }[]>`
      SELECT SUM("totalAmount" - "amountPaid")::text AS due FROM "bookings"
      WHERE "organizationId" = ${p.organizationId}::uuid AND "status" IN ('CONFIRMED', 'COMPLETED') AND "amountPaid" < "totalAmount"`,
  ]);

  const sum = (type: string) => D(byType.find((t) => t.type === type)?._sum.amount ?? 0);
  const income = sum("INCOME");
  const refunds = sum("REFUND");
  const expenses = sum("EXPENSE");
  const adjustments = sum("ADJUSTMENT");
  const names = new Map(categories.map((c) => [c.id, c.name]));

  const days = new Map<string, { income: ReturnType<typeof D>; outgoing: ReturnType<typeof D> }>();
  for (let d = DateTime.fromISO(from); d <= DateTime.fromISO(to); d = d.plus({ days: 1 })) days.set(d.toISODate()!, { income: ZERO, outgoing: ZERO });
  for (const r of daily) {
    const slot = days.get(r.day);
    if (!slot) continue;
    if (r.type === "INCOME" || r.type === "ADJUSTMENT") slot.income = slot.income.plus(r.total);
    else slot.outgoing = slot.outgoing.plus(r.total);
  }

  return {
    from,
    to,
    currency: p.organization.currency,
    income: money(income),
    refunds: money(refunds),
    expenses: money(expenses),
    adjustments: money(adjustments),
    net: money(income.plus(adjustments).minus(refunds).minus(expenses)),
    byMethod: byMethod
      .map((m) => ({ method: (m.paymentMethod ?? "UNSPECIFIED") as PaymentMethod | "UNSPECIFIED", amount: money(D(m._sum.amount ?? 0)) }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
    byCategory: byCategory
      .map((c) => ({ categoryId: c.categoryId, name: c.categoryId ? (names.get(c.categoryId) ?? "Unknown") : "Uncategorised", type: c.type, amount: money(D(c._sum.amount ?? 0)) }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
    daily: [...days.entries()].map(([date, v]) => ({ date, income: money(v.income), outgoing: money(v.outgoing) })),
    outstanding: money(D(outstanding[0]?.due ?? 0)),
  };
}

export async function exportTransactionsCsv(p: Principal, q: Partial<ListFinanceTxQuery>): Promise<string> {
  if (!hasPermission(p, "finance.export")) throw AppError.forbidden();
  const tz = p.organization.timezone;
  const rows = await prisma.financeTransaction.findMany({ where: txWhere(p, q), include: txInclude, orderBy: { transactionDate: "asc" }, take: 50_000 });
  const header = ["Number", "Date", "Type", "Status", "Category", "Amount", "Currency", "Method", "Reference", "Booking", "Notes", "Created by"];
  return toCsv(
    header,
    rows.map((t) => [
      t.transactionNumber,
      DateTime.fromJSDate(t.transactionDate, { zone: tz }).toFormat("yyyy-LL-dd HH:mm"),
      t.type,
      t.status,
      t.category?.name ?? "",
      (t.type === "INCOME" || t.type === "ADJUSTMENT" ? "" : "-") + t.amount.toFixed(2),
      t.currency,
      t.paymentMethod ? PAYMENT_METHOD_LABELS[t.paymentMethod] : "",
      t.reference ?? "",
      t.booking?.bookingNumber ?? "",
      t.notes ?? "",
      full(t.createdBy) ?? "System",
    ]),
  );
}
