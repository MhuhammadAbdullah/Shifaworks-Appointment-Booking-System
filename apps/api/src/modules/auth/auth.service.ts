import type { MeResponse, UpdateMeInput } from "@booking/shared";
import { prisma } from "../../lib/prisma.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { invalidatePrincipal, type Principal } from "./principal.service.js";

export function toMeResponse(p: Principal): MeResponse {
  return {
    user: {
      id: p.userId,
      email: p.email,
      phone: p.phone,
      firstName: p.firstName,
      lastName: p.lastName,
      status: p.status,
      locale: p.locale,
      timezone: p.timezone,
    },
    organization: p.organization,
    roles: p.roleKeys,
    permissions: [...p.permissions].sort(),
    isSuperAdmin: p.isSuperAdmin,
    staffProfileId: p.staffProfileId,
    providerProfileId: p.providerProfileId,
    providerType: p.providerType,
  };
}

/**
 * Sign-out itself happens in the browser (Supabase clears the session); this
 * drops the cached principal and leaves an audit trail.
 */
export async function logout(principal: Principal, ctx: AuditContext): Promise<void> {
  invalidatePrincipal(principal.userId);
  await recordAudit(prisma, ctx, { action: "auth.logout", entityType: "user", entityId: principal.userId });
}

/** Self-service profile update. Email changes go through Supabase Auth. */
export async function updateMe(
  principal: Principal,
  input: UpdateMeInput,
  ctx: AuditContext,
): Promise<Principal> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { firstName: true, lastName: true, phone: true, locale: true, timezone: true },
    });
    const after = await tx.user.update({
      where: { id: principal.userId },
      data: input,
      select: { firstName: true, lastName: true, phone: true, locale: true, timezone: true },
    });
    await recordAudit(tx, ctx, {
      action: "user.profile.update",
      entityType: "user",
      entityId: principal.userId,
      oldValues: before,
      newValues: after,
    });
  });
  invalidatePrincipal(principal.userId);
  return { ...principal, ...input } as Principal;
}
