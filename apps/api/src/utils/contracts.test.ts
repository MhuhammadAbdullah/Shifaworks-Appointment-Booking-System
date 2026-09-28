import { describe, expect, it } from "vitest";
import * as shared from "@booking/shared";
import * as db from "../generated/prisma/enums.js";

describe("shared enums mirror the Prisma schema", () => {
  const pairs: [string, readonly string[], Record<string, string>][] = [
    ["UserStatus", shared.USER_STATUSES, db.UserStatus],
    ["ProviderType", shared.PROVIDER_TYPES, db.ProviderType],
    ["Gender", shared.GENDERS, db.Gender],
    ["AvailabilityExceptionType", shared.AVAILABILITY_EXCEPTION_TYPES, db.AvailabilityExceptionType],
    ["BookingType", shared.BOOKING_TYPES, db.BookingType],
    ["BookingStatus", shared.BOOKING_STATUSES, db.BookingStatus],
    ["BookingSource", shared.BOOKING_SOURCES, db.BookingSource],
    ["PaymentStatus", shared.PAYMENT_STATUSES, db.PaymentStatus],
    ["PaymentMethod", shared.PAYMENT_METHODS, db.PaymentMethod],
    ["InvoiceStatus", shared.INVOICE_STATUSES, db.InvoiceStatus],
    ["InvoiceAudience", shared.INVOICE_AUDIENCES, db.InvoiceAudience],
    ["FinanceTransactionType", shared.FINANCE_TX_TYPES, db.FinanceTransactionType],
    ["FinanceTransactionStatus", shared.FINANCE_TX_STATUSES, db.FinanceTransactionStatus],
    ["FinanceCategoryType", shared.FINANCE_CATEGORY_TYPES, db.FinanceCategoryType],
    ["ExpenseStatus", shared.EXPENSE_STATUSES, db.ExpenseStatus],
    ["NotificationChannel", shared.NOTIFICATION_CHANNELS, db.NotificationChannel],
    ["NotificationAudience", shared.NOTIFICATION_AUDIENCES, db.NotificationAudience],
    ["EmailTemplateKey", shared.EMAIL_TEMPLATE_KEYS, db.EmailTemplateKey],
    ["NotificationStatus", shared.NOTIFICATION_STATUSES, db.NotificationStatus],
    ["DeliveryStatus", shared.DELIVERY_STATUSES, db.DeliveryStatus],
    ["FileVisibility", shared.FILE_VISIBILITIES, db.FileVisibility],
    ["RecordStatus", shared.RECORD_STATUSES, db.RecordStatus],
  ];

  it.each(pairs)("%s", (_name, sharedValues, prismaEnum) => {
    expect([...sharedValues].sort()).toEqual(Object.values(prismaEnum).sort());
  });

  it("slot-holding statuses are the ones the exclusion constraint protects", () => {
    expect([...shared.SLOT_HOLDING_STATUSES]).toEqual(["PENDING_PAYMENT", "PAYMENT_SUBMITTED", "PAYMENT_VERIFIED", "CONFIRMED"]);
  });
});

describe("document numbers", () => {
  it("formats and parses", () => {
    expect(shared.formatDocumentNumber("APT", 2026, 1)).toBe("APT-2026-000001");
    expect(shared.formatDocumentNumber("INV", 2026, 1_234_567)).toBe("INV-2026-1234567");
    expect(() => shared.formatDocumentNumber("APT", 2026, 0)).toThrow(RangeError);
    expect(shared.parseDocumentNumber("PAY-2026-000042")).toEqual({ prefix: "PAY", year: 2026, value: 42 });
    expect(shared.parseDocumentNumber("PSL-2026-000007")).toEqual({ prefix: "PSL", year: 2026, value: 7 });
    expect(shared.parseDocumentNumber("XYZ-2026-000042")).toBeNull();
  });
});

describe("role matrix", () => {
  it("only uses known permissions and keeps providers minimal", () => {
    for (const perms of Object.values(shared.DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) expect(shared.isPermissionKey(p)).toBe(true);
    }
    const { THERAPIST, COUNSELLOR, ADMIN, RECEPTIONIST } = shared.DEFAULT_ROLE_PERMISSIONS;
    for (const provider of [THERAPIST, COUNSELLOR]) {
      expect(provider).not.toContain("bookings.view_all");
      expect(provider).not.toContain("payments.view");
      expect(provider).not.toContain("settings.manage");
    }
    expect(RECEPTIONIST).not.toContain("bookings.override_availability");
    expect(ADMIN).toHaveLength(shared.ALL_PERMISSIONS.length - 1);
    expect(ADMIN).not.toContain("roles.manage");
  });

  it("has no customer role (customers never log in)", () => {
    expect(shared.ROLE_KEYS as readonly string[]).not.toContain("CUSTOMER");
  });
});

describe("services and settings catalogue", () => {
  it("defines exactly the five ShifaWorks booking URLs", () => {
    expect([...shared.SERVICE_SLUGS]).toEqual(["hijama-therapy", "speech-therapy", "islamic-life-coaching", "faith-based-counseling", "clinical-counseling"]);
    for (const slug of shared.SERVICE_SLUGS) expect(shared.SERVICE_DEFINITIONS[slug].slug).toBe(slug);
  });

  it("gives every setting a unique key and a default", () => {
    const keys = Object.values(shared.SETTINGS).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(shared.SETTING_DEFAULTS.termsUrl).toBe("https://shifaworks.com/terms-conditions");
  });
});
