/**
 * Phase 6 against real PostgreSQL: invoices. Raising an invoice from a
 * booking is idempotent (the booking's existing non-void invoice is
 * returned unchanged); issuing/voiding and the payments-received rollup are
 * all exercised here. Manual invoice creation (arbitrary customer + line
 * items) is also covered since it shares the money.ts pricing math with the
 * per-service booking forms.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { ALL_PERMISSIONS, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { createProvider } from "../../src/modules/providers/providers.service.js";
import { createPackage } from "../../src/modules/services/services.service.js";
import { setWeeklySchedule } from "../../src/modules/availability/availability.service.js";
import { createManualBooking } from "../../src/modules/appointments/bookings.service.js";
import { verifyPayment } from "../../src/modules/payments/payments.service.js";
import { createInvoice, createPayslip, getInvoice, invoiceFromBooking, issueInvoice, voidInvoice } from "../../src/modules/invoices/invoices.service.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const TZ = "Asia/Karachi";
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
let hijamaServiceId: string;
let providerId: string;
let packageId: string;
let customerId: string;
const createdUserIds: string[] = [];
const createdProviderIds: string[] = [];
const createdPackageIds: string[] = [];

function principal(permissions: readonly PermissionKey[]): Principal {
  return {
    userId: actorId,
    authUserId: actorId,
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
    roleKeys: ["ADMIN"],
    permissions: new Set(permissions),
    isSuperAdmin: false,
    staffProfileId: "staff",
    providerProfileId: null,
    providerType: null,
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

const weekMonday = (n: number) => DateTime.now().setZone(TZ).plus({ weeks: 4 + n }).startOf("week").toISODate()!;
const at = (n: number, time = "09:00") => DateTime.fromISO(`${weekMonday(n)}T${time}`, { zone: TZ }).toISO()!;

let emailCounter = 0;
const bookAt = (n: number) =>
  createManualBooking(
    admin(),
    {
      service: "hijama-therapy" as const,
      providerId,
      packageId,
      startsAt: at(n),
      personal: { firstName: "Ahmed", lastName: TAG, phone: "+923001234567", email: `i${emailCounter++}-${TAG}@example.test`, gender: "MALE" as const },
      location: { city: "Karachi", address: "House 1" },
      source: "PHONE" as const,
      overrideAvailability: false,
      markPaid: false,
    },
    ctx,
  );

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  hijamaServiceId = (await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "hijama-therapy" } })).id;
  const actor = await prisma.user.create({
    data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG },
  });
  actorId = actor.id;
  createdUserIds.push(actor.id);

  const provider = await createProvider(
    admin(),
    { providerType: "THERAPIST", displayName: `${TAG} Provider`, gender: "MALE", acceptsMale: true, acceptsFemale: true, serviceIds: [hijamaServiceId] },
    ctx,
  );
  providerId = provider.id;
  createdProviderIds.push(providerId);
  await setWeeklySchedule(admin(), providerId, { timezone: TZ, days: [{ dayOfWeek: 1, intervals: [{ start: "09:00", end: "17:00" }] }] }, ctx);
  packageId = (await createPackage(admin(), hijamaServiceId, { name: `${TAG} Package`, price: 1000, durationMinutes: 60 }, ctx)).id;
  createdPackageIds.push(packageId);

  const c = await prisma.customer.create({
    data: { organizationId: org.id, customerNumber: `CUS-TEST-${TAG}`, firstName: "Direct", lastName: TAG, email: `direct-${TAG}@example.test` },
  });
  customerId = c.id;
});

afterAll(async () => {
  const customers = await prisma.customer.findMany({ where: { email: { endsWith: `${TAG}@example.test` } }, select: { id: true } });
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length) {
    await prisma.financeTransaction.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId: { in: customerIds } } } });
    await prisma.payment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.appointment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.booking.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  if (createdPackageIds.length) await prisma.servicePackage.deleteMany({ where: { id: { in: createdPackageIds } } });
  if (createdProviderIds.length) {
    // Payslip invoices reference providerId with onDelete: Restrict — clear them (and, since
    // FinanceTransaction links back only via its `reference` string, their ledger entries) before
    // the provider profile itself can be deleted below.
    const payslips = await prisma.invoice.findMany({ where: { providerId: { in: createdProviderIds } }, select: { invoiceNumber: true } });
    if (payslips.length) await prisma.financeTransaction.deleteMany({ where: { reference: { in: payslips.map((p) => p.invoiceNumber) } } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { providerId: { in: createdProviderIds } } } });
    await prisma.invoice.deleteMany({ where: { providerId: { in: createdProviderIds } } });
    await prisma.serviceProvider.deleteMany({ where: { providerId: { in: createdProviderIds } } });
    await prisma.availabilityRule.deleteMany({ where: { availability: { providerId: { in: createdProviderIds } } } });
    await prisma.availability.deleteMany({ where: { providerId: { in: createdProviderIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: createdProviderIds } } });
  }
  if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.auditLog.deleteMany({ where: { requestId: TAG } });
  await prisma.$disconnect();
});

describe("invoice from booking", () => {
  it("builds one line from the appointment and is idempotent", async () => {
    const b = await bookAt(0);
    const inv = await invoiceFromBooking(admin(), { bookingId: b.id }, ctx);
    expect(inv.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(inv.status).toBe("ISSUED");
    expect(inv.totalAmount).toBe("1000.00");
    expect(inv.amountDue).toBe("1000.00");
    expect(inv.items).toHaveLength(1);

    const again = await invoiceFromBooking(admin(), { bookingId: b.id }, ctx);
    expect(again.id).toBe(inv.id);
  });

  it("counts an already-verified payment towards the invoice", async () => {
    const b = await bookAt(1);
    await verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx);
    const inv = await invoiceFromBooking(admin(), { bookingId: b.id }, ctx);
    expect(inv.amountPaid).toBe("1000.00");
    expect(inv.amountDue).toBe("0.00");
    expect(inv.status).toBe("PAID");
  });

  it("needs invoices.create", async () => {
    const b = await bookAt(2);
    const err = await errorOf(invoiceFromBooking(principal(["invoices.view"]), { bookingId: b.id }, ctx));
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("manual invoice", () => {
  it("prices lines with discount before tax, half-up to 2dp", async () => {
    const inv = await createInvoice(
      admin(),
      { customerId, items: [{ description: "Consultation", quantity: 2, unitPrice: 500, discountAmount: 50, taxRatePercent: 10 }], issue: false },
      ctx,
    );
    expect(inv.status).toBe("DRAFT");
    // gross 1000, discount 50, net 950, tax 95, total 1045
    expect(inv.subtotal).toBe("1000.00");
    expect(inv.discountAmount).toBe("50.00");
    expect(inv.taxAmount).toBe("95.00");
    expect(inv.totalAmount).toBe("1045.00");
  });

  it("rejects an unknown customer", async () => {
    const err = await errorOf(
      createInvoice(admin(), { customerId: randomUUID(), items: [{ description: "X", quantity: 1, unitPrice: 100, discountAmount: 0, taxRatePercent: 0 }], issue: false }, ctx),
    );
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});

describe("issue / void", () => {
  it("issues a draft invoice", async () => {
    const inv = await createInvoice(admin(), { customerId, items: [{ description: "Session", quantity: 1, unitPrice: 500, discountAmount: 0, taxRatePercent: 0 }], issue: false }, ctx);
    expect(inv.status).toBe("DRAFT");
    const issued = await issueInvoice(admin(), inv.id, ctx);
    expect(issued.status).toBe("ISSUED");
    expect(issued.issuedAt).not.toBeNull();
  });

  it("refuses to void an invoice with unrefunded payments, but succeeds once refunded", async () => {
    const b = await bookAt(3);
    await verifyPayment(admin(), b.payment!.id, { method: "CASH" }, ctx);
    const inv = await invoiceFromBooking(admin(), { bookingId: b.id }, ctx);
    const err = await errorOf(voidInvoice(admin(), inv.id, "Testing", ctx));
    expect(err.code).toBe("BAD_REQUEST");

    const { refundPayment } = await import("../../src/modules/payments/payments.service.js");
    await refundPayment(admin(), b.payment!.id, { amount: 1000, reason: "Void test" }, ctx);
    const voided = await voidInvoice(admin(), inv.id, "Testing", ctx);
    expect(voided.status).toBe("VOID");
    expect((await getInvoice(admin(), inv.id)).status).toBe("VOID");
  });
});

describe("provider pay-slips", () => {
  it("creates a DRAFT pay-slip with no ledger entry until issued", async () => {
    const inv = await createPayslip(admin(), { providerId, amount: 5000, description: "Sessions Sep 1-15", issue: false }, ctx);
    expect(inv.audience).toBe("PROVIDER");
    expect(inv.invoiceNumber).toMatch(/^PSL-\d{4}-\d{6}$/);
    expect(inv.status).toBe("DRAFT");
    expect(inv.provider?.id).toBe(providerId);
    expect(inv.customer).toBeNull();
    expect(inv.totalAmount).toBe("5000.00");

    const posted = await prisma.financeTransaction.findFirst({ where: { reference: inv.invoiceNumber } });
    expect(posted).toBeNull();
  });

  it("posts an EXPENSE ledger entry under Salaries once issued", async () => {
    const inv = await createPayslip(admin(), { providerId, amount: 6000, description: "Sessions Sep 16-30", issue: false }, ctx);
    const issued = await issueInvoice(admin(), inv.id, ctx);
    expect(issued.status).toBe("ISSUED");

    const txn = await prisma.financeTransaction.findFirst({ where: { reference: inv.invoiceNumber }, include: { category: true } });
    expect(txn).not.toBeNull();
    expect(txn!.type).toBe("EXPENSE");
    expect(txn!.amount.toString()).toBe("6000.00");
    expect(txn!.category?.slug).toBe("salaries");
  });

  it("issue: true creates and posts in one step", async () => {
    const inv = await createPayslip(admin(), { providerId, amount: 4200, description: "Bonus", issue: true }, ctx);
    expect(inv.status).toBe("ISSUED");
    const txn = await prisma.financeTransaction.findFirst({ where: { reference: inv.invoiceNumber } });
    expect(txn).not.toBeNull();
    expect(txn!.amount.toString()).toBe("4200.00");
  });

  it("needs invoices.create", async () => {
    const err = await errorOf(createPayslip(principal(["invoices.view"]), { providerId, amount: 1000, description: "X", issue: false }, ctx));
    expect(err.code).toBe("FORBIDDEN");
  });

  it("rejects an unknown provider", async () => {
    const err = await errorOf(createPayslip(admin(), { providerId: randomUUID(), amount: 1000, description: "X", issue: false }, ctx));
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("does not disturb customer invoices, which still never post to the ledger", async () => {
    const inv = await createInvoice(admin(), { customerId, items: [{ description: "Session", quantity: 1, unitPrice: 700, discountAmount: 0, taxRatePercent: 0 }], issue: false }, ctx);
    const issued = await issueInvoice(admin(), inv.id, ctx);
    expect(issued.audience).toBe("CUSTOMER");
    const txn = await prisma.financeTransaction.findFirst({ where: { reference: issued.invoiceNumber } });
    expect(txn).toBeNull();
  });
});
