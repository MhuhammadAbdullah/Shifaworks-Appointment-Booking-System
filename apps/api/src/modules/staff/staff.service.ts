import type { ListStaffQuery, StaffListItem, UpdateStaffProfileInput } from "@booking/shared";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { dateOnly, definedOnly, parseDateOnly } from "../../utils/serialize.js";
import { isUniqueViolation } from "../../utils/db-errors.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.service.js";

async function assertLocation(db: Prisma.TransactionClient, organizationId: string, id: string | null) {
  if (!id) return;
  const found = await db.location.count({ where: { id, organizationId } });
  if (!found) throw AppError.validation([{ path: "primaryLocationId", message: "Location not found" }]);
}

const staffInclude = {
  primaryLocation: { select: { id: true, name: true } },
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      status: true,
      userRoles: { select: { role: { select: { key: true, name: true } } } },
    },
  },
} as const satisfies Prisma.StaffProfileInclude;
type StaffRow = Prisma.StaffProfileGetPayload<{ include: typeof staffInclude }>;

function toItem(s: StaffRow): StaffListItem {
  return {
    userId: s.userId,
    staffProfileId: s.id,
    firstName: s.user.firstName,
    lastName: s.user.lastName,
    email: s.user.email,
    phone: s.user.phone,
    userStatus: s.user.status,
    roles: s.user.userRoles.map((ur) => ur.role),
    employeeCode: s.employeeCode,
    department: s.department,
    jobTitle: s.jobTitle,
    joiningDate: dateOnly(s.joiningDate),
    primaryLocation: s.primaryLocation,
    status: s.status,
  };
}

/** Staff directory: employment details for everyone with a staff profile. */
export async function listStaff(principal: Principal, q: ListStaffQuery) {
  const s = q.search;
  const where: Prisma.StaffProfileWhereInput = {
    organizationId: principal.organizationId,
    user: {
      deletedAt: null,
      ...(q.role ? { userRoles: { some: { role: { key: q.role } } } } : {}),
    },
    ...(q.department ? { department: { equals: q.department, mode: "insensitive" } } : {}),
    ...(s
      ? {
          OR: [
            { employeeCode: { contains: s, mode: "insensitive" } },
            { user: { firstName: { contains: s, mode: "insensitive" } } },
            { user: { lastName: { contains: s, mode: "insensitive" } } },
            { user: { email: { contains: s, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.staffProfile.count({ where }),
    prisma.staffProfile.findMany({
      where,
      include: staffInclude,
      orderBy: [{ user: { firstName: "asc" } }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items: rows.map(toItem), total, page: q.page, pageSize: q.pageSize };
}

export async function getStaff(principal: Principal, userId: string): Promise<StaffListItem> {
  const row = await prisma.staffProfile.findFirst({
    where: { userId, organizationId: principal.organizationId },
    include: staffInclude,
  });
  if (!row) throw AppError.notFound("Staff member");
  return toItem(row);
}

export async function updateStaffProfile(
  principal: Principal,
  userId: string,
  input: UpdateStaffProfileInput,
  ctx: AuditContext,
): Promise<StaffListItem> {
  const orgId = principal.organizationId;
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.staffProfile.findFirst({ where: { userId, organizationId: orgId } });
      if (!before) throw AppError.notFound("Staff member");
      if (input.primaryLocationId !== undefined) await assertLocation(tx, orgId, input.primaryLocationId);
      const { joiningDate, ...rest } = input;
      const data = definedOnly({
        ...rest,
        joiningDate: joiningDate === undefined ? undefined : joiningDate === null ? null : parseDateOnly(joiningDate),
      });
      await tx.staffProfile.update({ where: { id: before.id }, data });
      await recordAudit(tx, ctx, {
        action: "staff.profile.update",
        entityType: "user",
        entityId: userId,
        oldValues: before,
        newValues: input,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw AppError.validation([{ path: "employeeCode", message: "This employee code is already used" }]);
    }
    throw err;
  }
  return getStaff(principal, userId);
}
