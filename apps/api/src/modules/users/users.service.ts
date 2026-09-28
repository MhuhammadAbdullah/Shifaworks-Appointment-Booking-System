import {
  PROVIDER_ROLE_KEYS,
  isPermissionKey,
  type CreateUserInput,
  type ListUsersQuery,
  type PermissionKey,
  type SetUserPermissionsInput,
  type SetUserRolesInput,
  type SetUserStatusInput,
  type UpdateUserInput,
  type UserDetail,
  type UserListItem,
} from "@booking/shared";
import { randomInt } from "node:crypto";
import { logger } from "../../config/logger.js";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { dateOnly } from "../../utils/serialize.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { computeEffectivePermissions, hasPermission, ungrantablePermissions } from "../auth/permission-rules.js";
import { invalidatePrincipal, type Principal } from "../auth/principal.service.js";
import { visibleRolesWhere } from "../roles/roles.service.js";
import { queueInviteEmail } from "../notifications/outbox.js";

// Every account is staff or a provider (therapist/counsellor); customers never
// have accounts. Provider logins are linked to their provider profile by the
// providers module; this module manages staff accounts and access for both.
const PROVIDER_ROLES: string[] = [...PROVIDER_ROLE_KEYS];
const isStaffRoleKey = (key: string) => !PROVIDER_ROLES.includes(key);
const BAN_FOREVER = "876000h"; // ~100 years; Supabase has no "permanent" flag

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const listSelect = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  status: true,
  authUserId: true,
  lastLoginAt: true,
  createdAt: true,
  userRoles: { select: { role: { select: { id: true, key: true, name: true } } } },
  staffProfile: { select: { department: true, joiningDate: true } },
} as const satisfies Prisma.UserSelect;

const detailSelect = {
  ...listSelect,
  userRoles: {
    select: {
      role: {
        select: {
          id: true,
          key: true,
          name: true,
          rolePermissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  },
  userPermissions: { select: { granted: true, permission: { select: { key: true } } } },
  staffProfile: { select: { id: true, employeeCode: true, department: true, jobTitle: true, joiningDate: true } },
  providerProfile: { select: { id: true, providerType: true, displayName: true } },
} as const satisfies Prisma.UserSelect;

type ListRow = Prisma.UserGetPayload<{ select: typeof listSelect }>;
type DetailRow = Prisma.UserGetPayload<{ select: typeof detailSelect }>;

function toListItem(u: ListRow | DetailRow): UserListItem {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    firstName: u.firstName,
    lastName: u.lastName,
    status: u.status,
    roles: u.userRoles.map((ur) => ({ id: ur.role.id, key: ur.role.key, name: ur.role.name })),
    hasLogin: u.authUserId !== null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    department: u.staffProfile?.department ?? null,
    joiningDate: dateOnly(u.staffProfile?.joiningDate ?? null),
  };
}

function toDetail(u: DetailRow): UserDetail {
  const overrides = u.userPermissions
    .filter((up) => isPermissionKey(up.permission.key))
    .map((up) => ({ key: up.permission.key as PermissionKey, granted: up.granted }));
  const effective = computeEffectivePermissions(
    u.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)),
    overrides,
  );
  return {
    ...toListItem(u),
    permissionOverrides: overrides,
    effectivePermissions: [...effective].sort(),
    staffProfile: u.staffProfile ? { ...u.staffProfile, joiningDate: dateOnly(u.staffProfile.joiningDate) } : null,
    providerProfile: u.providerProfile,
  };
}

const isSuperAdminRow = (u: { userRoles: { role: { key: string } }[] }) =>
  u.userRoles.some((ur) => ur.role.key === "SUPER_ADMIN");

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

async function loadTarget(db: DbClient, principal: Principal, id: string): Promise<DetailRow> {
  const user = await db.user.findFirst({
    where: { id, organizationId: principal.organizationId, deletedAt: null },
    select: detailSelect,
  });
  if (!user) throw AppError.notFound("User");
  return user;
}

function assertCanAccess(principal: Principal, action: "view" | "update"): void {
  if (!hasPermission(principal, `staff.${action}`)) throw AppError.forbidden();
}

function assertCanManage(principal: Principal, target: DetailRow): void {
  if (target.id === principal.userId) {
    throw AppError.forbidden("You cannot change your own roles, permissions or status");
  }
  if (isSuperAdminRow(target) && !principal.isSuperAdmin) {
    throw AppError.forbidden("Only a Super Admin can manage another Super Admin");
  }
}

/** Loads roles visible to the org and applies the escalation guard. */
async function resolveAssignableRoles(db: DbClient, principal: Principal, roleIds: string[]) {
  const unique = [...new Set(roleIds)];
  const roles = await db.role.findMany({
    where: { id: { in: unique }, ...visibleRolesWhere(principal.organizationId) },
    select: {
      id: true,
      key: true,
      rolePermissions: { select: { permission: { select: { key: true } } } },
    },
  });
  if (roles.length !== unique.length) throw AppError.badRequest("One or more roles do not exist");
  for (const role of roles) {
    if (role.key === "SUPER_ADMIN" && !principal.isSuperAdmin) {
      throw AppError.forbidden("Only a Super Admin can assign the Super Admin role");
    }
    const denied = ungrantablePermissions(
      principal,
      role.rolePermissions.map((rp) => rp.permission.key),
    );
    if (denied.length) {
      throw AppError.forbidden(`You cannot assign role ${role.key}: it grants permissions you do not hold`);
    }
  }
  return roles;
}

async function countOtherSuperAdmins(db: DbClient, organizationId: string, excludeUserId: string) {
  return db.user.count({
    where: {
      organizationId,
      id: { not: excludeUserId },
      deletedAt: null,
      status: "ACTIVE",
      userRoles: { some: { role: { key: "SUPER_ADMIN" } } },
    },
  });
}

// ---------------------------------------------------------------------------
// Supabase Auth helpers
// ---------------------------------------------------------------------------

export interface AuthAccount {
  authUserId: string;
}

/**
 * Creates the Supabase auth user with an admin-set password and the email
 * pre-confirmed, so the account is immediately usable — no magic link, no
 * intermediate "authenticated but no password chosen yet" state. The caller
 * queues our own branded STAFF_INVITE email (queueInviteEmail) with the
 * credentials; Supabase never sends anything itself for admin.createUser().
 */
export async function createAuthUser(email: string, password: string, meta: Record<string, string | null>): Promise<AuthAccount> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: meta,
  });
  if (error || !data.user) {
    logger.warn({ email, err: error?.message }, "supabase createUser failed");
    if (error?.status === 422 || /already/i.test(error?.message ?? "")) {
      throw AppError.conflict("A login already exists for this email address");
    }
    throw new AppError("SERVICE_UNAVAILABLE", "Could not create the account. Please try again.");
  }
  return { authUserId: data.user.id };
}

const PASSWORD_CHARS = { lower: "abcdefghjkmnpqrstuvwxyz", upper: "ABCDEFGHJKMNPQRSTUVWXYZ", digit: "23456789" };

/** A random password meeting passwordSchema's rules, for a system-issued (re)invite — the user should change it after signing in. Ambiguous characters (0/O, 1/l/I) are excluded. */
function generateTempPassword(): string {
  const pick = (s: string) => s[randomInt(s.length)]!;
  const all = PASSWORD_CHARS.lower + PASSWORD_CHARS.upper + PASSWORD_CHARS.digit;
  const chars = [pick(PASSWORD_CHARS.lower), pick(PASSWORD_CHARS.upper), pick(PASSWORD_CHARS.digit)];
  for (let i = chars.length; i < 12; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

async function setAuthBan(authUserId: string | null, banned: boolean): Promise<void> {
  if (!authUserId) return;
  const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    ban_duration: banned ? BAN_FOREVER : "none",
  });
  if (error) {
    logger.error({ authUserId, err: error.message }, "failed to update auth ban");
    throw new AppError("SERVICE_UNAVAILABLE", "Could not update the login status. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listUsers(principal: Principal, q: ListUsersQuery) {
  assertCanAccess(principal, "view");
  const and: Prisma.UserWhereInput[] = [{ organizationId: principal.organizationId, deletedAt: null }];
  if (q.kind === "staff") and.push({ userRoles: { some: { role: { key: { notIn: PROVIDER_ROLES } } } } });
  if (q.kind === "provider") and.push({ providerProfile: { isNot: null } });
  if (q.status) and.push({ status: q.status });
  if (q.role) and.push({ userRoles: { some: { role: { key: q.role } } } });
  if (q.search) {
    const s = q.search;
    and.push({
      OR: [
        { firstName: { contains: s, mode: "insensitive" } },
        { lastName: { contains: s, mode: "insensitive" } },
        { email: { contains: s, mode: "insensitive" } },
        { phone: { contains: s.replace(/[\s-]/g, "") } },
      ],
    });
  }
  const where: Prisma.UserWhereInput = { AND: and };
  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: listSelect,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items: rows.map(toListItem), total, page: q.page, pageSize: q.pageSize };
}

export async function getUser(principal: Principal, id: string): Promise<UserDetail> {
  assertCanAccess(principal, "view");
  return toDetail(await loadTarget(prisma, principal, id));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createUser(principal: Principal, input: CreateUserInput, ctx: AuditContext): Promise<UserDetail> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw AppError.conflict("A user with this email already exists");

  const roles = await resolveAssignableRoles(prisma, principal, input.roleIds);
  const roleKeys = roles.map((r) => r.key);
  if (!roleKeys.some(isStaffRoleKey)) {
    throw AppError.badRequest(
      "Therapist and counsellor logins are created from their provider profile (Providers → Invite). Choose a staff role here.",
    );
  }

  if (input.sendInvite && !input.password) throw AppError.badRequest("Set a password for this account");

  // Create the auth user first so a failed email never leaves a half-created
  // user; if the DB transaction then fails, the Supabase user is removed again.
  const auth = input.sendInvite
    ? await createAuthUser(input.email, input.password!, { first_name: input.firstName, last_name: input.lastName ?? null })
    : null;

  try {
    const id = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: principal.organizationId,
          authUserId: auth?.authUserId ?? null,
          email: input.email,
          phone: input.phone ?? null,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          status: "INVITED",
          userRoles: { create: roles.map((r) => ({ roleId: r.id, grantedById: principal.userId })) },
        },
        select: { id: true },
      });
      await tx.staffProfile.create({
        data: {
          userId: user.id,
          organizationId: principal.organizationId,
          department: input.department ?? null,
          jobTitle: input.jobTitle ?? null,
          joiningDate: new Date(),
        },
      });
      if (auth) await queueInviteEmail(tx, { templateKey: "STAFF_INVITE", userId: user.id, password: input.password! });
      await recordAudit(tx, ctx, {
        action: "user.create",
        entityType: "user",
        entityId: user.id,
        newValues: { ...input, roles: roleKeys },
      });
      return user.id;
    });
    return getUser(principal, id);
  } catch (err) {
    if (auth) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(auth.authUserId);
      if (error) logger.error({ authUserId: auth.authUserId, err: error.message }, "failed to roll back invited auth user");
    }
    throw err;
  }
}

export async function updateUser(
  principal: Principal,
  id: string,
  input: UpdateUserInput,
  ctx: AuditContext,
): Promise<UserDetail> {
  await prisma.$transaction(async (tx) => {
    assertCanAccess(principal, "update");
    const before = await loadTarget(tx, principal, id);
    if (isSuperAdminRow(before) && !principal.isSuperAdmin && before.id !== principal.userId) {
      throw AppError.forbidden("Only a Super Admin can edit another Super Admin");
    }
    const { department, jobTitle, ...userFields } = input;
    if (Object.keys(userFields).length) {
      await tx.user.update({ where: { id }, data: userFields });
    }
    if (department !== undefined || jobTitle !== undefined) {
      if (!before.staffProfile) throw AppError.badRequest("Department and job title apply to staff only");
      await tx.staffProfile.update({
        where: { id: before.staffProfile.id },
        data: {
          ...(department !== undefined ? { department } : {}),
          ...(jobTitle !== undefined ? { jobTitle } : {}),
        },
      });
    }
    await recordAudit(tx, ctx, {
      action: "user.update",
      entityType: "user",
      entityId: id,
      oldValues: {
        firstName: before.firstName,
        lastName: before.lastName,
        phone: before.phone,
        department: before.staffProfile?.department,
        jobTitle: before.staffProfile?.jobTitle,
      },
      newValues: input,
    });
  });
  invalidatePrincipal(id);
  return getUser(principal, id);
}

export async function setUserStatus(
  principal: Principal,
  id: string,
  input: SetUserStatusInput,
  ctx: AuditContext,
): Promise<UserDetail> {
  const target = await loadTarget(prisma, principal, id);
  assertCanManage(principal, target);
  const needed: PermissionKey = input.status === "DEACTIVATED" ? "staff.delete" : "staff.update";
  if (!hasPermission(principal, needed)) throw AppError.forbidden();
  if (target.status === input.status) return toDetail(target);

  if (input.status !== "ACTIVE" && isSuperAdminRow(target)) {
    const others = await countOtherSuperAdmins(prisma, principal.organizationId, id);
    if (others === 0) throw AppError.conflict("The last active Super Admin cannot be disabled");
  }

  // Ban/unban the login first: if Supabase fails nothing changes locally.
  // Banning also makes Supabase refuse token refresh, and our principal
  // check rejects already-issued access tokens once the cache is cleared.
  await setAuthBan(target.authUserId, input.status !== "ACTIVE");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status: input.status } });
    await recordAudit(tx, ctx, {
      action: "user.status.update",
      entityType: "user",
      entityId: id,
      oldValues: { status: target.status },
      newValues: { status: input.status, reason: input.reason ?? null },
    });
  });
  invalidatePrincipal(id);
  return getUser(principal, id);
}

/** True if this user has ever performed a real operational action — the "has this account been used" signal deleteUser blocks on. */
async function hasUserActivity(userId: string): Promise<boolean> {
  const counts = await Promise.all([
    prisma.booking.count({ where: { OR: [{ createdById: userId }, { cancelledById: userId }] } }),
    prisma.appointment.count({ where: { OR: [{ cancelledById: userId }, { checkedInById: userId }] } }),
    prisma.payment.count({ where: { OR: [{ verifiedById: userId }, { rejectedById: userId }, { refundedById: userId }] } }),
    prisma.invoice.count({ where: { createdById: userId } }),
    prisma.financeTransaction.count({ where: { createdById: userId } }),
    prisma.expense.count({ where: { OR: [{ createdById: userId }, { approvedById: userId }] } }),
    prisma.file.count({ where: { uploadedById: userId } }),
  ]);
  return counts.some((c) => c > 0);
}

/**
 * Hard-deletes an account that has never done anything (no bookings, payments,
 * invoices, expenses or uploads attributed to it) — the same "block once real
 * activity exists, allow otherwise" rule this app applies to providers,
 * packages and expenses. Roles/permission overrides/staff profile cascade
 * with it; a linked provider profile just loses its login (userId → null,
 * same as after a deactivation) — delete that profile separately if it's no
 * longer wanted either.
 */
export async function deleteUser(principal: Principal, id: string, ctx: AuditContext): Promise<void> {
  if (!hasPermission(principal, "staff.delete")) throw AppError.forbidden();
  const target = await loadTarget(prisma, principal, id);
  if (target.id === principal.userId) throw AppError.forbidden("You cannot delete your own account");
  if (isSuperAdminRow(target)) {
    if (!principal.isSuperAdmin) throw AppError.forbidden("Only a Super Admin can delete another Super Admin");
    const others = await countOtherSuperAdmins(prisma, principal.organizationId, id);
    if (others === 0) throw AppError.conflict("The last active Super Admin cannot be deleted");
  }
  if (await hasUserActivity(id)) {
    throw AppError.conflict("This account has activity history (bookings, payments or similar). Deactivate it instead of deleting.");
  }

  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, ctx, { action: "user.delete", entityType: "user", entityId: id, oldValues: toDetail(target) });
    await tx.user.delete({ where: { id } });
  });
  if (target.authUserId) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(target.authUserId);
    if (error) logger.error({ authUserId: target.authUserId, err: error.message }, "failed to delete auth user after account delete");
  }
  invalidatePrincipal(id);
}

export async function setUserRoles(
  principal: Principal,
  id: string,
  input: SetUserRolesInput,
  ctx: AuditContext,
): Promise<UserDetail> {
  await prisma.$transaction(async (tx) => {
    const target = await loadTarget(tx, principal, id);
    assertCanManage(principal, target);
    assertCanAccess(principal, "update");

    const currentIds = target.userRoles.map((ur) => ur.role.id);
    const wanted = [...new Set(input.roleIds)];
    const added = wanted.filter((r) => !currentIds.includes(r));
    const removed = target.userRoles.filter((ur) => !wanted.includes(ur.role.id)).map((ur) => ur.role);

    // Escalation guard applies to added roles; removing a role the actor
    // could not have granted is also blocked (e.g. admin removing SUPER_ADMIN).
    const addedRoles = await resolveAssignableRoles(tx, principal, added);
    await resolveAssignableRoles(tx, principal, removed.map((r) => r.id));

    if (removed.some((r) => r.key === "SUPER_ADMIN")) {
      const others = await countOtherSuperAdmins(tx, principal.organizationId, id);
      if (others === 0) throw AppError.conflict("The last active Super Admin cannot be demoted");
    }
    if (removed.length) {
      await tx.userRole.deleteMany({ where: { userId: id, roleId: { in: removed.map((r) => r.id) } } });
    }
    if (addedRoles.length) {
      await tx.userRole.createMany({
        data: addedRoles.map((r) => ({ userId: id, roleId: r.id, grantedById: principal.userId })),
        skipDuplicates: true,
      });
    }
    if (wanted.length === 0) {
      throw AppError.badRequest("Keep at least one role; suspend or deactivate the account to remove access");
    }
    if (!target.staffProfile && addedRoles.some((r) => isStaffRoleKey(r.key))) {
      await tx.staffProfile.create({
        data: { userId: id, organizationId: principal.organizationId, joiningDate: new Date() },
      });
    }
    await recordAudit(tx, ctx, {
      action: "user.roles.update",
      entityType: "user",
      entityId: id,
      oldValues: { roles: target.userRoles.map((ur) => ur.role.key) },
      newValues: {
        added: addedRoles.map((r) => r.key),
        removed: removed.map((r) => r.key),
      },
    });
  });
  invalidatePrincipal(id);
  return getUser(principal, id);
}

export async function setUserPermissions(
  principal: Principal,
  id: string,
  input: SetUserPermissionsInput,
  ctx: AuditContext,
): Promise<UserDetail> {
  const unknown = input.overrides.filter((o) => !isPermissionKey(o.key));
  if (unknown.length) {
    throw AppError.validation(unknown.map((o) => ({ path: "overrides", message: `Unknown permission: ${o.key}` })));
  }
  const byKey = new Map(input.overrides.map((o) => [o.key, o.granted]));

  await prisma.$transaction(async (tx) => {
    const target = await loadTarget(tx, principal, id);
    assertCanManage(principal, target);
    // Only grants can escalate; denies merely restrict.
    const grants = [...byKey].filter(([, granted]) => granted).map(([key]) => key);
    const denied = ungrantablePermissions(principal, grants);
    if (denied.length) {
      throw AppError.forbidden(`You cannot grant permissions you do not hold: ${denied.join(", ")}`);
    }
    const permissions = await tx.permission.findMany({
      where: { key: { in: [...byKey.keys()] } },
      select: { id: true, key: true },
    });
    await tx.userPermission.deleteMany({ where: { userId: id } });
    if (permissions.length) {
      await tx.userPermission.createMany({
        data: permissions.map((p) => ({ userId: id, permissionId: p.id, granted: byKey.get(p.key)! })),
      });
    }
    await recordAudit(tx, ctx, {
      action: "user.permissions.update",
      entityType: "user",
      entityId: id,
      oldValues: {
        overrides: target.userPermissions.map((up) => ({ key: up.permission.key, granted: up.granted })),
      },
      newValues: { overrides: input.overrides },
    });
  });
  invalidatePrincipal(id);
  return getUser(principal, id);
}

/** (Re)sends the login credentials: a fresh system-generated password, emailed directly — never a magic link the user could follow into the dashboard without ever entering one. */
export async function sendInvite(principal: Principal, id: string, ctx: AuditContext): Promise<UserDetail> {
  assertCanAccess(principal, "update");
  const target = await loadTarget(prisma, principal, id);
  if (!target.email) throw AppError.badRequest("This user has no email address");
  if (target.status === "SUSPENDED" || target.status === "DEACTIVATED") {
    throw AppError.badRequest("Re-activate the user before sending an invitation");
  }

  const password = generateTempPassword();
  let authUserId = target.authUserId;
  if (authUserId) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, { password });
    if (error) {
      logger.error({ authUserId, err: error.message }, "failed to reset password for invite resend");
      throw new AppError("SERVICE_UNAVAILABLE", "Could not reset the password. Please try again.");
    }
  } else {
    authUserId = (await createAuthUser(target.email, password, { first_name: target.firstName, last_name: target.lastName })).authUserId;
  }
  await prisma.$transaction(async (tx) => {
    if (authUserId !== target.authUserId) await tx.user.update({ where: { id }, data: { authUserId } });
    await queueInviteEmail(tx, { templateKey: "STAFF_INVITE", userId: id, password });
  });
  await recordAudit(prisma, ctx, { action: "user.invite", entityType: "user", entityId: id });
  return getUser(principal, id);
}
