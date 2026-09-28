import { z, ZodError } from "zod";
import {
  CONCERN_CHECKLIST_FIELD,
  SERVICE_BOOKING_SCHEMAS,
  SERVICE_DEFINITIONS,
  isServiceSlug,
  type AnyBookingInput,
  type Gender,
  type PublicAvailableDatesQuery,
  type PublicBookingResponse,
  type PublicBrandingDto,
  type PublicProviderDto,
  type PublicServiceDto,
  type PublicSlotsQuery,
  type ServiceSlug,
} from "@booking/shared";
import { prisma } from "../../lib/prisma.js";
import { getOrgSettings } from "../../lib/settings.js";
import { getPublicOrganization } from "../../lib/organization.js";
import { AppError } from "../../utils/app-error.js";
import { money } from "../../utils/serialize.js";
import { availableDates as computeAvailableDates, slotsForDate as computeSlotsForDate } from "../availability/availability.service.js";
import { fileUrlSelect, publicFileUrl, uploadPrivateFileAnonymous, type UploadedFile } from "../files/files.service.js";
import { createAppointmentBooking } from "../appointments/booking-engine.js";
import type { AuditContext } from "../audit/audit.service.js";

async function resolveServiceId(organizationId: string, slug: ServiceSlug): Promise<string> {
  const service = await prisma.service.findFirst({ where: { organizationId, slug }, select: { id: true } });
  if (!service) throw AppError.notFound("Service");
  return service.id;
}

function paymentInstructionsOf(settings: Awaited<ReturnType<typeof getOrgSettings>>) {
  return {
    bankName: settings.paymentBankName,
    accountTitle: settings.paymentAccountTitle,
    accountNumber: settings.paymentAccountNumber,
    iban: settings.paymentIban,
    jazzcash: settings.paymentJazzcash,
    easypaisa: settings.paymentEasypaisa,
    whatsapp: settings.whatsappNumber,
    instructions: settings.paymentInstructions,
  };
}

/** Org name + logo for the booking forms' header, before anyone signs in. */
export async function getBranding(): Promise<PublicBrandingDto> {
  const organization = await getPublicOrganization();
  return { name: organization.name, logoUrl: organization.logoUrl };
}

/** A payment receipt the customer attaches before submitting the booking form (its own step — the booking doesn't exist yet). */
export async function uploadPublicReceipt(file: UploadedFile, partialCtx: Omit<AuditContext, "organizationId" | "userId">) {
  const organization = await getPublicOrganization();
  return uploadPrivateFileAnonymous(organization.id, file, { ...partialCtx, organizationId: organization.id, userId: null });
}

// ---------------------------------------------------------------------------
// Service bootstrap
// ---------------------------------------------------------------------------

export async function getServiceBootstrap(slug: string): Promise<PublicServiceDto> {
  if (!isServiceSlug(slug)) throw AppError.notFound("Service");
  const organization = await getPublicOrganization();
  const service = await prisma.service.findFirst({
    where: { organizationId: organization.id, slug },
    select: {
      name: true,
      description: true,
      isActive: true,
      bookingEnabled: true,
      deliveryModeVisible: true,
      providerType: true,
      defaultDurationMinutes: true,
      currency: true,
      packages: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
        select: { id: true, name: true, description: true, points: true, durationMinutes: true, price: true, discountEnabled: true, discountPercent: true },
      },
      concernOptions: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        select: { code: true, label: true },
      },
    },
  });
  if (!service) throw AppError.notFound("Service");
  const settings = await getOrgSettings(organization.id);
  return {
    slug,
    name: service.name,
    description: service.description,
    open: service.isActive && service.bookingEnabled,
    providerType: service.providerType ?? SERVICE_DEFINITIONS[slug].providerType,
    currency: service.currency,
    termsUrl: settings.termsUrl,
    packages: service.packages.map((p) => {
      const discounted = p.discountEnabled && p.discountPercent ? p.price.minus(p.price.mul(p.discountPercent).div(100)) : null;
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        points: p.points,
        durationMinutes: p.durationMinutes ?? service.defaultDurationMinutes,
        price: money(discounted ?? p.price),
        originalPrice: discounted ? money(p.price) : null,
        discountPercent: p.discountEnabled ? (p.discountPercent?.toNumber() ?? null) : null,
      };
    }),
    concernOptions: service.concernOptions,
    deliveryModeVisible: service.deliveryModeVisible,
    support: { email: settings.supportEmail, phone: settings.supportPhone, whatsapp: settings.whatsappNumber },
    paymentInstructions: paymentInstructionsOf(settings),
  };
}

// ---------------------------------------------------------------------------
// Providers (gender filtering happens here, never in the browser)
// ---------------------------------------------------------------------------

export async function listPublicProviders(slug: ServiceSlug, gender: Gender | undefined): Promise<PublicProviderDto[]> {
  const organization = await getPublicOrganization();
  const serviceId = await resolveServiceId(organization.id, slug);
  const rows = await prisma.providerProfile.findMany({
    where: {
      organizationId: organization.id,
      isActive: true,
      deletedAt: null,
      services: { some: { serviceId, isActive: true } },
      ...(gender === "MALE" ? { acceptsMale: true } : gender === "FEMALE" ? { acceptsFemale: true } : {}),
    },
    select: { id: true, displayName: true, designation: true, experienceYears: true, rating: true, profileImage: fileUrlSelect },
    orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
    take: 100,
  });
  return rows.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    designation: p.designation,
    experienceYears: p.experienceYears,
    rating: p.rating === null ? null : p.rating.toFixed(1),
    photoUrl: publicFileUrl(p.profileImage),
  }));
}

// ---------------------------------------------------------------------------
// Slots (same engine the staff preview uses — see availability.service.ts)
// ---------------------------------------------------------------------------

export async function publicAvailableDates(query: PublicAvailableDatesQuery) {
  const organization = await getPublicOrganization();
  const serviceId = await resolveServiceId(organization.id, query.service);
  return computeAvailableDates(
    { id: organization.id, timezone: organization.timezone },
    { serviceId, providerId: query.provider, packageId: query.package, from: query.from, to: query.to },
    { online: true },
  );
}

export async function publicSlots(query: PublicSlotsQuery) {
  const organization = await getPublicOrganization();
  const serviceId = await resolveServiceId(organization.id, query.service);
  return computeSlotsForDate(
    { id: organization.id, timezone: organization.timezone },
    { serviceId, providerId: query.provider, packageId: query.package, date: query.date },
    { online: true },
  );
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

const serviceGuessSchema = z.object({ service: z.string() });

/**
 * The checklist's own Zod shape (checklistWithOtherDynamic) can't enum-check
 * codes since they're admin-managed, not fixed — so every non-"OTHER" code
 * is checked against the service's currently-active options here instead.
 */
async function assertValidConcernSelection(serviceId: string, input: AnyBookingInput): Promise<void> {
  const field = CONCERN_CHECKLIST_FIELD[input.service];
  if (!field) return;
  const details = input.details as Record<string, { selected: string[] } | undefined>;
  const codes = (details[field]?.selected ?? []).filter((c) => c !== "OTHER");
  if (codes.length === 0) return;
  const active = await prisma.serviceConcernOption.findMany({
    where: { serviceId, isActive: true, code: { in: codes } },
    select: { code: true },
  });
  const activeSet = new Set(active.map((o) => o.code));
  const invalid = codes.filter((c) => !activeSet.has(c));
  if (invalid.length) {
    throw AppError.validation([{ path: `details.${field}.selected`, message: "Please choose from the current options and try again" }]);
  }
}

/**
 * Picks the right per-service Zod schema by the body's `service` field, then
 * validates the whole payload against it, before handing off to the shared
 * booking engine (docs/ARCHITECTURE.md §5, "Creating a booking").
 */
export async function submitPublicBooking(rawBody: unknown, idempotencyKey: string | null): Promise<PublicBookingResponse> {
  const guess = serviceGuessSchema.safeParse(rawBody);
  if (!guess.success || !isServiceSlug(guess.data.service)) {
    throw AppError.validation([{ path: "service", message: "Choose a service" }]);
  }
  // Parsed here (not via the `validate()` middleware) because the right schema
  // depends on the body's own `service` field. Express would convert a raw
  // ZodError the same way, but this function is also called directly by
  // integration tests, so it converts it itself for a consistent AppError contract.
  let input: AnyBookingInput;
  try {
    input = SERVICE_BOOKING_SCHEMAS[guess.data.service].parse(rawBody) as AnyBookingInput;
  } catch (err) {
    if (err instanceof ZodError) {
      throw AppError.validation(err.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })));
    }
    throw err;
  }

  const organization = await getPublicOrganization();
  const serviceId = await resolveServiceId(organization.id, input.service);
  await assertValidConcernSelection(serviceId, input);
  const settings = await getOrgSettings(organization.id);

  const result = await createAppointmentBooking({
    organization,
    serviceId,
    providerId: input.providerId,
    packageId: input.packageId,
    startsAt: new Date(input.startsAt),
    customer: {
      firstName: input.personal.firstName,
      lastName: input.personal.lastName ?? null,
      email: input.personal.email,
      phone: input.personal.phone,
      dateOfBirth: input.personal.dateOfBirth ?? null,
      gender: input.personal.gender,
      city: input.location.city,
      province: input.location.province ?? null,
    },
    formData: input.details,
    formVersion: 1,
    termsUrl: settings.termsUrl,
    termsAcceptedAt: new Date(),
    source: "ONLINE",
    online: true,
    idempotencyKey,
    createdById: null,
    receiptFileId: input.receiptFileId ?? null,
  });

  return {
    bookingNumber: result.bookingNumber,
    status: result.status,
    paymentStatus: result.paymentStatus,
    amount: result.amount,
    currency: result.currency,
    appointment: result.appointment,
    paymentInstructions: paymentInstructionsOf(settings),
    support: { email: settings.supportEmail, phone: settings.supportPhone, whatsapp: settings.whatsappNumber },
  };
}
