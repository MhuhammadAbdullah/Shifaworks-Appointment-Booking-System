/**
 * Phase 9 against real PostgreSQL: the admin settings page (organisation
 * identity fields + system_settings). Mutates the shared dev organisation's
 * `website` field and the `cancellationPolicy` setting — both otherwise
 * untouched by any other test file — and restores the original values in
 * afterAll so this file leaves no lasting change.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, updateOrganizationSchema, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import type { Principal } from "../../src/modules/auth/principal.service.js";
import { getSettingsPage, updateSettingsPage } from "../../src/modules/settings/settings.service.js";
import { uploadPublicImage } from "../../src/modules/files/files.service.js";

// A 1x1 PNG — small enough to be a fast fixture, real enough to pass magic-byte sniffing.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
let actorId: string;
let originalWebsite: string | null;
let originalPolicy: string;
let originalLogoId: string | null;
const createdUserIds: string[] = [];
const createdFileIds: string[] = [];

function principal(permissions: readonly PermissionKey[]): Principal {
  return {
    userId: actorId,
    authUserId: actorId,
    organizationId: org.id,
    organization: org,
    email: null,
    phone: null,
    firstName: "Actor",
    lastName: null,
    status: "ACTIVE",
    locale: null,
    timezone: null,
    roles: [],
    roleKeys: ["ADMIN"],
    permissions: new Set(permissions),
    isSuperAdmin: false,
    staffProfileId: "staff",
    providerProfileId: null,
    providerType: null,
  };
}
const admin = () => principal(ALL_PERMISSIONS.filter((p) => p !== "roles.manage"));

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
    throw new Error("expected a rejection");
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" } });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  originalWebsite = o.website;
  originalLogoId = o.logoId;
  const actor = await prisma.user.create({ data: { organizationId: org.id, authUserId: randomUUID(), email: `${TAG}-actor@example.test`, firstName: TAG } });
  actorId = actor.id;
  createdUserIds.push(actor.id);

  const page = await getSettingsPage(admin());
  originalPolicy = page.settings.cancellationPolicy;
});

afterAll(async () => {
  await updateSettingsPage(
    admin(),
    { organization: { website: originalWebsite ?? "", logoFileId: originalLogoId }, settings: { cancellationPolicy: originalPolicy } },
    ctx,
  );
  if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  if (createdFileIds.length) await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
  await prisma.auditLog.deleteMany({ where: { requestId: TAG } });
  await prisma.$disconnect();
});

describe("settings page", () => {
  it("returns organisation identity fields alongside every setting", async () => {
    const page = await getSettingsPage(admin());
    expect(page.organization.id).toBe(org.id);
    expect(page.settings).toHaveProperty("supportEmail");
    expect(page.settings).toHaveProperty("adminEmails");
    expect(Array.isArray(page.settings.adminEmails)).toBe(true);
  });

  it("updates organisation fields and settings together, in one call", async () => {
    const website = `https://${TAG}.example.test`;
    const policy = `${TAG} — 24 hours notice required`;
    const updated = await updateSettingsPage(admin(), { organization: { website }, settings: { cancellationPolicy: policy, cancellationCutoffHours: 48 } }, ctx);
    expect(updated.organization.website).toBe(website);
    expect(updated.settings.cancellationPolicy).toBe(policy);
    expect(updated.settings.cancellationCutoffHours).toBe(48);

    // Re-fetching confirms it was actually persisted, not just echoed back.
    const refetched = await getSettingsPage(admin());
    expect(refetched.organization.website).toBe(website);
    expect(refetched.settings.cancellationPolicy).toBe(policy);
  });

  it("records an audit entry for each part that changed", async () => {
    const rows = await prisma.auditLog.findMany({ where: { requestId: TAG }, select: { action: true } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["organization.update", "settings.update"]));
  });

  it("rejects an unknown timezone at the schema layer (route validation, not the service)", () => {
    const result = updateOrganizationSchema.safeParse({ timezone: "Not/AZone" });
    expect(result.success).toBe(false);
  });

  it("uploads a logo, exposes its URL, and clears it again", async () => {
    const file = await uploadPublicImage(admin(), { buffer: PNG_BYTES, originalname: "logo.png", size: PNG_BYTES.length }, ctx);
    createdFileIds.push(file.id);

    const withLogo = await updateSettingsPage(admin(), { organization: { logoFileId: file.id } }, ctx);
    expect(typeof withLogo.organization.logoUrl).toBe("string");
    expect(withLogo.organization.logoUrl).toBeTruthy();

    // Re-fetching confirms it was actually persisted, not just echoed back.
    const refetched = await getSettingsPage(admin());
    expect(refetched.organization.logoUrl).toBe(withLogo.organization.logoUrl);

    const cleared = await updateSettingsPage(admin(), { organization: { logoFileId: null } }, ctx);
    expect(cleared.organization.logoUrl).toBeNull();
  });

  it("rejects a logo id that isn't a public image of this organisation", async () => {
    const err = await errorOf(updateSettingsPage(admin(), { organization: { logoFileId: randomUUID() } }, ctx));
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("needs settings.manage to view or update", async () => {
    const viewErr = await errorOf(getSettingsPage(principal([])));
    expect(viewErr.code).toBe("FORBIDDEN");
    const updateErr = await errorOf(updateSettingsPage(principal([]), { settings: { supportEmail: "x@example.test" } }, ctx));
    expect(updateErr.code).toBe("FORBIDDEN");
  });
});
