import type {
  ConcernOptionDto,
  CreateConcernOptionInput,
  CreatePackageInput,
  PackageDto,
  ServiceDto,
  SetServiceProvidersInput,
  UpdateConcernOptionInput,
  UpdatePackageInput,
  UpdateServiceInput,
} from "@booking/shared";
import { prisma, type DbClient } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { definedOnly, money } from "../../utils/serialize.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.service.js";

// The five services are seeded from SERVICE_DEFINITIONS and never created or
// deleted here: each slug has its own developer-defined booking form.

const serviceInclude = {
  packages: { orderBy: [{ sortOrder: "asc" }, { price: "asc" }, { name: "asc" }] },
  providers: {
    include: { provider: { select: { id: true, displayName: true, providerType: true, gender: true, isActive: true } } },
    orderBy: { provider: { sortOrder: "asc" } },
  },
  concernOptions: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] },
} as const satisfies Prisma.ServiceInclude;
type ServiceRow = Prisma.ServiceGetPayload<{ include: typeof serviceInclude }>;
type PackageRow = ServiceRow["packages"][number];
type ConcernOptionRow = ServiceRow["concernOptions"][number];

export function toPackageDto(p: PackageRow, defaultDurationMinutes: number): PackageDto {
  const discounted = p.discountEnabled && p.discountPercent ? p.price.minus(p.price.mul(p.discountPercent).div(100)) : null;
  return {
    id: p.id,
    serviceId: p.serviceId,
    name: p.name,
    description: p.description,
    points: p.points,
    durationMinutes: p.durationMinutes,
    effectiveDurationMinutes: p.durationMinutes ?? defaultDurationMinutes,
    price: money(p.price),
    discountEnabled: p.discountEnabled,
    discountPercent: p.discountPercent?.toNumber() ?? null,
    discountedPrice: money(discounted ?? p.price),
    isActive: p.isActive,
    sortOrder: p.sortOrder,
  };
}

export function toConcernOptionDto(o: ConcernOptionRow): ConcernOptionDto {
  return { id: o.id, serviceId: o.serviceId, code: o.code, label: o.label, isActive: o.isActive, sortOrder: o.sortOrder };
}

function toDto(s: ServiceRow): ServiceDto {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    isActive: s.isActive,
    bookingEnabled: s.bookingEnabled,
    open: s.isActive && s.bookingEnabled,
    deliveryModeVisible: s.deliveryModeVisible,
    providerType: s.providerType,
    defaultDurationMinutes: s.defaultDurationMinutes,
    bufferBeforeMinutes: s.bufferBeforeMinutes,
    bufferAfterMinutes: s.bufferAfterMinutes,
    slotIntervalMinutes: s.slotIntervalMinutes,
    minNoticeMinutes: s.minNoticeMinutes,
    maxAdvanceDays: s.maxAdvanceDays,
    currency: s.currency,
    sortOrder: s.sortOrder,
    packages: s.packages.map((p) => toPackageDto(p, s.defaultDurationMinutes)),
    providers: s.providers.map((sp) => ({
      id: sp.provider.id,
      displayName: sp.provider.displayName,
      providerType: sp.provider.providerType,
      gender: sp.provider.gender,
      isActive: sp.provider.isActive,
      linkActive: sp.isActive,
    })),
    concernOptions: s.concernOptions.map(toConcernOptionDto),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts the id or the slug (admin pages use /admin/services/<slug>). */
async function loadService(db: DbClient, organizationId: string, idOrSlug: string): Promise<ServiceRow> {
  const row = await db.service.findFirst({
    where: { organizationId, ...(UUID.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }) },
    include: serviceInclude,
  });
  if (!row) throw AppError.notFound("Service");
  return row;
}

export async function listServices(principal: Principal): Promise<ServiceDto[]> {
  const rows = await prisma.service.findMany({
    where: { organizationId: principal.organizationId },
    include: serviceInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toDto);
}

export async function getService(principal: Principal, idOrSlug: string): Promise<ServiceDto> {
  return toDto(await loadService(prisma, principal.organizationId, idOrSlug));
}

export async function updateService(principal: Principal, idOrSlug: string, input: UpdateServiceInput, ctx: AuditContext) {
  const row = await prisma.$transaction(async (tx) => {
    const before = await loadService(tx, principal.organizationId, idOrSlug);
    const after = await tx.service.update({ where: { id: before.id }, data: definedOnly(input), include: serviceInclude });
    const wasOpen = before.isActive && before.bookingEnabled;
    const isOpen = after.isActive && after.bookingEnabled;
    await recordAudit(tx, ctx, {
      // Opening / closing a service is called out separately in the audit log.
      action: wasOpen === isOpen ? "service.update" : isOpen ? "service.activate" : "service.deactivate",
      entityType: "service",
      entityId: before.id,
      oldValues: definedOnly(Object.fromEntries(Object.keys(input).map((k) => [k, before[k as keyof typeof before]]))),
      newValues: input,
    });
    return after;
  });
  return toDto(row);
}

// ---------------------------------------------------------------------------
// Packages (Hijama packages, counselling session types)
// ---------------------------------------------------------------------------

export async function createPackage(principal: Principal, idOrSlug: string, input: CreatePackageInput, ctx: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const service = await loadService(tx, principal.organizationId, idOrSlug);
    const row = await tx.servicePackage.create({
      data: {
        serviceId: service.id,
        name: input.name,
        description: input.description ?? null,
        points: input.points ?? null,
        durationMinutes: input.durationMinutes ?? null,
        price: input.price,
        discountEnabled: input.discountEnabled ?? false,
        discountPercent: input.discountPercent ?? null,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? service.packages.length,
      },
    });
    await recordAudit(tx, ctx, { action: "package.create", entityType: "service_package", entityId: row.id, newValues: input });
    return toPackageDto(row, service.defaultDurationMinutes);
  });
}

async function loadPackage(db: DbClient, organizationId: string, idOrSlug: string, packageId: string) {
  const service = await loadService(db, organizationId, idOrSlug);
  const pkg = service.packages.find((p) => p.id === packageId);
  if (!pkg) throw AppError.notFound("Package");
  return { service, pkg };
}

export async function updatePackage(
  principal: Principal,
  idOrSlug: string,
  packageId: string,
  input: UpdatePackageInput,
  ctx: AuditContext,
) {
  return prisma.$transaction(async (tx) => {
    const { service, pkg } = await loadPackage(tx, principal.organizationId, idOrSlug, packageId);
    const after = await tx.servicePackage.update({ where: { id: packageId }, data: definedOnly(input) });
    const priceChanged = input.price !== undefined && Number(pkg.price) !== input.price;
    await recordAudit(tx, ctx, {
      action: priceChanged ? "package.price.update" : "package.update",
      entityType: "service_package",
      entityId: packageId,
      oldValues: toPackageDto(pkg, service.defaultDurationMinutes),
      newValues: input,
    });
    return toPackageDto(after, service.defaultDurationMinutes);
  });
}

/** Packages that were ever booked are kept for history: deactivate them instead. */
export async function deletePackage(principal: Principal, idOrSlug: string, packageId: string, ctx: AuditContext) {
  await prisma.$transaction(async (tx) => {
    const { pkg } = await loadPackage(tx, principal.organizationId, idOrSlug, packageId);
    const used = await tx.appointment.count({ where: { packageId } });
    if (used) throw AppError.conflict("This option has bookings. Switch it off instead of deleting it.");
    await tx.servicePackage.delete({ where: { id: packageId } });
    await recordAudit(tx, ctx, { action: "package.delete", entityType: "service_package", entityId: packageId, oldValues: pkg });
  });
}

// ---------------------------------------------------------------------------
// Concern-checklist options ("Areas of concern" etc. — admin-managed per service)
// ---------------------------------------------------------------------------

export async function createConcernOption(principal: Principal, idOrSlug: string, input: CreateConcernOptionInput, ctx: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const service = await loadService(tx, principal.organizationId, idOrSlug);
    const clash = service.concernOptions.some((o) => o.code === input.code);
    if (clash) throw AppError.conflict(`"${input.code}" already exists for this service`);
    const row = await tx.serviceConcernOption.create({
      data: {
        serviceId: service.id,
        code: input.code,
        label: input.label,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? service.concernOptions.length,
      },
    });
    await recordAudit(tx, ctx, { action: "concern_option.create", entityType: "service_concern_option", entityId: row.id, newValues: input });
    return toConcernOptionDto(row);
  });
}

async function loadConcernOption(db: DbClient, organizationId: string, idOrSlug: string, optionId: string) {
  const service = await loadService(db, organizationId, idOrSlug);
  const option = service.concernOptions.find((o) => o.id === optionId);
  if (!option) throw AppError.notFound("Option");
  return { service, option };
}

export async function updateConcernOption(
  principal: Principal,
  idOrSlug: string,
  optionId: string,
  input: UpdateConcernOptionInput,
  ctx: AuditContext,
) {
  return prisma.$transaction(async (tx) => {
    const { service, option } = await loadConcernOption(tx, principal.organizationId, idOrSlug, optionId);
    if (input.code && input.code !== option.code && service.concernOptions.some((o) => o.code === input.code)) {
      throw AppError.conflict(`"${input.code}" already exists for this service`);
    }
    const after = await tx.serviceConcernOption.update({ where: { id: optionId }, data: definedOnly(input) });
    await recordAudit(tx, ctx, {
      action: "concern_option.update",
      entityType: "service_concern_option",
      entityId: optionId,
      oldValues: toConcernOptionDto(option),
      newValues: input,
    });
    return toConcernOptionDto(after);
  });
}

export async function deleteConcernOption(principal: Principal, idOrSlug: string, optionId: string, ctx: AuditContext) {
  await prisma.$transaction(async (tx) => {
    const { option } = await loadConcernOption(tx, principal.organizationId, idOrSlug, optionId);
    await tx.serviceConcernOption.delete({ where: { id: optionId } });
    await recordAudit(tx, ctx, { action: "concern_option.delete", entityType: "service_concern_option", entityId: optionId, oldValues: option });
  });
}

// ---------------------------------------------------------------------------
// Providers offering the service
// ---------------------------------------------------------------------------

export async function setServiceProviders(principal: Principal, idOrSlug: string, input: SetServiceProvidersInput, ctx: AuditContext) {
  const orgId = principal.organizationId;
  const row = await prisma.$transaction(async (tx) => {
    const before = await loadService(tx, orgId, idOrSlug);
    const ids = input.providers.map((p) => p.providerId);
    if (new Set(ids).size !== ids.length) throw AppError.badRequest("A provider is listed twice");
    const providers = await tx.providerProfile.findMany({
      where: { id: { in: ids }, organizationId: orgId, deletedAt: null },
      select: { id: true, displayName: true, providerType: true },
    });
    if (providers.length !== ids.length) throw AppError.validation([{ path: "providers", message: "Provider not found" }]);
    // No providerType match required: a provider may practice both disciplines.

    await tx.serviceProvider.deleteMany({ where: { serviceId: before.id, providerId: { notIn: ids } } });
    for (const p of input.providers) {
      await tx.serviceProvider.upsert({
        where: { serviceId_providerId: { serviceId: before.id, providerId: p.providerId } },
        create: { serviceId: before.id, providerId: p.providerId, isActive: p.isActive },
        update: { isActive: p.isActive },
      });
    }
    await recordAudit(tx, ctx, {
      action: "service.providers.update",
      entityType: "service",
      entityId: before.id,
      oldValues: { providers: before.providers.map((p) => ({ providerId: p.providerId, isActive: p.isActive })) },
      newValues: input,
    });
    return loadService(tx, orgId, before.id);
  });
  return toDto(row);
}
