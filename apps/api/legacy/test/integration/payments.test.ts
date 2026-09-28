/**
 * Money flows against real PostgreSQL: online checkout + signed callbacks,
 * idempotency, tampering, amount mismatch, late-payment revival, partial and
 * manual payments, invoices, refunds, ledger integrity, events and expenses.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { ALL_PERMISSIONS } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { deleteTestNotifications, ids } from "./cleanup.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { createAppointmentBooking } from "../../src/modules/appointments/booking-engine.js";
import { createEventBooking } from "../../src/modules/events/event-booking-engine.js";
import { signDemoResult } from "../../src/modules/payments/gateways/demo.gateway.js";
import { processGatewayCallback, recordManualPayment, refundPayment, startCheckout } from "../../src/modules/payments/payments.service.js";
import { invoiceFromBooking, voidInvoice } from "../../src/modules/invoices/invoices.service.js";
import { createExpense, expenseAction } from "../../src/modules/finance/expenses.service.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };
const PREFIXES = ["APT", "EVT", "TKT", "PAY", "INV", "TXN", "EXP"] as const;

let org: { id: string; timezone: string; currency: string; name: string; slug: string };
let seqBefore: Record<string, number | null> = {};
const userIds: string[] = [];
const customerIds: string[] = [];
let providerId: string, serviceId: string, eventId: string, ticketTypeId: string;
let staff: Principal, staff2: Principal;
const customers: Principal[] = [];
let monday: string;
const at = (time: string, date = monday) => DateTime.fromISO(`${date}T${time}`, { zone: "Asia/Karachi" }).toJSDate();

function principal(userId: string, extra: Partial<Principal>): Principal {
  return {
    userId, authUserId: userId, organizationId: org.id, organization: org, email: null, phone: null, firstName: "T", lastName: null,
    status: "ACTIVE", locale: null, timezone: null, roles: [], roleKeys: [], permissions: new Set(), isSuperAdmin: false,
    staffProfileId: null, providerProfileId: null, providerType: null, customerProfileId: null, ...extra,
  };
}

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
}

const demoCallback = (paymentId: string, outcome: "SUCCEEDED" | "FAILED", amount: string, token = signDemoResult({ paymentId, outcome, amount })) =>
  processGatewayCallback("demo", { rawBody: Buffer.from(JSON.stringify({ token })), contentType: "application/json", headers: {} });

async function onlineHold(customer: Principal, time: string, date = monday) {
  return createAppointmentBooking(
    { organization: org, customerId: customer.customerProfileId!, serviceId, providerId, startsAt: at(time, date), source: "ONLINE", online: true, confirm: false, overrideAvailability: false, actorUserId: customer.userId },
    ctx,
  );
}

const ledger = (bookingId: string) => prisma.financeTransaction.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, timezone: o.timezone, currency: o.currency, name: o.name, slug: o.slug };
  const year = DateTime.now().setZone(org.timezone).year;
  for (const prefix of PREFIXES) {
    seqBefore[prefix] = (await prisma.documentSequence.findUnique({ where: { organizationId_prefix_year: { organizationId: org.id, prefix, year } } }))?.lastValue ?? null;
  }
  let d = DateTime.now().setZone("Asia/Karachi").plus({ days: 14 }).startOf("day");
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  monday = d.toISODate()!;

  const mk = async (n: string) => {
    const u = await prisma.user.create({ data: { organizationId: org.id, firstName: `${TAG}-${n}` } });
    userIds.push(u.id);
    return u.id;
  };
  staff = principal(await mk("staff"), { permissions: new Set(ALL_PERMISSIONS) });
  staff2 = principal(await mk("staff2"), { permissions: new Set(ALL_PERMISSIONS) });
  for (let i = 0; i < 4; i++) {
    const uid = await mk(`cust${i}`);
    const c = await prisma.customerProfile.create({ data: { userId: uid, organizationId: org.id, customerNumber: `${TAG}-${i}` } });
    customerIds.push(c.id);
    customers.push(principal(uid, { customerProfileId: c.id }));
  }
  const pu = await mk("prov");
  providerId = (
    await prisma.providerProfile.create({
      data: {
        userId: pu, organizationId: org.id, providerType: "THERAPIST", slug: TAG, displayName: "P", isBookable: true,
        availabilities: { create: { timezone: "Asia/Karachi", isDefault: true, rules: { create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinute: 540, endMinute: 1020 })) } } },
      },
    })
  ).id;
  serviceId = (
    await prisma.service.create({
      data: { organizationId: org.id, name: `${TAG} paid`, slug: `${TAG}-paid`, durationMinutes: 60, price: 5000, minNoticeMinutes: 0, requiresPrepayment: true, providers: { create: { providerId } } },
    })
  ).id;
  const start = DateTime.now().plus({ days: 20 }).set({ hour: 10 });
  const ev = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${TAG} event`, slug: `${TAG}-event`, startsAt: start.toJSDate(), endsAt: start.plus({ hours: 2 }).toJSDate(),
      timezone: org.timezone, status: "PUBLISHED", ticketTypes: { create: { name: "Standard", price: 1500, capacity: 1 } },
    },
    include: { ticketTypes: true },
  });
  eventId = ev.id;
  ticketTypeId = ev.ticketTypes[0]!.id;
});

afterAll(async () => {
  if (!org) return;
  const bookings = await prisma.booking.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
  const bookingIds = bookings.map((b) => b.id);
  const payments = await prisma.payment.findMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { customerId: { in: customerIds } }] }, select: { id: true } });
  const paymentIds = payments.map((p) => p.id);
  const expenses = await prisma.expense.findMany({ where: { createdById: { in: userIds } }, select: { id: true } });
  await prisma.financeTransaction.deleteMany({ where: { OR: [{ paymentId: { in: paymentIds } }, { expenseId: { in: expenses.map((e) => e.id) } }, { bookingId: { in: bookingIds } }] } });
  // Stored demo callbacks carry our paymentId in their payload.
  await prisma.paymentWebhookEvent.deleteMany({ where: { gateway: "demo", OR: paymentIds.map((id) => ({ payload: { path: ["paymentId"], equals: id } })) } });
  await prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.invoice.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.expense.deleteMany({ where: { id: { in: expenses.map((e) => e.id) } } });
  // Fixture ids may be unset if setup failed half-way: never delete unscoped (see ids()).
  if (ids(eventId)) {
    await prisma.eventAttendee.deleteMany({ where: { eventId } });
    await prisma.eventBooking.deleteMany({ where: { eventId } });
  }
  if (ids(providerId)) await prisma.appointment.deleteMany({ where: { providerId } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  if (ids(eventId)) {
    await prisma.eventTicketType.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
  }
  if (ids(serviceId)) await prisma.service.deleteMany({ where: { id: serviceId } });
  if (ids(providerId)) await prisma.providerProfile.deleteMany({ where: { id: providerId } });
  await prisma.customerProfile.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ requestId: TAG }, { userId: { in: userIds } }, { entityId: { in: [...paymentIds, ...bookingIds] } }] } });
  await deleteTestNotifications(userIds);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  // Restore document counters without going below any number still in use.
  const year = DateTime.now().setZone(org.timezone).year;
  const maxUsed: Record<string, string> = {
    APT: `SELECT max(substring("bookingNumber" from 10)::int) AS m FROM bookings WHERE "bookingNumber" LIKE 'APT-${year}-%'`,
    EVT: `SELECT max(substring("bookingNumber" from 10)::int) AS m FROM bookings WHERE "bookingNumber" LIKE 'EVT-${year}-%'`,
    TKT: `SELECT max(substring("ticketNumber" from 10)::int) AS m FROM event_attendees WHERE "ticketNumber" LIKE 'TKT-${year}-%'`,
    PAY: `SELECT max(substring("paymentNumber" from 10)::int) AS m FROM payments WHERE "paymentNumber" LIKE 'PAY-${year}-%'`,
    INV: `SELECT max(substring("invoiceNumber" from 10)::int) AS m FROM invoices WHERE "invoiceNumber" LIKE 'INV-${year}-%'`,
    TXN: `SELECT max(substring("transactionNumber" from 10)::int) AS m FROM finance_transactions WHERE "transactionNumber" LIKE 'TXN-${year}-%'`,
    EXP: `SELECT max(substring("expenseNumber" from 10)::int) AS m FROM expenses WHERE "expenseNumber" LIKE 'EXP-${year}-%'`,
  };
  for (const prefix of PREFIXES) {
    const used = (await prisma.$queryRawUnsafe<{ m: number | null }[]>(maxUsed[prefix]!))[0]?.m ?? 0;
    const target = Math.max(seqBefore[prefix] ?? 0, used);
    if (target === 0) await prisma.documentSequence.deleteMany({ where: { organizationId: org.id, prefix, year } });
    else await prisma.documentSequence.updateMany({ where: { organizationId: org.id, prefix, year }, data: { lastValue: target } });
  }
  await prisma.$disconnect();
});

describe("online checkout", () => {
  it("hold → checkout → signed success callback confirms and records everything once", async () => {
    const appt = await onlineHold(customers[0]!, "09:00");
    expect([appt.status, appt.paymentStatus]).toEqual(["PENDING", "UNPAID"]);
    const checkout = await startCheckout(customers[0]!, { bookingId: appt.bookingId, gateway: "demo" }, ctx);
    expect(checkout.action.type).toBe("redirect");

    await demoCallback(checkout.paymentId, "SUCCEEDED", "5000.00");
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: appt.bookingId }, include: { appointments: true } });
    expect([b.status, b.paymentStatus, b.amountPaid.toFixed(2)]).toEqual(["CONFIRMED", "PAID", "5000.00"]);
    expect(b.appointments[0]!.status).toBe("CONFIRMED");
    expect(b.appointments[0]!.holdExpiresAt).toBeNull();
    const rows = await ledger(appt.bookingId);
    expect(rows.map((r) => [r.type, r.amount.toFixed(2)])).toEqual([["INCOME", "5000.00"]]);
  });

  it("the same callback delivered 5 times concurrently is applied exactly once", async () => {
    const appt = await onlineHold(customers[1]!, "11:00");
    const { paymentId } = await startCheckout(customers[1]!, { bookingId: appt.bookingId, gateway: "demo" }, ctx);
    const token = signDemoResult({ paymentId, outcome: "SUCCEEDED", amount: "5000.00" });
    await Promise.all([1, 2, 3, 4, 5].map(() => demoCallback(paymentId, "SUCCEEDED", "5000.00", token)));
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: appt.bookingId } });
    expect(b.amountPaid.toFixed(2)).toBe("5000.00");
    expect(await ledger(appt.bookingId)).toHaveLength(1);
  });

  it("rejects tampered callbacks and never trusts a mismatched amount", async () => {
    const appt = await onlineHold(customers[2]!, "13:00");
    const { paymentId } = await startCheckout(customers[2]!, { bookingId: appt.bookingId, gateway: "demo" }, ctx);
    const good = signDemoResult({ paymentId, outcome: "SUCCEEDED", amount: "5000.00" });
    expect(await code(demoCallback(paymentId, "SUCCEEDED", "5000.00", good.slice(0, -3) + "AAA"))).toBe("BAD_REQUEST");
    await demoCallback(paymentId, "SUCCEEDED", "1.00"); // correctly signed, wrong amount
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(pay.status).toBe("FAILED");
    expect(pay.failureReason).toMatch(/Amount mismatch/);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: appt.bookingId } });
    expect([b.status, b.amountPaid.toFixed(2)]).toEqual(["PENDING", "0.00"]);
  });
});

describe("late payments", () => {
  it("revives the booking when the lapsed slot is still free", async () => {
    const appt = await onlineHold(customers[3]!, "15:00");
    const { paymentId } = await startCheckout(customers[3]!, { bookingId: appt.bookingId, gateway: "demo" }, ctx);
    await prisma.appointment.update({ where: { id: appt.id }, data: { status: "EXPIRED" } });
    await prisma.booking.update({ where: { id: appt.bookingId }, data: { status: "EXPIRED" } });
    await demoCallback(paymentId, "SUCCEEDED", "5000.00");
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: { booking: true } });
    expect([a.status, a.booking.status, a.booking.paymentStatus]).toEqual(["CONFIRMED", "CONFIRMED", "PAID"]);
  });

  it("flags the payment for refund when someone else took the slot", async () => {
    const tue = DateTime.fromISO(monday).plus({ days: 1 }).toISODate()!;
    const appt = await onlineHold(customers[0]!, "09:00", tue);
    const { paymentId } = await startCheckout(customers[0]!, { bookingId: appt.bookingId, gateway: "demo" }, ctx);
    await prisma.appointment.update({ where: { id: appt.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
    // Another customer books the same time → engine expires the lapsed hold.
    await createAppointmentBooking(
      { organization: org, customerId: customers[1]!.customerProfileId!, serviceId, providerId, startsAt: at("09:00", tue), source: "ADMIN", online: false, confirm: true, overrideAvailability: false, actorUserId: staff.userId },
      ctx,
    );
    await demoCallback(paymentId, "SUCCEEDED", "5000.00");
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(pay.status).toBe("SUCCEEDED");
    expect((pay.metadata as { needsRefund?: boolean }).needsRefund).toBe(true);
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(a.status).toBe("EXPIRED");
  });
});

describe("manual payments, invoices and refunds", () => {
  let bookingId: string;

  it("partial payments, overpayment guard, auto-confirm when fully paid", async () => {
    const wed = DateTime.fromISO(monday).plus({ days: 2 }).toISODate()!;
    const appt = await createAppointmentBooking(
      { organization: org, customerId: customers[2]!.customerProfileId!, serviceId, providerId, startsAt: at("10:00", wed), source: "PHONE", online: false, confirm: false, overrideAvailability: false, actorUserId: staff.userId },
      ctx,
    );
    bookingId = appt.bookingId;
    await recordManualPayment(staff, { bookingId, amount: 2000, method: "CASH" }, ctx);
    let b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect([b.paymentStatus, b.status]).toEqual(["PARTIAL", "PENDING"]);
    expect(await code(recordManualPayment(staff, { bookingId, amount: 3000.01, method: "CASH" }, ctx))).toBe("VALIDATION_ERROR");
    await recordManualPayment(staff, { bookingId, amount: 3000, method: "BANK_TRANSFER", reference: "HBL-123" }, ctx);
    b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect([b.paymentStatus, b.status, b.amountPaid.toFixed(2)]).toEqual(["PAID", "CONFIRMED", "5000.00"]);
  });

  it("invoice from booking picks up existing payments; is idempotent; cannot be voided while paid", async () => {
    const inv = await invoiceFromBooking(staff, { bookingId }, ctx);
    expect([inv.status, inv.totalAmount, inv.amountPaid, inv.amountDue]).toEqual(["PAID", "5000.00", "5000.00", "0.00"]);
    expect(inv.payments).toHaveLength(2);
    expect((await invoiceFromBooking(staff, { bookingId }, ctx)).id).toBe(inv.id);
    expect(await code(voidInvoice(staff, inv.id, "mistake", ctx))).toBe("BAD_REQUEST");
  });

  it("refunds update payment, booking, invoice and ledger; over-refunds are rejected", async () => {
    const cash = await prisma.payment.findFirstOrThrow({ where: { bookingId, method: "CASH" } });
    await refundPayment(staff, cash.id, { amount: 1000, reason: "Goodwill" }, ctx);
    expect(await code(refundPayment(staff, cash.id, { amount: 1000.01, reason: "Too much" }, ctx))).toBe("VALIDATION_ERROR");
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: cash.id } });
    expect([pay.status, pay.refundedAmount.toFixed(2)]).toEqual(["PARTIALLY_REFUNDED", "1000.00"]);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { invoices: true } });
    expect([b.paymentStatus, b.amountPaid.toFixed(2)]).toEqual(["PARTIAL", "4000.00"]);
    expect([b.invoices[0]!.status, b.invoices[0]!.amountDue.toFixed(2)]).toEqual(["PARTIALLY_PAID", "1000.00"]);
    const rows = await ledger(bookingId);
    expect(rows.map((r) => [r.type, r.amount.toFixed(2)])).toEqual([["INCOME", "2000.00"], ["INCOME", "3000.00"], ["REFUND", "1000.00"]]);
  });
});

describe("events and expenses", () => {
  it("paying for held event tickets confirms them and moves reserved → sold", async () => {
    const eb = await createEventBooking(
      { organization: org, customerId: customers[3]!.customerProfileId!, eventId, items: [{ ticketTypeId, quantity: 1 }], source: "ONLINE", online: true, confirm: false, actorUserId: customers[3]!.userId },
      ctx,
    );
    expect(eb.status).toBe("PENDING");
    const { paymentId } = await startCheckout(customers[3]!, { bookingId: eb.bookingId, gateway: "demo" }, ctx);
    await demoCallback(paymentId, "SUCCEEDED", "1500.00");
    const t = await prisma.eventTicketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    const confirmed = await prisma.eventBooking.findUniqueOrThrow({ where: { id: eb.id } });
    expect([confirmed.status, t.soldQuantity, t.reservedQuantity]).toEqual(["CONFIRMED", 1, 0]);
  });

  it("expenses: no self-approval; paying posts one EXPENSE ledger entry", async () => {
    // The oldest (seeded) category: never one a parallel test suite creates and deletes.
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });
    const exp = await createExpense(staff, { categoryId: cat.id, description: `${TAG} printer paper`, amount: 1250.5, expenseDate: monday, vendor: "Stationers" }, ctx);
    expect(await code(expenseAction(staff, exp.id, { action: "approve" }, ctx))).toBe("FORBIDDEN");
    expect((await expenseAction(staff2, exp.id, { action: "approve" }, ctx)).status).toBe("APPROVED");
    expect((await expenseAction(staff2, exp.id, { action: "mark_paid", paymentMethod: "CASH" }, ctx)).status).toBe("PAID");
    const rows = await prisma.financeTransaction.findMany({ where: { expenseId: exp.id } });
    expect(rows.map((r) => [r.type, r.amount.toFixed(2)])).toEqual([["EXPENSE", "1250.50"]]);
    expect(await code(expenseAction(staff2, exp.id, { action: "mark_paid" }, ctx))).toBe("BAD_REQUEST");
  });
});
