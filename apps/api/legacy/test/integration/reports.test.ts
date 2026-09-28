/**
 * Reports, dashboards, settings and the audit log against real PostgreSQL.
 * A small fixture with known numbers (two providers, five appointments with
 * every outcome, payments + a refund, an event with a check-in and a
 * cancellation, expenses). Every report query is filtered to the fixture's
 * own service / event / expense category so real data never affects results.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { ALL_PERMISSIONS, reportQuerySchema, type ReportDto, type ReportType } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { getOrgSettings, writeOrgSettings, type OrgSettings } from "../../src/lib/settings.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { createAppointmentBooking } from "../../src/modules/appointments/booking-engine.js";
import { cancelAppointment } from "../../src/modules/appointments/appointments.service.js";
import { createEventBooking } from "../../src/modules/events/event-booking-engine.js";
import { cancelEventBooking } from "../../src/modules/events/event-bookings.service.js";
import { recordManualPayment, refundPayment } from "../../src/modules/payments/payments.service.js";
import { createExpense, expenseAction } from "../../src/modules/finance/expenses.service.js";
import { setAutoDispatch } from "../../src/modules/notifications/dispatcher.js";
import { exportReportCsv, runReport } from "../../src/modules/reports/reports.service.js";
import { adminDashboard, providerDashboard } from "../../src/modules/reports/dashboard.service.js";
import { getSettings, updateBooking, updateInvoices } from "../../src/modules/settings/settings.service.js";
import { listAuditLogs } from "../../src/modules/audit/audit-log.service.js";
import { deleteTestNotifications, ids } from "./cleanup.js";

const TAG = `rtest-${randomUUID().slice(0, 8)}`;
const ctx = { organizationId: null as string | null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };
const PREFIXES = ["APT", "EVT", "TKT", "PAY", "TXN", "EXP"] as const;

let org: { id: string; timezone: string; currency: string; name: string; slug: string };
const seqBefore: Record<string, number | null> = {};
let settingsBefore: OrgSettings;
const userIds: string[] = [];
const customerIds: string[] = [];
const providerIds: string[] = [];
let categoryId: string, serviceId: string, eventId: string, ticketTypeId: string, expenseCategoryId: string;
let staff: Principal, staff2: Principal;
const customers: Principal[] = [];
const appt: Record<string, { id: string; bookingId: string }> = {};
let today: string, day: string, to: string;

function principal(userId: string, extra: Partial<Principal>): Principal {
  return {
    userId, authUserId: userId, organizationId: org.id, organization: org, email: null, phone: null, firstName: "T", lastName: null,
    status: "ACTIVE", locale: null, timezone: null, roles: [], roleKeys: [], permissions: new Set(), isSuperAdmin: false,
    staffProfileId: null, providerProfileId: null, providerType: null, customerProfileId: null, ...extra,
  };
}

const as = (p: Principal) => ({ ...ctx, userId: p.userId });
const report = (type: ReportType, q: Record<string, unknown> = {}) => runReport(staff, type, reportQuerySchema.parse({ from: today, to, ...q }));
const summary = (r: ReportDto) => Object.fromEntries(r.summary.map((s) => [s.label, s.value]));
const at = (time: string, date = day) => DateTime.fromISO(`${date}T${time}`, { zone: "Asia/Karachi" }).toJSDate();

beforeAll(async () => {
  setAutoDispatch(false);
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, timezone: o.timezone, currency: o.currency, name: o.name, slug: o.slug };
  ctx.organizationId = org.id;
  const year = DateTime.now().setZone(org.timezone).year;
  for (const prefix of PREFIXES) {
    seqBefore[prefix] = (await prisma.documentSequence.findUnique({ where: { organizationId_prefix_year: { organizationId: org.id, prefix, year } } }))?.lastValue ?? null;
  }
  settingsBefore = await getOrgSettings(org.id);

  today = DateTime.now().setZone(org.timezone).toISODate()!;
  let d = DateTime.now().setZone(org.timezone).plus({ days: 20 }).startOf("day");
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  day = d.toISODate()!;
  to = d.plus({ days: 7 }).toISODate()!;

  const mk = async (n: string) => {
    const u = await prisma.user.create({ data: { organizationId: org.id, firstName: `${TAG}-${n}` } });
    userIds.push(u.id);
    return u.id;
  };
  staff = principal(await mk("staff"), { permissions: new Set(ALL_PERMISSIONS) });
  staff2 = principal(await mk("staff2"), { permissions: new Set(ALL_PERMISSIONS) });
  for (let i = 0; i < 3; i++) {
    const uid = await mk(`cust${i}`);
    const c = await prisma.customerProfile.create({ data: { userId: uid, organizationId: org.id, customerNumber: `${TAG}-${i}` } });
    customerIds.push(c.id);
    customers.push(principal(uid, { customerProfileId: c.id }));
  }
  for (const n of ["p1", "p2"]) {
    const uid = await mk(n);
    const p = await prisma.providerProfile.create({
      data: {
        userId: uid, organizationId: org.id, providerType: "COUNSELLOR", slug: `${TAG}-${n}`, displayName: `${TAG} ${n.toUpperCase()}`, isBookable: true,
        availabilities: { create: { timezone: "Asia/Karachi", isDefault: true, rules: { create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinute: 540, endMinute: 1020 })) } } },
      },
    });
    providerIds.push(p.id);
  }
  categoryId = (await prisma.category.create({ data: { organizationId: org.id, name: `${TAG} Care`, slug: `${TAG}-care` } })).id;
  serviceId = (
    await prisma.service.create({
      data: {
        organizationId: org.id, categoryId, name: `${TAG} Session`, slug: `${TAG}-session`, durationMinutes: 60, price: 1000, minNoticeMinutes: 0,
        providers: { create: providerIds.map((providerId) => ({ providerId })) },
      },
    })
  ).id;

  const book = async (key: string, c: number, p: number, time: string, date = day) => {
    const a = await createAppointmentBooking(
      { organization: org, customerId: customers[c]!.customerProfileId!, serviceId, providerId: providerIds[p]!, startsAt: at(time, date), source: "ADMIN", online: false, confirm: true, overrideAvailability: false, actorUserId: staff.userId },
      ctx,
    );
    appt[key] = { id: a.id, bookingId: a.bookingId };
  };
  await book("a1", 0, 0, "09:00");
  await book("a2", 1, 0, "10:00");
  await book("a3", 2, 0, "11:00");
  await book("a4", 0, 1, "13:00");
  await book("a5", 1, 1, "09:00", DateTime.fromISO(day).plus({ days: 1 }).toISODate()!);
  await prisma.appointment.update({ where: { id: appt.a1!.id }, data: { status: "COMPLETED" } });
  await prisma.appointment.update({ where: { id: appt.a2!.id }, data: { status: "NO_SHOW" } });
  await prisma.appointment.update({ where: { id: appt.a5!.id }, data: { status: "COMPLETED" } });
  await cancelAppointment(staff, appt.a3!.id, { reason: "Sick" }, as(staff));

  await recordManualPayment(staff, { bookingId: appt.a1!.bookingId, amount: 1000, method: "CASH" }, ctx);
  const p5 = await recordManualPayment(staff, { bookingId: appt.a5!.bookingId, amount: 1000, method: "BANK_TRANSFER" }, ctx);
  await refundPayment(staff, p5.id, { amount: 200, reason: "Goodwill" }, ctx);

  const start = DateTime.fromISO(`${day}T18:00`, { zone: "Asia/Karachi" });
  const ev = await prisma.event.create({
    data: {
      organizationId: org.id, categoryId, name: `${TAG} Workshop`, slug: `${TAG}-workshop`, startsAt: start.toJSDate(), endsAt: start.plus({ hours: 2 }).toJSDate(),
      timezone: org.timezone, status: "PUBLISHED", ticketTypes: { create: { name: "Standard", price: 500, capacity: 10 } },
    },
    include: { ticketTypes: true },
  });
  eventId = ev.id;
  ticketTypeId = ev.ticketTypes[0]!.id;
  const eb1 = await createEventBooking({ organization: org, customerId: customers[0]!.customerProfileId!, eventId, items: [{ ticketTypeId, quantity: 2 }], source: "ADMIN", online: false, confirm: true, actorUserId: staff.userId }, ctx);
  await recordManualPayment(staff, { bookingId: eb1.bookingId, amount: 1000, method: "CASH" }, ctx);
  const first = await prisma.eventAttendee.findFirstOrThrow({ where: { eventBookingId: eb1.id }, orderBy: { ticketNumber: "asc" } });
  await prisma.eventAttendee.update({ where: { id: first.id }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
  const eb2 = await createEventBooking({ organization: org, customerId: customers[1]!.customerProfileId!, eventId, items: [{ ticketTypeId, quantity: 1 }], source: "ADMIN", online: false, confirm: true, actorUserId: staff.userId }, ctx);
  await cancelEventBooking(staff, eb2.id, "Cannot attend", ctx);

  expenseCategoryId = (await prisma.expenseCategory.create({ data: { organizationId: org.id, name: `${TAG} Supplies`, slug: `${TAG}-supplies` } })).id;
  const e1 = await createExpense(staff, { categoryId: expenseCategoryId, description: `${TAG} paper`, amount: 300, expenseDate: today }, ctx);
  await expenseAction(staff2, e1.id, { action: "approve" }, as(staff2));
  await expenseAction(staff2, e1.id, { action: "mark_paid", paymentMethod: "CASH" }, as(staff2));
  await createExpense(staff, { categoryId: expenseCategoryId, description: `${TAG} pens`, amount: 150, expenseDate: today }, ctx);
});

afterAll(async () => {
  if (!org) return;
  // Put back only what the test changed.
  await writeOrgSettings(
    prisma,
    org.id,
    { holdMinutes: settingsBefore.holdMinutes, invoiceDefaultDueDays: settingsBefore.invoiceDefaultDueDays, invoiceFooter: settingsBefore.invoiceFooter },
    null,
  );
  const bookings = await prisma.booking.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
  const bookingIds = bookings.map((b) => b.id);
  const payments = await prisma.payment.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } });
  const paymentIds = payments.map((p) => p.id);
  // Fixture ids may be unset if setup failed half-way: never delete unscoped (see ids()).
  const expenses = ids(expenseCategoryId) ? await prisma.expense.findMany({ where: { categoryId: expenseCategoryId }, select: { id: true } }) : [];
  await prisma.financeTransaction.deleteMany({ where: { OR: [{ paymentId: { in: paymentIds } }, { bookingId: { in: bookingIds } }, { expenseId: { in: expenses.map((e) => e.id) } }] } });
  await prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  if (ids(expenseCategoryId)) {
    await prisma.expense.deleteMany({ where: { categoryId: expenseCategoryId } });
    await prisma.expenseCategory.deleteMany({ where: { id: expenseCategoryId } });
  }
  if (ids(eventId)) {
    await prisma.eventAttendee.deleteMany({ where: { eventId } });
    await prisma.eventBooking.deleteMany({ where: { eventId } });
  }
  await prisma.appointment.deleteMany({ where: { providerId: { in: providerIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  if (ids(eventId)) {
    await prisma.eventTicketType.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
  }
  if (ids(serviceId)) await prisma.service.deleteMany({ where: { id: serviceId } });
  if (ids(categoryId)) await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.customerProfile.deleteMany({ where: { id: { in: customerIds } } });
  await deleteTestNotifications(userIds);
  await prisma.auditLog.deleteMany({ where: { OR: [{ requestId: TAG }, { userId: { in: userIds } }, { entityId: { in: [...bookingIds, ...paymentIds, ...Object.values(appt).map((a) => a.id)] } }] } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  const year = DateTime.now().setZone(org.timezone).year;
  const maxUsed: Record<string, string> = {
    APT: `SELECT max(substring("bookingNumber" from 10)::int) AS m FROM bookings WHERE "bookingNumber" LIKE 'APT-${year}-%'`,
    EVT: `SELECT max(substring("bookingNumber" from 10)::int) AS m FROM bookings WHERE "bookingNumber" LIKE 'EVT-${year}-%'`,
    TKT: `SELECT max(substring("ticketNumber" from 10)::int) AS m FROM event_attendees WHERE "ticketNumber" LIKE 'TKT-${year}-%'`,
    PAY: `SELECT max(substring("paymentNumber" from 10)::int) AS m FROM payments WHERE "paymentNumber" LIKE 'PAY-${year}-%'`,
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

describe("appointment-based reports", () => {
  it("appointments: every outcome counted, value excludes cancellations, filters and paging work", async () => {
    const r = await report("appointments", { serviceId });
    expect(summary(r)).toMatchObject({
      Appointments: 5,
      Completed: 2,
      "Upcoming / in progress": 1,
      Cancelled: 1,
      "No-shows": 1,
      "Booked value": 4000,
      "Cancellation rate": 20,
      "No-show rate": 33.3,
    });
    expect(r.meta.total).toBe(5);
    expect((await report("appointments", { serviceId, providerId: providerIds[0] })).meta.total).toBe(3);
    expect((await report("appointments", { serviceId, status: "NO_SHOW" })).rows.map((x) => x.status)).toEqual(["NO_SHOW"]);
    const paged = await report("appointments", { serviceId, pageSize: 2, page: 3 });
    expect([paged.rows.length, paged.meta.totalPages]).toEqual([1, 3]);
    await expect(report("appointments", { serviceId, status: "PAID" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("providers: workload, hours, value and rates per provider", async () => {
    const r = await report("providers", { serviceId });
    const byName = Object.fromEntries(r.rows.map((x) => [x.provider, x]));
    expect(byName[`${TAG} P1`]).toMatchObject({ appointments: 3, completed: 1, cancelled: 1, noShows: 1, upcoming: 0, bookedHours: 2, value: 2000, cancellationRate: 33.3, noShowRate: 50 });
    expect(byName[`${TAG} P2`]).toMatchObject({ appointments: 2, completed: 1, upcoming: 1, bookedHours: 2, value: 2000, noShowRate: 0 });
    expect(r.rows).toHaveLength(2);
    expect(r.chart?.points).toHaveLength(2);
  });

  it("no-shows and cancellations", async () => {
    const ns = await report("no-shows", { serviceId });
    expect(summary(ns)).toMatchObject({ "No-shows": 1, "No-show rate": 33.3, "Value of missed appointments": 1000 });
    const c = await report("cancellations", { serviceId });
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({ type: "APPOINTMENT", reason: "Sick", cancelledBy: `${TAG}-staff` });
    expect(Number(c.rows[0]!.noticeHours)).toBeGreaterThan(24 * 19);
    const ce = await report("cancellations", { eventId });
    expect(ce.rows.map((x) => [x.type, x.reason])).toEqual([["EVENT", "Cannot attend"]]);
  });

  it("customers: activity and net spend per customer", async () => {
    const r = await report("customers", { serviceId });
    expect(r.rows.map((x) => [x.customerNumber, x.bookings, x.visits, x.cancelled, x.noShows, x.spent])).toEqual([
      [`${TAG}-0`, 2, 1, 0, 0, 1000],
      [`${TAG}-1`, 2, 1, 0, 1, 800],
      [`${TAG}-2`, 1, 0, 1, 0, 0],
    ]);
    expect(summary(r)).toMatchObject({ "Active customers": 3, "Repeat customers": 2, "Total paid": 1800 });
  });

  it("bookings: value, collected and outstanding", async () => {
    const r = await report("bookings", { serviceId });
    expect(summary(r)).toMatchObject({ Bookings: 5, Cancelled: 1, "Booked value": 4000, Collected: 1800, Outstanding: 2200 });
  });
});

describe("money reports", () => {
  it("revenue: ledger income minus refunds, by service, day and method", async () => {
    const bySvc = await report("revenue", { serviceId, groupBy: "service" });
    expect(bySvc.rows).toEqual([{ group: `${TAG} Session`, income: 2000, refunds: 200, net: 1800, payments: 2 }]);
    const byDay = await report("revenue", { serviceId, groupBy: "day", pageSize: 200 });
    expect(byDay.meta.total).toBe(DateTime.fromISO(to).diff(DateTime.fromISO(today), "days").days + 1);
    expect(summary(byDay)).toMatchObject({ Income: 2000, Refunds: 200, "Net revenue": 1800 });
    expect(summary(await report("revenue", { serviceId, method: "CASH" }))).toMatchObject({ Income: 1000, Refunds: 0 });
    const events = await report("revenue", { eventId, groupBy: "service" });
    expect(events.rows).toEqual([{ group: `Event: ${TAG} Workshop`, income: 1000, refunds: 0, net: 1000, payments: 1 }]);
  });

  it("payments and expenses", async () => {
    expect(summary(await report("payments", { serviceId }))).toMatchObject({ "Payments received": 2, "Gross received": 2000, Refunded: 200, Net: 1800 });
    const ex = await report("expenses", { categoryId: expenseCategoryId });
    expect(summary(ex)).toMatchObject({ Paid: 300, "Awaiting approval": 150, [`${TAG} Supplies`]: 450 });
    expect(ex.rows).toHaveLength(2);
  });
});

describe("event reports", () => {
  it("events and attendance", async () => {
    const ev = await report("events", { eventId });
    expect(ev.rows[0]).toMatchObject({ capacity: 10, sold: 2, reserved: 0, checkedIn: 1, fill: 20, revenue: 1000 });
    const at = await report("event-attendance", { eventId });
    expect(at.rows).toEqual([expect.objectContaining({ ticketType: "Standard", issued: 2, checkedIn: 1, notCheckedIn: 1, attendance: null })]);
  });
});

describe("CSV export", () => {
  it("exports every row with currency-labelled columns and local times", async () => {
    const { csv, filename, truncated } = await exportReportCsv(staff, "appointments", reportQuerySchema.parse({ from: today, to, serviceId }));
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(filename).toBe(`appointments-${today}-to-${to}.csv`);
    expect(truncated).toBe(false);
    expect(lines[0]).toContain(`Amount (${org.currency})`);
    expect(lines).toHaveLength(6);
    expect(lines.some((l) => l.startsWith(`${day} 09:00,`) && l.endsWith(",1000.00"))).toBe(true);
  });
});

describe("dashboards", () => {
  it("admin dashboard shows permitted sections and the newest bookings", async () => {
    const d = await adminDashboard(staff);
    expect(d.revenue?.trend).toHaveLength(30);
    expect(d.appointments && d.events && d.customers && d.payments).toBeTruthy();
    expect(d.recentBookings?.some((b) => b.item === `${TAG} Workshop` || b.item === `${TAG} Session`)).toBe(true);
    const limited = principal(staff.userId, { permissions: new Set(["customers.view"]) });
    const l = await adminDashboard(limited);
    expect([l.revenue, l.appointments, l.payments, l.recentBookings]).toEqual([null, null, null, null]);
    expect(l.customers).not.toBeNull();
    await expect(adminDashboard(customers[0]!)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("provider dashboard is scoped to the provider", async () => {
    const d = await providerDashboard(principal(staff.userId, { providerProfileId: providerIds[1]! }));
    expect(d.clients.map((c) => c.name).sort()).toEqual([`${TAG}-cust0`, `${TAG}-cust1`]);
    await expect(providerDashboard(staff)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("settings and audit", () => {
  it("booking and invoice settings take effect immediately and are audited", async () => {
    const hold = settingsBefore.holdMinutes === 25 ? 26 : 25;
    const s = await updateBooking(staff, { holdMinutes: hold }, as(staff));
    expect(s.booking.holdMinutes).toBe(hold);
    expect((await getOrgSettings(org.id)).holdMinutes).toBe(hold);
    await updateInvoices(staff, { defaultDueDays: 14, footer: "=cmd|' /C calc'!A0" }, as(staff));
    expect((await getSettings(staff)).invoices).toEqual({ defaultDueDays: 14, footer: "=cmd|' /C calc'!A0" });
    const logs = await listAuditLogs(staff, { page: 1, pageSize: 10, action: "settings.booking.update", userId: staff.userId });
    expect(logs.items[0]).toMatchObject({ oldValues: { "booking.holdMinutes": settingsBefore.holdMinutes }, newValues: { "booking.holdMinutes": hold } });
    // Saving the same value again records nothing.
    await updateBooking(staff, { holdMinutes: hold }, as(staff));
    expect((await listAuditLogs(staff, { page: 1, pageSize: 10, action: "settings.booking.update", userId: staff.userId })).total).toBe(1);
  });

  it("audit log is filterable by entity and action prefix", async () => {
    const byEntity = await listAuditLogs(staff, { page: 1, pageSize: 20, entityId: appt.a3!.id });
    expect(byEntity.items.map((i) => i.action)).toContain("appointment.cancel");
    expect(byEntity.items.find((i) => i.action === "appointment.cancel")?.user?.name).toBe(`${TAG}-staff`);
    const prefix = await listAuditLogs(staff, { page: 1, pageSize: 50, action: "expense.", userId: staff2.userId });
    expect(prefix.items.map((i) => i.action).sort()).toEqual(["expense.approve", "expense.mark_paid"]);
  });
});
