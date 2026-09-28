import { env } from "../config/env.js";
import { prisma } from "./prisma.js";
import { AppError } from "../utils/app-error.js";
import { fileUrlSelect, publicFileUrl } from "../modules/files/files.service.js";

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  logoUrl: string | null;
}

let cached: { org: OrgInfo; expiresAt: number } | null = null;

/**
 * Organization served by public (unauthenticated) endpoints. The platform is
 * multi-organization ready; a single deployment currently serves the org
 * named by DEFAULT_ORGANIZATION_SLUG. Cached for 5 minutes.
 */
export async function getPublicOrganization(): Promise<OrgInfo> {
  if (cached && cached.expiresAt > Date.now()) return cached.org;
  const org = await prisma.organization.findUnique({
    where: { slug: env.DEFAULT_ORGANIZATION_SLUG },
    select: { id: true, name: true, slug: true, timezone: true, currency: true, status: true, logo: fileUrlSelect },
  });
  if (!org || org.status !== "ACTIVE") throw new AppError("SERVICE_UNAVAILABLE", "Organization is not available");
  const { status: _status, logo, ...rest } = org;
  const info: OrgInfo = { ...rest, logoUrl: publicFileUrl(logo) };
  cached = { org: info, expiresAt: Date.now() + 5 * 60_000 };
  return info;
}

/** Called after an organization update so public pages don't wait out the 5-minute cache for a name/logo change. */
export function invalidatePublicOrganization(): void {
  cached = null;
}
