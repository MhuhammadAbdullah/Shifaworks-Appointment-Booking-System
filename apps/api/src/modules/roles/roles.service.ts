import {
  ROLE_KEYS,
  isPermissionKey,
  type CreateRoleInput,
  type PermissionInfo,
  type PermissionKey,
  type RoleSummary,
  type UpdateRoleInput,
} from "@booking/shared";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { invalidateAllPrincipals, type Principal } from "../auth/principal.service.js";
import { ungrantablePermissions } from "../auth/permission-rules.js";

const roleSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  isSystem: true,
  organizationId: true,
  rolePermissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { userRoles: true } },
} as const;

type RoleRow = Awaited<ReturnType<typeof findRole>>;
function findRole(db: DbClient, id: string) {
  return db.role.findUnique({ where: { id }, select: roleSelect });
}

function toSummary(r: NonNullable<RoleRow>): RoleSummary {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: r.rolePermissions.map((rp) => rp.permission.key).filter(isPermissionKey).sort(),
    userCount: r._count.userRoles,
  };
}

/** Roles visible to an organization: system roles + its own custom roles. */
export function visibleRolesWhere(organizationId: string) {
  return { OR: [{ organizationId: null }, { organizationId }] };
}

export async function listRoles(principal: Principal): Promise<RoleSummary[]> {
  const rows = await prisma.role.findMany({
    where: visibleRolesWhere(principal.organizationId),
    select: roleSelect,
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  const order = new Map<string, number>(ROLE_KEYS.map((k, i) => [k, i]));
  return rows
    .map(toSummary)
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99) || a.name.localeCompare(b.name));
}

export async function listPermissions(): Promise<PermissionInfo[]> {
  const rows = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] });
  return rows
    .filter((p) => isPermissionKey(p.key))
    .map((p) => ({ id: p.id, key: p.key as PermissionKey, module: p.module, description: p.description }));
}

async function resolvePermissionIds(db: DbClient, keys: string[]): Promise<string[]> {
  const unique = [...new Set(keys)];
  const unknown = unique.filter((k) => !isPermissionKey(k));
  if (unknown.length) {
    throw AppError.validation(unknown.map((k) => ({ path: "permissions", message: `Unknown permission: ${k}` })));
  }
  const rows = await db.permission.findMany({ where: { key: { in: unique } }, select: { id: true } });
  if (rows.length !== unique.length) throw AppError.badRequest("Some permissions are not installed; run the seed");
  return rows.map((r) => r.id);
}

function assertCanGrant(principal: Principal, keys: string[]): void {
  const denied = ungrantablePermissions(principal, keys);
  if (denied.length) {
    throw AppError.forbidden(`You cannot grant permissions you do not hold: ${denied.join(", ")}`);
  }
}

export async function createRole(principal: Principal, input: CreateRoleInput, ctx: AuditContext) {
  if ((ROLE_KEYS as readonly string[]).includes(input.key)) {
    throw AppError.conflict("This key is reserved for a system role");
  }
  assertCanGrant(principal, input.permissions);

  const role = await prisma.$transaction(async (tx) => {
    const exists = await tx.role.findFirst({
      where: { organizationId: principal.organizationId, key: input.key },
      select: { id: true },
    });
    if (exists) throw AppError.conflict("A role with this key already exists");
    const permissionIds = await resolvePermissionIds(tx, input.permissions);
    const created = await tx.role.create({
      data: {
        organizationId: principal.organizationId,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        rolePermissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: "role.create",
      entityType: "role",
      entityId: created.id,
      newValues: input,
    });
    return findRole(tx, created.id);
  });
  return toSummary(role!);
}

async function loadEditableRole(db: DbClient, principal: Principal, id: string) {
  const role = await findRole(db, id);
  if (!role || (role.organizationId !== null && role.organizationId !== principal.organizationId)) {
    throw AppError.notFound("Role");
  }
  if (role.key === "SUPER_ADMIN") throw AppError.forbidden("The Super Admin role cannot be modified");
  return role;
}

export async function updateRole(principal: Principal, id: string, input: UpdateRoleInput, ctx: AuditContext) {
  const role = await prisma.$transaction(async (tx) => {
    const before = await loadEditableRole(tx, principal, id);
    if (before.isSystem && (input.name !== undefined || input.description !== undefined)) {
      throw AppError.badRequest("System role names cannot be changed; only their permissions");
    }
    const beforeKeys = toSummary(before).permissions;

    if (input.permissions) {
      const wanted = [...new Set(input.permissions)];
      // Only permissions being ADDED need the escalation check; removing is always allowed.
      assertCanGrant(principal, wanted.filter((k) => !(beforeKeys as string[]).includes(k)));
      const permissionIds = await resolvePermissionIds(tx, wanted);
      await tx.rolePermission.deleteMany({ where: { roleId: id, permissionId: { notIn: permissionIds } } });
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        skipDuplicates: true,
      });
    }
    if (input.name !== undefined || input.description !== undefined) {
      await tx.role.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
    }
    const after = await findRole(tx, id);
    await recordAudit(tx, ctx, {
      action: "role.update",
      entityType: "role",
      entityId: id,
      oldValues: { name: before.name, description: before.description, permissions: beforeKeys },
      newValues: { name: after!.name, description: after!.description, permissions: toSummary(after!).permissions },
    });
    return after!;
  });
  invalidateAllPrincipals();
  return toSummary(role);
}

export async function deleteRole(principal: Principal, id: string, ctx: AuditContext): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const role = await loadEditableRole(tx, principal, id);
    if (role.isSystem) throw AppError.badRequest("System roles cannot be deleted");
    if (role._count.userRoles > 0) {
      throw AppError.conflict(`Role is assigned to ${role._count.userRoles} user(s); reassign them first`);
    }
    await tx.role.delete({ where: { id } });
    await recordAudit(tx, ctx, {
      action: "role.delete",
      entityType: "role",
      entityId: id,
      oldValues: toSummary(role),
    });
  });
  invalidateAllPrincipals();
}
