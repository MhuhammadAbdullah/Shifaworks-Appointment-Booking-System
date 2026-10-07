/**
 * Email templates: a fixed set (one row per key × audience, seeded from
 * DEFAULT_TEMPLATES). Staff edit wording, subject and active flag — there is
 * no create/delete, same as the five services.
 */
import { SAMPLE_TEMPLATE_VALUES, type EmailTemplateDto, type EmailTemplateKey, type PreviewTemplateInput, type TemplatePreviewDto, type UpdateTemplateInput } from "@booking/shared";
import { prisma, type DbClient } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.service.js";
import { DEFAULT_TEMPLATES } from "./default-templates.js";
import { emailLayout, htmlToText, renderTemplate, validateTemplate } from "./render.js";
import { settingsTemplateVars } from "./context.js";

function toDto(t: { id: string; key: string; audience: string; name: string; subject: string; bodyHtml: string; isActive: boolean; updatedAt: Date }): EmailTemplateDto {
  return {
    id: t.id,
    key: t.key as EmailTemplateKey,
    audience: t.audience as EmailTemplateDto["audience"],
    name: t.name,
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    isActive: t.isActive,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function listTemplates(p: Principal): Promise<EmailTemplateDto[]> {
  const rows = await prisma.emailTemplate.findMany({ where: { organizationId: p.organizationId }, orderBy: [{ key: "asc" }, { audience: "asc" }] });
  return rows.map(toDto);
}

function assertValid(key: EmailTemplateKey, subject: string | undefined, bodyHtml: string | undefined) {
  const issues = [
    ...(bodyHtml !== undefined ? validateTemplate(bodyHtml, key).map((message) => ({ path: "bodyHtml", message })) : []),
    ...(subject !== undefined ? validateTemplate(subject, key).map((message) => ({ path: "subject", message })) : []),
  ];
  if (subject !== undefined && !subject.trim()) issues.push({ path: "subject", message: "Emails need a subject" });
  if (issues.length) throw AppError.validation(issues);
}

export async function updateTemplate(p: Principal, id: string, input: UpdateTemplateInput, ctx: AuditContext): Promise<EmailTemplateDto> {
  const t = await prisma.emailTemplate.findFirst({ where: { id, organizationId: p.organizationId } });
  if (!t) throw AppError.notFound("Template");
  assertValid(t.key as EmailTemplateKey, input.subject, input.bodyHtml);
  const row = await prisma.emailTemplate.update({ where: { id }, data: { ...input, updatedById: p.userId }, select: { id: true, key: true, audience: true, name: true, subject: true, bodyHtml: true, isActive: true, updatedAt: true } });
  await recordAudit(prisma, ctx, {
    action: "email_template.update",
    entityType: "email_template",
    entityId: id,
    oldValues: { subject: t.subject, bodyHtml: t.bodyHtml, isActive: t.isActive },
    newValues: input,
  });
  return toDto(row);
}

/**
 * Renders an unsaved template with sample values for anything booking-specific
 * (no real booking exists to preview with) but the organisation's real Settings
 * for payment/support fields, so an admin sees their own account details.
 */
export async function previewTemplate(organizationId: string, input: PreviewTemplateInput): Promise<TemplatePreviewDto> {
  const errors = [...validateTemplate(input.bodyHtml, input.key), ...validateTemplate(input.subject, input.key)];
  if (errors.length) return { subject: null, html: "", text: "", errors: [...new Set(errors)] };
  const vars = { ...SAMPLE_TEMPLATE_VALUES, ...(await settingsTemplateVars(prisma, organizationId)) };
  const subject = renderTemplate(input.subject, input.key, vars, "text");
  const fragment = renderTemplate(input.bodyHtml, input.key, vars, "html");
  return { subject, html: emailLayout(vars.orgName!, fragment), text: htmlToText(fragment), errors: [] };
}

/**
 * Creates any built-in template the organisation is missing, and refreshes
 * built-in templates nobody has edited since they were created (updatedAt ≈
 * createdAt) to the current wording. Edited templates are never touched.
 */
export async function installDefaultTemplates(db: DbClient, organizationId: string): Promise<{ created: number; refreshed: number }> {
  const created = await db.emailTemplate.createMany({
    data: DEFAULT_TEMPLATES.map((t) => ({ organizationId, key: t.key, audience: t.audience, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml })),
    skipDuplicates: true,
  });

  const existing = await db.emailTemplate.findMany({ where: { organizationId } });
  let refreshed = 0;
  for (const row of existing) {
    const neverEdited = Math.abs(row.updatedAt.getTime() - row.createdAt.getTime()) < 5_000 && !row.updatedById;
    const def = DEFAULT_TEMPLATES.find((t) => t.key === row.key && t.audience === row.audience);
    if (!neverEdited || !def) continue;
    if (row.subject === def.subject && row.bodyHtml === def.bodyHtml && row.name === def.name) continue;
    await db.emailTemplate.update({ where: { id: row.id }, data: { name: def.name, subject: def.subject, bodyHtml: def.bodyHtml } });
    refreshed++;
  }
  return { created: created.count, refreshed };
}

export async function installDefaults(p: Principal, ctx: AuditContext) {
  const r = await installDefaultTemplates(prisma, p.organizationId);
  await recordAudit(prisma, ctx, { action: "email_template.install_defaults", entityType: "email_template", newValues: r });
  return r;
}
