/**
 * Notifications against real PostgreSQL: transactional outbox, recipients and
 * skips, idempotency, exclusive claims, retries/backoff, reminders that
 * survive cancellation/reschedule, payment + event notifications, WhatsApp
 * status webhooks, and inbox privacy. Channel providers are fakes; only rows
 * created by this test are ever delivered.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { ALL_PERMISSIONS, MAX_NOTIFICATION_ATTEMPTS } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { ids } from "./cleanup.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { createAppointmentBooking } from "../../src/modules/appointments/booking-engine.js";
import { cancelAppointment, rescheduleAppointment } from "../../src/modules/appointments/appointments.service.js";
import { createEventBooking } from "../../src/modules/events/event-booking-engine.js";
import { recordManualPayment } from "../../src/modules/payments/payments.service.js";
import { deliverNotification, findDueNotifications, setAutoDispatch } from "../../src/modules/notifications/dispatcher.js";
import { queueNotifications } from "../../src/modules/notifications/outbox.js";
import { scheduleDueReminders } from "../../src/modules/notifications/reminders.js";
import { installDefaultTemplates } from "../../src/modules/notifications/templates.service.js";
import { applyStatusEvents } from "../../src/modules/notifications/whatsapp-webhook.js";
import { listInbox, markRead, unreadCount } from "../../src/modules/notifications/notifications.service.js";
import {
  DeliveryError,
  setProvidersForTest,
  type EmailMessage,
  type EmailProvider,
  type WhatsAppMessageInput,
  type WhatsAppProvider,
} from "../../src/modules/notifications/providers/index.js";

const TAG = `ntest-${randomUUID().slice(0, 8)}`;
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };
const PREFIXES = ["APT", "EVT", "TKT", "PAY", "TXN"] as const;
const ADMIN_EMAIL = `${TAG}-staff-copy@example.test`;

class FakeEmail implements EmailProvider {
  readonly name = "fake-email";
  readonly configured = true;
  mode: "ok" | "transient" | "permanent" = "ok";
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    await new Promise((r) => setTimeout(r, 30)); // widen race windows
    if (this.mode === "transient") throw new DeliveryError("421 try again later", false);
    if (this.mode === "permanent") throw new DeliveryError("550 mailbox unavailable", true);
    this.sent.push(m);
    return { providerMessageId: `fake-${randomUUID()}` };
  }
}
class FakeWhatsApp implements WhatsAppProvider {
  readonly name = "fake-wa";
  readonly configured = true;
  requiresApprovedTemplate = false;
  sent: WhatsAppMessageInput[] = [];
  async send(m: WhatsAppMessageInput) {
    this.sent.push(m);
    return { providerMessageId: `wamid.${TAG}.${randomUUID()}` };
  }
}
const email = new FakeEmail();
const whatsapp = new FakeWhatsApp();

let org: { id: string; timezone: string; currency: string; name: string; slug: string };
const seqBefore: Record<string, number | null> = {};
let adminEmailsBefore: unknown = undefined;
let adminEmailsCaptured = false;
const userIds: string[] = [];
const customerIds: string[] = [];
let providerId: string, serviceId: string, eventId: string, ticketTypeId: string;
let staff: Principal;
const customers: Principal[] = [];
let day: string; // a weekday ~2 months ahead, far from real bookings
const at = (time: string, date = day) => DateTime.fromISO(`${date}T${time}`, { zone: "Asia/Karachi" }).toJSDate();

function principal(userId: string, extra: Partial<Principal>): Principal {
  return {
    userId, authUserId: userId, organizationId: org.id, organization: org, email: null, phone: null, firstName: "T", lastName: null,
    status: "ACTIVE", locale: null, timezone: null, roles: [], roleKeys: [], permissions: new Set(), isSuperAdmin: false,
    staffProfileId: null, providerProfileId: null, providerType: null, customerProfileId: null, ...extra,
  };
}

const rowsFor = (entityId: string) =>
  prisma.notification.findMany({ where: { entityId }, orderBy: [{ event: "asc" }, { channel: "asc" }] });
const summary = (rows: { event: string; channel: string; status: string; data: unknown }[]) =>
  rows.map((r) => `${r.event}/${(r.data as { audience: string }).audience}/${r.channel}/${r.status}`).sort();

async function deliverQueued(entityId: string, now = new Date()) {
  const due = await prisma.notification.findMany({ where: { entityId, status: "QUEUED" }, select: { id: true } });
  for (const d of due) await deliverNotification(d.id, now);
}

async function book(customer: Principal, time: string, confirm: boolean, date = day) {
  return createAppointmentBooking(
    { organization: org, customerId: customer.customerProfileId!, serviceId, providerId, startsAt: at(time, date), source: "ADMIN", online: false, confirm, overrideAvailability: false, actorUserId: staff.userId },
    ctx,
  );
}

beforeAll(async () => {
  setAutoDispatch(false);
  setProvidersForTest({ email, whatsapp });
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, timezone: o.timezone, currency: o.currency, name: o.name, slug: o.slug };
  const year = DateTime.now().setZone(org.timezone).year;
  for (const prefix of PREFIXES) {
    seqBefore[prefix] = (await prisma.documentSequence.findUnique({ where: { organizationId_prefix_year: { organizationId: org.id, prefix, year } } }))?.lastValue ?? null;
  }
  // Built-in templates (idempotent; the app needs them anyway) + a staff copy address.
  await installDefaultTemplates(prisma, org.id);
  const setting = await prisma.systemSetting.findUnique({ where: { organizationId_key: { organizationId: org.id, key: "notifications.adminEmails" } } });
  adminEmailsBefore = setting ? setting.value : undefined;
  adminEmailsCaptured = true;
  await prisma.systemSetting.upsert({
    where: { organizationId_key: { organizationId: org.id, key: "notifications.adminEmails" } },
    create: { organizationId: org.id, key: "notifications.adminEmails", value: [ADMIN_EMAIL] },
    update: { value: [ADMIN_EMAIL] },
  });

  let d = DateTime.now().setZone("Asia/Karachi").plus({ days: 60 }).startOf("day");
  while (d.weekday !== 3) d = d.plus({ days: 1 });
  day = d.toISODate()!;

  const mk = async (n: string, extra: { email?: string; phone?: string; lastName?: string } = {}) => {
    const u = await prisma.user.create({ data: { organizationId: org.id, firstName: n.startsWith("cust0") ? "Zoë <b>" : `${TAG}-${n}`, ...extra } });
    userIds.push(u.id);
    return u.id;
  };
  staff = principal(await mk("staff"), { permissions: new Set(ALL_PERMISSIONS) });
  const specs = [
    { email: `${TAG}-c0@example.test`, phone: "0300 1234567", lastName: TAG },
    { email: `${TAG}-c1@example.test` }, // no phone
    { email: `${TAG}-c2@example.test`, phone: "0321 7654321" },
  ];
  for (let i = 0; i < specs.length; i++) {
    const uid = await mk(`cust${i}`, specs[i]);
    const c = await prisma.customerProfile.create({ data: { userId: uid, organizationId: org.id, customerNumber: `${TAG}-${i}` } });
    customerIds.push(c.id);
    customers.push(principal(uid, { customerProfileId: c.id }));
  }
  const pu = await mk("prov", { email: `${TAG}-prov@example.test` });
  providerId = (
    await prisma.providerProfile.create({
      data: {
        userId: pu, organizationId: org.id, providerType: "THERAPIST", slug: TAG, displayName: "Dr Test", isBookable: true,
        availabilities: { create: { timezone: "Asia/Karachi", isDefault: true, rules: { create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinute: 540, endMinute: 1020 })) } } },
      },
    })
  ).id;
  serviceId = (
    await prisma.service.create({
      data: { organizationId: org.id, name: `${TAG} Therapy`, slug: `${TAG}-svc`, durationMinutes: 60, price: 3000, minNoticeMinutes: 0, providers: { create: { providerId } } },
    })
  ).id;
  const start = DateTime.fromISO(`${day}T18:00`, { zone: "Asia/Karachi" });
  const ev = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${TAG} Workshop`, slug: `${TAG}-event`, startsAt: start.toJSDate(), endsAt: start.plus({ hours: 2 }).toJSDate(),
      timezone: org.timezone, status: "PUBLISHED", venueName: "Hall A", ticketTypes: { create: { name: "Free", price: 0, capacity: 10 } },
    },
    include: { ticketTypes: true },
  });
  eventId = ev.id;
  ticketTypeId = ev.ticketTypes[0]!.id;
});

afterAll(async () => {
  setProvidersForTest({ email: null, whatsapp: null });
  if (!org) return;
  const bookings = await prisma.booking.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
  const bookingIds = bookings.map((b) => b.id);
  // Fixture ids may be unset if setup failed half-way: never query or delete unscoped (see ids()).
  const appts = ids(providerId) ? await prisma.appointment.findMany({ where: { providerId }, select: { id: true } }) : [];
  const ebs = ids(eventId) ? await prisma.eventBooking.findMany({ where: { eventId }, select: { id: true } }) : [];
  const payments = await prisma.payment.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } });
  const paymentIds = payments.map((p) => p.id);
  const entityIds = [...appts.map((a) => a.id), ...ebs.map((e) => e.id), ...paymentIds];
  const notes = await prisma.notification.findMany({
    where: { OR: [{ entityId: { in: entityIds } }, { recipientId: { in: userIds } }, { recipientEmail: { contains: TAG } }] },
    select: { id: true },
  });
  const noteIds = notes.map((n) => n.id);
  await prisma.emailLog.deleteMany({ where: { OR: [{ notificationId: { in: noteIds } }, { recipient: { contains: TAG } }] } });
  await prisma.whatsAppMessage.deleteMany({ where: { notificationId: { in: noteIds } } });
  await prisma.notification.deleteMany({ where: { id: { in: noteIds } } });

  await prisma.financeTransaction.deleteMany({ where: { OR: [{ paymentId: { in: paymentIds } }, { bookingId: { in: bookingIds } }] } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
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
  await prisma.auditLog.deleteMany({ where: { OR: [{ requestId: TAG }, { userId: { in: userIds } }, { entityId: { in: [...entityIds, ...bookingIds] } }] } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  // Only touch the setting if this run actually replaced it.
  if (adminEmailsCaptured) {
    if (adminEmailsBefore === undefined) {
      await prisma.systemSetting.deleteMany({ where: { organizationId: org.id, key: "notifications.adminEmails" } });
    } else {
      await prisma.systemSetting.update({
        where: { organizationId_key: { organizationId: org.id, key: "notifications.adminEmails" } },
        data: { value: adminEmailsBefore as never },
      });
    }
  }

  const year = DateTime.now().setZone(org.timezone).year;
  const maxUsed: Record<string, string> = {
    APT: `SELECT max(substring("bookingNumber" from 10)::int) AS m FROM bookings WHERE "bookingNumber" LIKE 'APT-${year}-%'`,
    EVT: `SELECT max(substring("bookingNumber" from 10)::int) AS m FROM bookings WHERE "bookingNumber" LIKE 'EVT-${year}-%'`,
    TKT: `SELECT max(substring("ticketNumber" from 10)::int) AS m FROM event_attendees WHERE "ticketNumber" LIKE 'TKT-${year}-%'`,
    PAY: `SELECT max(substring("paymentNumber" from 10)::int) AS m FROM payments WHERE "paymentNumber" LIKE 'PAY-${year}-%'`,
    TXN: `SELECT max(substring("transactionNumber" from 10)::int) AS m FROM finance_transactions WHERE "transactionNumber" LIKE 'TXN-${year}-%'`,
  };
  for (const prefix of PREFIXES) {
    const used = (await prisma.$queryRawUnsafe<{ m: number | null }[]>(maxUsed[prefix]!))[0]?.m ?? 0;
    const target = Math.max(seqBefore[prefix] ?? 0, used);
    if (target === 0) await prisma.documentSequence.deleteMany({ where: { organizationId: org.id, prefix, year } });
    else await prisma.documentSequence.updateMany({ where: { organizationId: org.id, prefix, year }, data: { lastValue: target } });
  }
  await prisma.$disconnect();
});

describe("outbox", () => {
  let apptId: string;

  it("a confirmed booking queues the right messages in the same transaction, once", async () => {
    const a = await book(customers[0]!, "10:00", true);
    apptId = a.id;
    expect(summary(await rowsFor(a.id))).toEqual([
      "BOOKING_CONFIRMED/CUSTOMER/EMAIL/QUEUED",
      "BOOKING_CONFIRMED/CUSTOMER/IN_APP/QUEUED",
      "BOOKING_CONFIRMED/CUSTOMER/WHATSAPP/QUEUED",
      "BOOKING_CREATED/ADMIN/EMAIL/QUEUED",
      "BOOKING_CREATED/PROVIDER/IN_APP/QUEUED",
    ]);
    const wa = (await rowsFor(a.id)).find((r) => r.channel === "WHATSAPP")!;
    expect(wa.recipientPhone).toBe("+923001234567");
    // Re-emitting the same event is a no-op.
    expect(await queueNotifications(prisma, { event: "BOOKING_CONFIRMED", entityType: "appointment", entityId: a.id, audiences: ["CUSTOMER"] })).toBe(0);
    expect(await queueNotifications(prisma, { event: "BOOKING_CREATED", entityType: "appointment", entityId: a.id, audiences: ["PROVIDER", "ADMIN"] })).toBe(0);
  });

  it("a rolled-back booking leaves no notifications", async () => {
    const before = await prisma.notification.count({ where: { recipientId: customers[2]!.userId } });
    // Same slot as above → exclusion constraint → rollback.
    await expect(book(customers[2]!, "10:00", true)).rejects.toThrow(AppError);
    expect(await prisma.notification.count({ where: { recipientId: customers[2]!.userId } })).toBe(before);
  });

  it("records why a channel was skipped", async () => {
    const a = await book(customers[1]!, "12:00", true);
    const wa = (await rowsFor(a.id)).find((r) => r.channel === "WHATSAPP")!;
    expect([wa.status, wa.lastError]).toEqual(["SKIPPED", "No valid mobile number on file"]);
  });

  it("delivers every channel with fresh, escaped content and logs it", async () => {
    await deliverQueued(apptId);
    const rows = await rowsFor(apptId);
    expect(rows.every((r) => r.status === "SENT")).toBe(true);
    const mail = email.sent.find((m) => m.to === `${TAG}-c0@example.test`)!;
    expect(mail.subject).toContain(`${TAG} Therapy`);
    expect(mail.html).toContain("Zoë &lt;b&gt;");
    expect(mail.html).not.toContain("Zoë <b>");
    expect(mail.text).toContain("/portal/appointments/");
    expect(email.sent.some((m) => m.to === ADMIN_EMAIL && m.subject.startsWith("[New booking]"))).toBe(true);
    const inApp = rows.find((r) => r.channel === "IN_APP" && (r.data as { audience: string }).audience === "PROVIDER")!;
    expect(inApp.title).toBe(`New booking: Zoë <b> ${TAG}`);
    const waSent = whatsapp.sent.find((m) => m.to === "+923001234567")!;
    expect(waSent.templateName).toBe("booking_confirmation");
    expect(waSent.parameters[0]).toBe(`Zoë <b> ${TAG}`);
    expect(await prisma.emailLog.count({ where: { recipient: `${TAG}-c0@example.test`, status: "SENT" } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { notificationId: { in: rows.map((r) => r.id) }, status: "SENT" } })).toBe(rows.length);
  });

  it("concurrent workers never send the same notification twice", async () => {
    const a = await book(customers[2]!, "14:00", true);
    const row = (await rowsFor(a.id)).find((r) => r.channel === "EMAIL" && (r.data as { audience: string }).audience === "CUSTOMER")!;
    const before = email.sent.length;
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => deliverNotification(row.id)));
    expect(outcomes.filter((o) => o === "SENT")).toHaveLength(1);
    expect(email.sent.length - before).toBe(1);
  });
});

describe("retries", () => {
  it("transient failures retry after backoff; permanent failures close immediately", async () => {
    const a = await book(customers[0]!, "15:00", true);
    const row = (await rowsFor(a.id)).find((r) => r.channel === "EMAIL" && (r.data as { audience: string }).audience === "CUSTOMER")!;
    email.mode = "transient";
    expect(await deliverNotification(row.id)).toBe("RETRY");
    let n = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect([n.status, n.attempts, n.lastError]).toEqual(["FAILED", 1, "421 try again later"]);
    const dueNow = await findDueNotifications(5000);
    expect(dueNow.some((d) => d.id === row.id)).toBe(false); // backing off
    const dueLater = await findDueNotifications(5000, new Date(Date.now() + 2 * 60_000));
    expect(dueLater.some((d) => d.id === row.id)).toBe(true);

    email.mode = "permanent";
    expect(await deliverNotification(row.id)).toBe("FAILED");
    n = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect([n.status, n.attempts]).toEqual(["FAILED", MAX_NOTIFICATION_ATTEMPTS]);
    expect((await findDueNotifications(5000, new Date(Date.now() + 3 * 3_600_000))).some((d) => d.id === row.id)).toBe(false);
    expect(await prisma.emailLog.count({ where: { notificationId: row.id, status: "FAILED" } })).toBe(2);
    email.mode = "ok";
  });

  it("WhatsApp is skipped until the Meta template is approved", async () => {
    whatsapp.requiresApprovedTemplate = true;
    try {
      const a = await book(customers[2]!, "16:00", true);
      const row = (await rowsFor(a.id)).find((r) => r.channel === "WHATSAPP")!;
      const wt = await prisma.whatsAppTemplate.findFirstOrThrow({ where: { organizationId: org.id, key: "booking_confirmation" } });
      if (wt.status === "APPROVED") return; // a live org has approved it; nothing to assert
      expect(await deliverNotification(row.id)).toBe("SKIPPED");
      const n = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
      expect(n.lastError).toMatch(/not approved in Meta/);
    } finally {
      whatsapp.requiresApprovedTemplate = false;
    }
  });
});

describe("reminders", () => {
  it("are planned once and only sent while the booking still stands", async () => {
    const tomorrow = DateTime.fromISO(day).plus({ days: 1 }).toISODate()!;
    const kept = await book(customers[0]!, "11:00", true, tomorrow);
    const cancelled = await book(customers[1]!, "13:00", true, tomorrow);
    const moved = await book(customers[2]!, "15:00", true, tomorrow);
    // Planner "runs" 3 h before the first start: only the 2 h reminders are in reach.
    const keptStart = Date.parse(kept.startsAt);
    const planAt = new Date(keptStart - 3 * 3_600_000);
    await scheduleDueReminders(planAt);
    await scheduleDueReminders(planAt); // idempotent
    const reminders = async (id: string) => (await rowsFor(id)).filter((r) => r.event === "APPOINTMENT_REMINDER");
    const keptRows = await reminders(kept.id);
    expect(keptRows.map((r) => r.channel).sort()).toEqual(["EMAIL", "WHATSAPP"]);
    expect(keptRows.every((r) => r.scheduledFor?.getTime() === keptStart - 2 * 3_600_000)).toBe(true);

    // Not due yet.
    expect(await deliverNotification(keptRows[0]!.id, planAt)).toBe("NOT_CLAIMED");

    await cancelAppointment(staff, cancelled.id, { reason: "test" }, ctx);
    const movedTo = await rescheduleAppointment(staff, moved.id, { startsAt: at("16:00", tomorrow).toISOString(), overrideAvailability: false }, ctx);
    await scheduleDueReminders(planAt);
    expect((await reminders(movedTo.id)).length).toBe(2);

    const sendAt = new Date(keptStart - 2 * 3_600_000 + 60_000);
    for (const id of [kept.id, cancelled.id, moved.id]) {
      for (const r of await reminders(id)) await deliverNotification(r.id, new Date(Math.max(sendAt.getTime(), r.scheduledFor!.getTime())));
    }
    expect((await reminders(kept.id)).map((r) => r.status)).toEqual(["SENT", "SENT"]);
    for (const id of [cancelled.id, moved.id]) {
      const rows = await reminders(id);
      expect(rows.map((r) => r.status)).toEqual(["SKIPPED", "SKIPPED"]);
      expect(rows[0]!.lastError).toMatch(/No longer scheduled/);
    }
    const reminderMail = email.sent.find((m) => m.to === `${TAG}-c0@example.test` && m.subject.startsWith("Reminder:"))!;
    expect(reminderMail.subject).toContain("11:00 AM");
  });
});

describe("payments, events and delivery receipts", () => {
  it("a manual payment notifies PAYMENT_RECEIVED and confirms the pending booking", async () => {
    const a = await book(customers[1]!, "09:00", false);
    expect(summary(await rowsFor(a.id)).filter((s) => s.startsWith("BOOKING_CREATED/CUSTOMER"))).toEqual([
      "BOOKING_CREATED/CUSTOMER/EMAIL/QUEUED",
      "BOOKING_CREATED/CUSTOMER/IN_APP/QUEUED",
    ]);
    const pay = await recordManualPayment(staff, { bookingId: a.bookingId, amount: 3000, method: "CASH" }, ctx);
    expect(summary(await rowsFor(pay.id))).toEqual([
      "PAYMENT_RECEIVED/ADMIN/EMAIL/QUEUED",
      "PAYMENT_RECEIVED/CUSTOMER/EMAIL/QUEUED",
      "PAYMENT_RECEIVED/CUSTOMER/IN_APP/QUEUED",
      "PAYMENT_RECEIVED/CUSTOMER/WHATSAPP/SKIPPED",
    ]);
    expect(summary(await rowsFor(a.id)).filter((s) => s.startsWith("BOOKING_CONFIRMED"))).toContain("BOOKING_CONFIRMED/CUSTOMER/EMAIL/QUEUED");
    await deliverQueued(pay.id);
    const receipt = email.sent.find((m) => m.to === `${TAG}-c1@example.test` && m.subject.startsWith("Payment received"))!;
    expect(receipt.subject).toBe("Payment received: PKR 3,000.00");
  });

  it("a free event booking issues tickets to the customer and copies staff", async () => {
    const eb = await createEventBooking(
      { organization: org, customerId: customers[0]!.customerProfileId!, eventId, items: [{ ticketTypeId, quantity: 2 }], source: "ADMIN", online: false, confirm: true, actorUserId: staff.userId },
      ctx,
    );
    expect(summary(await rowsFor(eb.id))).toEqual([
      "BOOKING_CREATED/ADMIN/EMAIL/QUEUED",
      "EVENT_TICKET_CREATED/CUSTOMER/EMAIL/QUEUED",
      "EVENT_TICKET_CREATED/CUSTOMER/IN_APP/QUEUED",
      "EVENT_TICKET_CREATED/CUSTOMER/WHATSAPP/QUEUED",
    ]);
    await deliverQueued(eb.id);
    const inApp = (await rowsFor(eb.id)).find((r) => r.channel === "IN_APP")!;
    expect(inApp.body).toBe(`Your 2 ticket(s) for ${TAG} Workshop are ready.`);
  });

  it("WhatsApp delivery receipts only move forward", async () => {
    const msg = await prisma.whatsAppMessage.findFirstOrThrow({ where: { providerMessageId: { startsWith: `wamid.${TAG}` } }, orderBy: { createdAt: "asc" } });
    const t = (s: number) => new Date(Date.now() + s * 1000);
    await applyStatusEvents([
      { providerMessageId: msg.providerMessageId!, status: "DELIVERED", occurredAt: t(1), error: null, raw: {} },
      { providerMessageId: msg.providerMessageId!, status: "READ", occurredAt: t(2), error: null, raw: {} },
      { providerMessageId: msg.providerMessageId!, status: "DELIVERED", occurredAt: t(1), error: null, raw: {} }, // late duplicate
      { providerMessageId: msg.providerMessageId!, status: "FAILED", occurredAt: t(3), error: "131026", raw: {} },
    ]);
    const after = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: msg.id }, include: { deliveryLogs: true, notification: true } });
    expect(after.status).toBe("READ");
    expect(after.readAt).not.toBeNull();
    expect(after.notification!.status).toBe("READ");
    expect(after.deliveryLogs).toHaveLength(4);
  });
});

describe("inbox", () => {
  it("shows only the user's own notifications and marks them read", async () => {
    const [c0, c1] = [customers[0]!, customers[1]!];
    const mine = await listInbox(c0, { page: 1, pageSize: 50 });
    expect(mine.items.length).toBeGreaterThan(0);
    const allMine = await prisma.notification.findMany({ where: { recipientId: c0.userId, channel: "IN_APP", status: { in: ["SENT", "READ"] } }, select: { id: true } });
    expect(new Set(mine.items.map((i) => i.id))).toEqual(new Set(allMine.map((n) => n.id)));
    expect(mine.items[0]!.link).toMatch(/^\/portal\//);

    const unread = await unreadCount(c0);
    await markRead(c0, mine.items[0]!.id);
    expect(await unreadCount(c0)).toBe(unread - 1);
    await expect(markRead(c1, mine.items[1]?.id ?? mine.items[0]!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
