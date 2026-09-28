/**
 * Creates a booking + appointment + payment in one transaction. The public
 * booking form (Phase 4) and manual staff booking (Phase 5) both call this,
 * so search and booking can never disagree (docs/ARCHITECTURE.md §5).
 *
 * Phase 4 wires only the online path (public submissions). Phase 5 adds the
 * staff/manual path (source ADMIN/PHONE/WALK_IN, online: false,
 * `createdById`, `overrideAvailability`) and the cancel/reschedule/
 * complete/no-show transitions on top of the rows created here.
 */
import { DateTime } from "luxon";
import type { Gender } from "@booking/shared";
import { providerAcceptsGender } from "@booking/shared";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { Prisma, type BookingSource, type BookingStatus, type PaymentMethod, type PaymentStatus } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { BOOKING_TX_OPTIONS, isExclusionViolation, isUniqueViolation, withTxRetry } from "../../utils/db-errors.js";
import { money, parseDateOnly } from "../../utils/serialize.js";
import { nextDocumentNumber } from "../../lib/document-sequence.js";
import { getOrgSettings } from "../../lib/settings.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { loadAvailabilityData, loadProviderContexts } from "../availability/availability.repository.js";
import { resolveSlotPlan } from "../availability/availability.service.js";
import { SLOT_CHECK_MESSAGES, checkSlot } from "../availability/slot-engine.js";
import { postLedgerEntry } from "../finance/ledger.js";
import { queueNotifications } from "../notifications/outbox.js";
import { assertPrivateFile } from "../files/files.service.js";

export interface BookingCustomerInput {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** YYYY-MM-DD */
  dateOfBirth?: string | null;
  gender?: Gender | null;
  city?: string | null;
  province?: string | null;
  address?: string | null;
}

export interface CreateBookingRequest {
  organization: { id: string; timezone: string; currency: string };
  serviceId: string;
  providerId: string;
  packageId: string;
  startsAt: Date;
  customer: BookingCustomerInput;
  /** The service-specific "details" step answers, already validated by its Zod schema. */
  formData: unknown;
  formVersion: number;
  termsUrl: string | null;
  termsAcceptedAt: Date | null;
  customerNotes?: string | null;
  source: BookingSource;
  /** true = public submission (strict slot match, service must be open); false = staff booking (Phase 5). */
  online: boolean;
  overrideAvailability?: boolean;
  idempotencyKey?: string | null;
  createdById?: string | null;
  /**
   * Public submission only: a payment receipt the customer attached at
   * booking time. When set, the payment starts already carrying the proof
   * (PENDING, not yet verified) and the booking skips straight to
   * PAYMENT_SUBMITTED instead of PENDING_PAYMENT — the same status
   * payments.service.ts's markSubmitted reaches when staff record that
   * proof arrived later. Mutually exclusive with markPaid (staff-only).
   */
  receiptFileId?: string | null;
  /**
   * Manual booking only ("paid at the desk", ARCHITECTURE.md §8): records the
   * payment as already verified instead of PENDING, and posts the INCOME
   * ledger row immediately (finance/ledger.ts). When the organisation's
   * `booking.autoConfirmOnVerify` setting is on, the booking starts CONFIRMED
   * instead of PENDING_PAYMENT.
   */
  markPaid?: { method: PaymentMethod; verifiedById: string } | null;
}

export interface CreateBookingResult {
  bookingId: string;
  bookingNumber: string;
  appointmentId: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  amount: string;
  currency: string;
  appointment: {
    providerName: string;
    serviceName: string;
    packageName: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    date: string;
    time: string;
  };
}

const fullBookingInclude = {
  appointments: {
    take: 1,
    orderBy: { createdAt: "asc" as const },
    include: {
      provider: { select: { displayName: true } },
      service: { select: { name: true } },
      package: { select: { name: true } },
    },
  },
} as const;

function toResult(
  booking: { id: string; bookingNumber: string; status: BookingStatus; paymentStatus: PaymentStatus; totalAmount: { toFixed(n: number): string }; currency: string },
  appointment: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    provider: { displayName: string };
    service: { name: string };
    package: { name: string } | null;
  },
): CreateBookingResult {
  const local = DateTime.fromJSDate(appointment.startsAt, { zone: appointment.timezone });
  return {
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    appointmentId: appointment.id,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    amount: money(booking.totalAmount),
    currency: booking.currency,
    appointment: {
      providerName: appointment.provider.displayName,
      serviceName: appointment.service.name,
      packageName: appointment.package?.name ?? appointment.service.name,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      timezone: appointment.timezone,
      date: local.toISODate()!,
      time: local.toFormat("HH:mm"),
    },
  };
}

/** Idempotent replay: a booking already created for this key, mapped to the same response shape. */
async function findByIdempotencyKey(db: DbClient, organizationId: string, key: string): Promise<CreateBookingResult | null> {
  const booking = await db.booking.findFirst({
    where: { organizationId, idempotencyKey: key },
    include: fullBookingInclude,
  });
  const appointment = booking?.appointments[0];
  if (!booking || !appointment) return null;
  return toResult(booking, appointment);
}

async function findOrCreateCustomer(tx: DbClient, organizationId: string, input: BookingCustomerInput, year: number): Promise<string> {
  if (input.email) {
    const existing = await tx.customer.findFirst({ where: { organizationId, email: input.email }, select: { id: true } });
    // Matched by email: keep the existing record as-is (§3) — only the booking snapshot captures this submission.
    if (existing) return existing.id;
  }
  const customerNumber = await nextDocumentNumber(tx, organizationId, "CUS", year);
  const created = await tx.customer.create({
    data: {
      organizationId,
      customerNumber,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      dateOfBirth: input.dateOfBirth ? parseDateOnly(input.dateOfBirth) : null,
      gender: input.gender ?? null,
      city: input.city ?? null,
      province: input.province ?? null,
      address: input.address ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

export async function createAppointmentBooking(req: CreateBookingRequest): Promise<CreateBookingResult> {
  const now = new Date();

  if (req.idempotencyKey) {
    const existing = await findByIdempotencyKey(prisma, req.organization.id, req.idempotencyKey);
    if (existing) return existing;
  }

  try {
    return await withTxRetry(() =>
      prisma.$transaction(async (tx) => {
        // 1-4: service open, provider assigned + active + gender-matched, package active — same
        // functions the slot search uses, so a customer can never book a time it did not offer.
        const [plan, service, pkg, provider] = await Promise.all([
          resolveSlotPlan(tx, req.organization, { serviceId: req.serviceId, providerId: req.providerId, packageId: req.packageId }, { online: req.online, now }),
          tx.service.findFirstOrThrow({ where: { id: req.serviceId, organizationId: req.organization.id }, select: { name: true } }),
          tx.servicePackage.findFirstOrThrow({
            where: { id: req.packageId, serviceId: req.serviceId },
            select: { name: true, price: true, discountEnabled: true, discountPercent: true },
          }),
          tx.providerProfile.findFirstOrThrow({
            where: { id: req.providerId, organizationId: req.organization.id, deletedAt: null },
            select: { displayName: true, acceptsMale: true, acceptsFemale: true },
          }),
        ]);
        if (req.online && req.customer.gender && !providerAcceptsGender(provider, req.customer.gender)) {
          throw AppError.validation([{ path: "providerId", message: "This provider does not see customers of your gender" }]);
        }

        // 5. The exact requested time must still be a valid, free slot (strict for online:
        //    it must be one of the offered slots; staff may book any time that fits, Phase 5).
        const durationMs = plan.timing.durationMinutes * 60_000;
        const endsAt = new Date(req.startsAt.getTime() + durationMs);
        const blockedFrom = new Date(req.startsAt.getTime() - plan.timing.bufferBeforeMinutes * 60_000);
        const blockedUntil = new Date(endsAt.getTime() + plan.timing.bufferAfterMinutes * 60_000);

        if (!req.overrideAvailability) {
          const contexts = await loadProviderContexts(tx, req.organization.id, [req.providerId], req.organization.timezone);
          const data = (
            await loadAvailabilityData(tx, req.organization.id, [...contexts.values()], { from: blockedFrom, to: blockedUntil }, undefined, req.serviceId)
          ).get(req.providerId)!;
          const check = checkSlot(data, plan.timing, req.startsAt, now, req.online);
          if (!check.ok) {
            const message = SLOT_CHECK_MESSAGES[check.reason];
            if (check.reason === "CONFLICT") throw new AppError("SLOT_UNAVAILABLE", message);
            throw AppError.validation([{ path: "startsAt", message }]);
          }
        }
        await assertPrivateFile(tx, req.organization.id, req.receiptFileId, "receiptFileId");

        // 6. Insert customer (match by email or create), booking with its snapshot, the
        //    appointment (the exclusion constraint is the final guarantee against double-booking),
        //    and a PENDING payment — all in this one transaction.
        const year = DateTime.now().setZone(req.organization.timezone).year;
        const customerId = await findOrCreateCustomer(tx, req.organization.id, req.customer, year);
        const bookingNumber = await nextDocumentNumber(tx, req.organization.id, "APT", year);
        const grossAmount = pkg.price;
        const discountAmount = pkg.discountEnabled && pkg.discountPercent ? grossAmount.mul(pkg.discountPercent).div(100) : new Prisma.Decimal(0);
        const amount = grossAmount.minus(discountAmount);

        let status: BookingStatus = "PENDING_PAYMENT";
        let paymentStatus: PaymentStatus = "PENDING";
        let confirmedAt: Date | null = null;
        if (req.markPaid) {
          paymentStatus = "VERIFIED";
          const { autoConfirmOnVerify } = await getOrgSettings(req.organization.id);
          if (autoConfirmOnVerify) {
            status = "CONFIRMED";
            confirmedAt = now;
          } else {
            status = "PAYMENT_VERIFIED";
          }
        } else if (req.receiptFileId) {
          // Customer attached proof at submission time — same status payments.service.ts's
          // markSubmitted reaches when staff record that proof arrived later, just reached earlier.
          status = "PAYMENT_SUBMITTED";
        }

        const booking = await tx.booking.create({
          data: {
            organizationId: req.organization.id,
            bookingNumber,
            type: "APPOINTMENT",
            customerId,
            source: req.source,
            status,
            paymentStatus,
            confirmedAt,
            currency: req.organization.currency,
            subtotal: grossAmount,
            discountAmount,
            totalAmount: amount,
            amountPaid: req.markPaid ? amount : undefined,
            customerFirstName: req.customer.firstName,
            customerLastName: req.customer.lastName ?? null,
            customerEmail: req.customer.email ?? null,
            customerPhone: req.customer.phone ?? null,
            customerDateOfBirth: req.customer.dateOfBirth ? parseDateOnly(req.customer.dateOfBirth) : null,
            customerGender: req.customer.gender ?? null,
            customerCity: req.customer.city ?? null,
            customerProvince: req.customer.province ?? null,
            customerAddress: req.customer.address ?? null,
            formData: req.formData as Prisma.InputJsonValue,
            formVersion: req.formVersion,
            termsAcceptedAt: req.termsAcceptedAt,
            termsUrl: req.termsUrl,
            customerNotes: req.customerNotes ?? null,
            idempotencyKey: req.idempotencyKey ?? null,
            createdById: req.createdById ?? null,
          },
        });

        const appointment = await tx.appointment.create({
          data: {
            organizationId: req.organization.id,
            bookingId: booking.id,
            customerId,
            providerId: req.providerId,
            serviceId: req.serviceId,
            packageId: req.packageId,
            startsAt: req.startsAt,
            endsAt,
            blockedFrom,
            blockedUntil,
            timezone: plan.timezone,
            status,
            paymentStatus,
            confirmedAt,
            price: grossAmount,
            discountAmount,
            totalAmount: amount,
            source: req.source,
            availabilityOverridden: Boolean(req.overrideAvailability),
          },
          select: { id: true, startsAt: true, endsAt: true, timezone: true },
        });

        const paymentNumber = await nextDocumentNumber(tx, req.organization.id, "PAY", year);
        const payment = await tx.payment.create({
          data: {
            organizationId: req.organization.id,
            paymentNumber,
            bookingId: booking.id,
            customerId,
            status: paymentStatus,
            method: req.markPaid?.method ?? null,
            amount,
            currency: req.organization.currency,
            ...(req.markPaid ? { verifiedAt: now, verifiedById: req.markPaid.verifiedById } : {}),
            ...(req.receiptFileId ? { proofFileId: req.receiptFileId, submittedAt: now } : {}),
          },
          select: { id: true },
        });

        if (req.markPaid) {
          await postLedgerEntry(tx, {
            organizationId: req.organization.id,
            orgTimezone: req.organization.timezone,
            type: "INCOME",
            amount,
            currency: req.organization.currency,
            paymentMethod: req.markPaid.method,
            categorySlug: "appointments",
            bookingId: booking.id,
            paymentId: payment.id,
            customerId,
            reference: paymentNumber,
            notes: `Payment for ${bookingNumber}`,
            transactionDate: now,
            createdById: req.markPaid.verifiedById,
          });
        }

        await recordAudit(
          tx,
          { organizationId: req.organization.id, userId: req.createdById ?? null, ipAddress: null, userAgent: null, requestId: null } satisfies AuditContext,
          {
            action: "booking.create",
            entityType: "booking",
            entityId: booking.id,
            newValues: { bookingNumber, serviceId: req.serviceId, providerId: req.providerId, packageId: req.packageId, startsAt: req.startsAt, source: req.source },
          },
        );

        // "Paid at the desk": the payment is already verified, so the customer hears
        // "confirmed" directly rather than "received"; admin/provider still hear
        // "received" (there's no separate BOOKING_CONFIRMED without staff noticing).
        if (req.markPaid) {
          await queueNotifications(tx, { templateKey: "BOOKING_RECEIVED", bookingId: booking.id, audiences: ["ADMIN"] });
          await queueNotifications(tx, { templateKey: "BOOKING_CONFIRMED", bookingId: booking.id, audiences: ["CUSTOMER", "PROVIDER"] });
        } else {
          await queueNotifications(tx, { templateKey: "BOOKING_RECEIVED", bookingId: booking.id, audiences: ["CUSTOMER", "ADMIN"] });
        }

        return toResult(booking, { ...appointment, provider, service, package: pkg });
      }, BOOKING_TX_OPTIONS),
    );
  } catch (err) {
    if (isExclusionViolation(err)) {
      throw new AppError("SLOT_UNAVAILABLE", "This time was just booked by someone else. Please choose another time.");
    }
    if (isUniqueViolation(err) && req.idempotencyKey) {
      const existing = await findByIdempotencyKey(prisma, req.organization.id, req.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }
}
