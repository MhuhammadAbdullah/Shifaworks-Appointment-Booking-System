/**
 * Admin settings page (Phase 9): the organisation's identity fields (name,
 * timezone, currency, locale, contact) plus every key in SETTINGS
 * (@booking/shared), stored as system_settings rows via lib/settings.ts.
 */
import type { OrganizationDto, SettingsPageDto, UpdateSettingsInput } from "@booking/shared";
import { prisma } from "../../lib/prisma.js";
import { getOrgSettings, writeOrgSettings } from "../../lib/settings.js";
import { AppError } from "../../utils/app-error.js";
import { definedOnly } from "../../utils/serialize.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { hasPermission } from "../auth/permission-rules.js";
import { invalidateAllPrincipals } from "../auth/principal.service.js";
import { invalidatePublicOrganization } from "../../lib/organization.js";
import type { Principal } from "../auth/principal.service.js";
import { assertPublicImage, fileUrlSelect, publicFileUrl } from "../files/files.service.js";

const orgSelect = { id: true, name: true, timezone: true, currency: true, locale: true, email: true, phone: true, website: true, logo: fileUrlSelect } as const;

function toOrgDto(o: {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  locale: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo: { bucket: string; path: string } | null;
}): OrganizationDto {
  return { id: o.id, name: o.name, timezone: o.timezone, currency: o.currency, locale: o.locale, email: o.email, phone: o.phone, website: o.website, logoUrl: publicFileUrl(o.logo) };
}

export async function getSettingsPage(p: Principal): Promise<SettingsPageDto> {
  if (!hasPermission(p, "settings.manage")) throw AppError.forbidden();
  const [org, settings] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: p.organizationId }, select: orgSelect }),
    getOrgSettings(p.organizationId),
  ]);
  return { organization: toOrgDto(org), settings };
}

export async function updateSettingsPage(p: Principal, input: UpdateSettingsInput, ctx: AuditContext): Promise<SettingsPageDto> {
  if (!hasPermission(p, "settings.manage")) throw AppError.forbidden();

  await prisma.$transaction(async (tx) => {
    if (input.organization && Object.keys(input.organization).length > 0) {
      const { logoFileId, ...rest } = input.organization;
      if (logoFileId !== undefined) await assertPublicImage(tx, p.organizationId, logoFileId, "logoFileId");
      const patch = definedOnly({ ...rest, website: rest.website === "" ? null : rest.website, ...(logoFileId !== undefined ? { logoId: logoFileId } : {}) });
      const before = await tx.organization.findUniqueOrThrow({ where: { id: p.organizationId } });
      await tx.organization.update({ where: { id: p.organizationId }, data: patch });
      await recordAudit(tx, ctx, {
        action: "organization.update",
        entityType: "organization",
        entityId: p.organizationId,
        oldValues: { name: before.name, timezone: before.timezone, currency: before.currency, locale: before.locale, email: before.email, phone: before.phone, website: before.website, logoId: before.logoId },
        newValues: input.organization,
      });
    }
    if (input.settings && Object.keys(input.settings).length > 0) {
      await writeOrgSettings(tx, p.organizationId, input.settings, p.userId);
      await recordAudit(tx, ctx, { action: "settings.update", entityType: "system_setting", newValues: input.settings });
    }
  });

  // Timezone/currency live on the cached Principal too, so a change must be visible immediately.
  invalidateAllPrincipals();
  invalidatePublicOrganization();
  return getSettingsPage(p);
}
