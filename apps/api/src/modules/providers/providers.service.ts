import type {
  CreateProviderInput,
  InviteProviderInput,
  ListProvidersQuery,
  ProviderDto,
  UpdateOwnProviderInput,
  UpdateProviderInput,
} from "@booking/shared";
import { logger } from "../../config/logger.js";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import type { Prisma, ProviderType } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { definedOnly } from "../../utils/serialize.js";
import { resolveSlug } from "../../utils/slug.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { ungrantablePermissions } from "../auth/permission-rules.js";
import { invalidatePrincipal, type Principal } from "../auth/principal.service.js";
import { assertPublicImage, fileUrlSelect, publicFileUrl } from "../files/files.service.js";
import { queueInviteEmail } from "../notifications/outbox.js";
import { createAuthUser, sendInvite } from "../users/users.service.js";

const providerInclude = {
  profileImage: fileUrlSelect,
  user: { select: { id: true, email: true, status: true, authUserId: true } },
  services: {
    select: { isActive: true, service: { select: { id: true, slug: true, name: true, sortOrder: true } } },
    orderBy: { service: { sortOrder: "asc" } },
  },
} as const satisfies Prisma.ProviderProfileInclude;
type ProviderRow = Prisma.ProviderProfileGetPayload<{ include: typeof providerInclude }>;

function toDto(p: ProviderRow): ProviderDto {
  return {
    id: p.id,
    providerType: p.providerType,
    slug: p.slug,
    displayName: p.displayName,
    email: p.email,
    phone: p.phone,
    gender: p.gender,
    designation: p.designation,
    bio: p.bio,
    profileImageId: p.profileImageId,
    profileImageUrl: publicFileUrl(p.profileImage),
    experienceYears: p.experienceYears,
    rating: p.rating === null ? null : p.rating.toFixed(1),
    specializations: p.specializations,
    acceptsMale: p.acceptsMale,
    acceptsFemale: p.acceptsFemale,
    timezone: p.timezone,
    calendarColor: p.calendarColor,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    services: p.services.map((s) => ({ id: s.service.id, slug: s.service.slug, name: s.service.name, linkActive: s.isActive })),
    account: p.user
      ? { userId: p.user.id, email: p.user.email, status: p.user.status, hasLogin: p.user.authUserId !== null }
      : null,
  };
}

async function loadProvider(db: DbClient, organizationId: string, id: string): Promise<ProviderRow> {
  const row = await db.providerProfile.findFirst({ where: { id, organizationId, deletedAt: null }, include: providerInclude });
  if (!row) throw AppError.notFound("Provider");
  return row;
}

async function slugTaken(db: DbClient, organizationId: string, slug: string, exceptId?: string) {
  return Boolean(
    await db.providerProfile.findFirst({
      where: { organizationId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    }),
  );
}

/**
 * Services must belong to the organisation. By default they must also be
 * offered by this provider type — skipped for provider creation, where some
 * providers genuinely practice both disciplines and need services assigned
 * across both in one go.
 */
async function assertServices(
  db: DbClient,
  organizationId: string,
  serviceIds: string[],
  providerType: ProviderType,
  opts: { skipTypeCheck?: boolean } = {},
) {
  const unique = [...new Set(serviceIds)];
  if (!unique.length) return unique;
  const services = await db.service.findMany({
    where: { id: { in: unique }, organizationId },
    select: { id: true, name: true, providerType: true },
  });
  if (services.length !== unique.length) throw AppError.validation([{ path: "serviceIds", message: "Service not found" }]);
  if (!opts.skipTypeCheck) {
    const incompatible = services.filter((s) => s.providerType && s.providerType !== providerType);
    if (incompatible.length) {
      throw AppError.validation([
        {
          path: "serviceIds",
          message: `Not offered by ${providerType.toLowerCase()}s: ${incompatible.map((s) => s.name).join(", ")}`,
        },
      ]);
    }
  }
  return unique;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listProviders(principal: Principal, q: ListProvidersQuery) {
  const where: Prisma.ProviderProfileWhereInput = {
    organizationId: principal.organizationId,
    deletedAt: null,
    ...(q.type ? { providerType: q.type } : {}),
    ...(q.active !== undefined ? { isActive: q.active } : {}),
    ...(q.serviceId ? { services: { some: { serviceId: q.serviceId, isActive: true } } } : {}),
    // Gender matching is decided here, never in the browser.
    ...(q.gender === "MALE" ? { acceptsMale: true } : q.gender === "FEMALE" ? { acceptsFemale: true } : {}),
    ...(q.search
      ? {
          OR: [
            { displayName: { contains: q.search, mode: "insensitive" } },
            { designation: { contains: q.search, mode: "insensitive" } },
            { email: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.providerProfile.count({ where }),
    prisma.providerProfile.findMany({
      where,
      include: providerInclude,
      orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
}

export async function getProvider(principal: Principal, id: string): Promise<ProviderDto> {
  return toDto(await loadProvider(prisma, principal.organizationId, id));
}

export async function getOwnProvider(principal: Principal): Promise<ProviderDto> {
  if (!principal.providerProfileId) throw AppError.notFound("Provider profile");
  return getProvider(principal, principal.providerProfileId);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createProvider(principal: Principal, input: CreateProviderInput, ctx: AuditContext): Promise<ProviderDto> {
  const orgId = principal.organizationId;
  const row = await prisma.$transaction(async (tx) => {
    await assertPublicImage(tx, orgId, input.profileImageId, "profileImageId");
    const serviceIds = await assertServices(tx, orgId, input.serviceIds ?? [], input.providerType, { skipTypeCheck: true });
    const slug = await resolveSlug(input.slug, input.displayName, (s) => slugTaken(tx, orgId, s));
    const { serviceIds: _s, slug: _slug, ...fields } = input;
    const created = await tx.providerProfile.create({
      data: {
        ...definedOnly(fields),
        organizationId: orgId,
        providerType: input.providerType,
        displayName: input.displayName,
        gender: input.gender,
        slug,
        services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });
    await recordAudit(tx, ctx, { action: "provider.create", entityType: "provider", entityId: created.id, newValues: input });
    return loadProvider(tx, orgId, created.id);
  });
  return toDto(row);
}

async function applyUpdate(principal: Principal, id: string, input: UpdateProviderInput, ctx: AuditContext, action: string) {
  const orgId = principal.organizationId;
  const row = await prisma.$transaction(async (tx) => {
    const before = await loadProvider(tx, orgId, id);
    if (input.slug && input.slug !== before.slug && (await slugTaken(tx, orgId, input.slug, id))) {
      throw AppError.conflict(`The address "${input.slug}" is already in use`);
    }
    if (input.profileImageId !== undefined) await assertPublicImage(tx, orgId, input.profileImageId, "profileImageId");
    const acceptsMale = input.acceptsMale ?? before.acceptsMale;
    const acceptsFemale = input.acceptsFemale ?? before.acceptsFemale;
    if (!acceptsMale && !acceptsFemale) {
      throw AppError.validation([{ path: "acceptsFemale", message: "Accept at least one gender" }]);
    }
    await tx.providerProfile.update({ where: { id }, data: definedOnly(input) });
    await recordAudit(tx, ctx, { action, entityType: "provider", entityId: id, oldValues: toDto(before), newValues: input });
    return loadProvider(tx, orgId, id);
  });
  // The cached Principal mirrors the profile photo (top-right avatar) — drop it so a photo change shows up right away.
  if (row.user) invalidatePrincipal(row.user.id);
  return toDto(row);
}

export function updateProvider(principal: Principal, id: string, input: UpdateProviderInput, ctx: AuditContext) {
  return applyUpdate(principal, id, input, ctx, "provider.update");
}

/** Self-service: the schema limits a provider to their public card fields. */
export function updateOwnProvider(principal: Principal, input: UpdateOwnProviderInput, ctx: AuditContext) {
  if (!principal.providerProfileId) throw AppError.notFound("Provider profile");
  return applyUpdate(principal, principal.providerProfileId, input, ctx, "provider.self_update");
}

/** Assign services from the provider side; retained links keep their on/off state. */
export async function setProviderServices(principal: Principal, id: string, serviceIds: string[], ctx: AuditContext) {
  const orgId = principal.organizationId;
  const row = await prisma.$transaction(async (tx) => {
    const before = await loadProvider(tx, orgId, id);
    const unique = await assertServices(tx, orgId, serviceIds, before.providerType, { skipTypeCheck: true });
    await tx.serviceProvider.deleteMany({ where: { providerId: id, serviceId: { notIn: unique } } });
    await tx.serviceProvider.createMany({ data: unique.map((serviceId) => ({ providerId: id, serviceId })), skipDuplicates: true });
    await recordAudit(tx, ctx, {
      action: "provider.services.update",
      entityType: "provider",
      entityId: id,
      oldValues: { services: before.services.map((s) => s.service.slug) },
      newValues: { serviceIds: unique },
    });
    return loadProvider(tx, orgId, id);
  });
  return toDto(row);
}

/**
 * Removes the provider from every active surface (booking form, admin lists,
 * availability) immediately. With no bookings the row is hard-deleted, same
 * as before; once appointments exist it's soft-deleted instead (deletedAt
 * set, isActive cleared) since their bookings/payments/invoices point at a
 * non-nullable providerId — that history is untouched and still shows the
 * provider's name normally.
 */
export async function deleteProvider(principal: Principal, id: string, ctx: AuditContext): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await loadProvider(tx, principal.organizationId, id);
    if (before.userId) throw AppError.conflict("This provider has a dashboard login. Deactivate the account first.");
    const booked = await tx.appointment.count({ where: { providerId: id } });
    if (booked) {
      await tx.providerProfile.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    } else {
      await tx.providerProfile.delete({ where: { id } });
    }
    await recordAudit(tx, ctx, { action: "provider.delete", entityType: "provider", entityId: id, oldValues: toDto(before) });
  });
}

// ---------------------------------------------------------------------------
// Dashboard login (invite)
// ---------------------------------------------------------------------------

/**
 * Gives the provider a login to /provider. Creates an INVITED user with the
 * THERAPIST / COUNSELLOR role and links it to the profile, or links an
 * existing staff account with that email (a staff member who also treats).
 * Calling it again re-sends the invitation.
 */
export async function inviteProvider(principal: Principal, id: string, input: InviteProviderInput, ctx: AuditContext): Promise<ProviderDto> {
  const orgId = principal.organizationId;
  const provider = await loadProvider(prisma, orgId, id);
  if (provider.userId) {
    await sendInvite(principal, provider.userId, ctx);
    return getProvider(principal, id);
  }

  const email = input.email ?? provider.email;
  if (!email) throw AppError.validation([{ path: "email", message: "Enter the email the provider signs in with" }]);

  const role = await prisma.role.findFirst({
    where: { organizationId: null, key: provider.providerType },
    select: { id: true, rolePermissions: { select: { permission: { select: { key: true } } } } },
  });
  if (!role) throw new AppError("SERVICE_UNAVAILABLE", "Roles are not seeded");
  const denied = ungrantablePermissions(principal, role.rolePermissions.map((rp) => rp.permission.key));
  if (denied.length) throw AppError.forbidden("You cannot grant the provider role: it has permissions you do not hold");

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, organizationId: true, deletedAt: true, authUserId: true, providerProfile: { select: { id: true } } },
  });
  if (existing && (existing.organizationId !== orgId || existing.deletedAt)) {
    throw AppError.conflict("This email belongs to an account that cannot be linked");
  }
  if (existing?.providerProfile) throw AppError.conflict("This account is already linked to another provider");
  if (!existing && !input.password) throw AppError.validation([{ path: "password", message: "Set a password for this account" }]);

  // Create the auth user first so a failed email never leaves a half-linked
  // profile; if the transaction then fails, the Supabase user is removed again.
  const auth = existing ? null : await createAuthUser(email, input.password!, { first_name: provider.displayName, last_name: null });
  let userId = existing?.id ?? null;
  try {
    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.userRole.createMany({
          data: [{ userId: existing.id, roleId: role.id, grantedById: principal.userId }],
          skipDuplicates: true,
        });
      } else {
        const user = await tx.user.create({
          data: {
            organizationId: orgId,
            authUserId: auth!.authUserId,
            email,
            phone: provider.phone,
            firstName: provider.displayName,
            status: "INVITED",
            userRoles: { create: { roleId: role.id, grantedById: principal.userId } },
          },
          select: { id: true },
        });
        userId = user.id;
        await queueInviteEmail(tx, { templateKey: "STAFF_INVITE", userId: user.id, password: input.password! });
      }
      // Conditional link: two concurrent invites cannot both attach a login.
      const linked = await tx.providerProfile.updateMany({
        where: { id, userId: null },
        data: { userId, ...(provider.email ? {} : { email }) },
      });
      if (linked.count !== 1) throw AppError.conflict("This provider was linked to a login meanwhile");
      await recordAudit(tx, ctx, {
        action: "provider.invite",
        entityType: "provider",
        entityId: id,
        newValues: { email, userId, linkedExistingAccount: Boolean(existing) },
      });
    });
  } catch (err) {
    if (auth) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(auth.authUserId);
      if (error) logger.error({ authUserId: auth.authUserId, err: error.message }, "failed to roll back invited auth user");
    }
    throw err;
  }
  if (existing && !existing.authUserId) await sendInvite(principal, existing.id, ctx);
  if (userId) invalidatePrincipal(userId);
  return getProvider(principal, id);
}
