import type { PermissionKey, ProviderType, UserStatus } from "@booking/shared";
import { logger } from "../../config/logger.js";
import { prisma } from "../../lib/prisma.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import { AppError } from "../../utils/app-error.js";
import { fileUrlSelect, publicFileUrl } from "../files/files.service.js";
import { computeEffectivePermissions } from "./permission-rules.js";
import type { VerifiedToken } from "./token-verifier.js";

export interface Principal {
  userId: string;
  authUserId: string;
  organizationId: string;
  organization: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  status: UserStatus;
  locale: string | null;
  timezone: string | null;
  roles: { id: string; key: string }[];
  roleKeys: string[];
  permissions: ReadonlySet<PermissionKey>;
  isSuperAdmin: boolean;
  staffProfileId: string | null;
  providerProfileId: string | null;
  providerType: ProviderType | null;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
// Per-process TTL cache keyed by authUserId. Role/permission/status changes
// call invalidate*, so the acting instance sees them immediately; other
// instances converge within CACHE_TTL_MS. Keep the TTL short.

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 5_000;
const cache = new Map<string, { principal: Principal; expiresAt: number }>();

function cacheGet(authUserId: string): Principal | undefined {
  const hit = cache.get(authUserId);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(authUserId);
    return undefined;
  }
  return hit.principal;
}

function cacheSet(p: Principal): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(p.authUserId, { principal: p, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidatePrincipal(userId: string): void {
  for (const [key, value] of cache) if (value.principal.userId === userId) cache.delete(key);
}

export function invalidateAllPrincipals(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const principalInclude = {
  organization: { select: { id: true, name: true, slug: true, timezone: true, currency: true, logo: fileUrlSelect } },
  userRoles: {
    select: {
      role: {
        select: {
          id: true,
          key: true,
          rolePermissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  },
  userPermissions: { select: { granted: true, permission: { select: { key: true } } } },
  staffProfile: { select: { id: true } },
  providerProfile: { select: { id: true, providerType: true } },
} as const;

async function findUserByAuthId(authUserId: string) {
  return prisma.user.findUnique({ where: { authUserId }, include: principalInclude });
}
type LoadedUser = NonNullable<Awaited<ReturnType<typeof findUserByAuthId>>>;

function toPrincipal(u: LoadedUser): Principal {
  const roles = u.userRoles.map((ur) => ({ id: ur.role.id, key: ur.role.key }));
  const roleKeys = roles.map((r) => r.key);
  const permissions = computeEffectivePermissions(
    u.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)),
    u.userPermissions.map((up) => ({ key: up.permission.key, granted: up.granted })),
  );
  return {
    userId: u.id,
    authUserId: u.authUserId!,
    organizationId: u.organizationId,
    organization: {
      id: u.organization.id,
      name: u.organization.name,
      slug: u.organization.slug,
      timezone: u.organization.timezone,
      currency: u.organization.currency,
      logoUrl: publicFileUrl(u.organization.logo),
    },
    email: u.email,
    phone: u.phone,
    firstName: u.firstName,
    lastName: u.lastName,
    status: u.status,
    locale: u.locale,
    timezone: u.timezone,
    roles,
    roleKeys,
    permissions,
    isSuperAdmin: roleKeys.includes("SUPER_ADMIN"),
    staffProfileId: u.staffProfile?.id ?? null,
    providerProfileId: u.providerProfile?.id ?? null,
    providerType: u.providerProfile?.providerType ?? null,
  };
}

function assertUsable(u: LoadedUser): void {
  if (u.deletedAt || u.status === "SUSPENDED" || u.status === "DEACTIVATED") {
    throw AppError.forbidden("This account is disabled. Please contact the practice.");
  }
}

export const NO_ACCOUNT_MESSAGE =
  "There is no ShifaWorks staff account for this email. Please ask an administrator for an invitation.";

/**
 * First sign-in of a Supabase user that has no local record yet. Accounts are
 * invite-only: an administrator creates the user (staff) or invites a provider
 * profile, and the invitation normally stores the auth id already. This links
 * a pre-created user with the same verified email (e.g. a login created in the
 * Supabase dashboard). Nobody else gets an account: there are no customer
 * logins and no self-registration.
 */
async function linkInvitedUser(token: VerifiedToken): Promise<void> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(token.sub);
  if (error || !data.user) throw AppError.unauthenticated("Account not found");
  const email = data.user.email?.toLowerCase() ?? null;
  const existing = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true, authUserId: true, deletedAt: true } })
    : null;
  if (!existing || existing.deletedAt) {
    logger.warn({ authUserId: token.sub, email }, "sign-in without a staff account");
    throw AppError.forbidden(NO_ACCOUNT_MESSAGE);
  }
  if (existing.authUserId && existing.authUserId !== token.sub) {
    logger.warn({ email, authUserId: token.sub }, "auth user email already linked to another account");
    throw AppError.forbidden("This email is linked to a different account");
  }
  if (!data.user.email_confirmed_at) {
    throw AppError.forbidden("Please verify your email address before signing in");
  }
  // Conditional update: two concurrent first requests cannot both link.
  await prisma.user.updateMany({ where: { id: existing.id, authUserId: null }, data: { authUserId: token.sub } });
  logger.info({ userId: existing.id }, "linked existing user to auth account");
}

/** Resolves the authenticated principal for a verified token. */
export async function resolvePrincipal(token: VerifiedToken): Promise<Principal> {
  const cached = cacheGet(token.sub);
  if (cached) return cached;

  let user = await findUserByAuthId(token.sub);
  if (!user) {
    await linkInvitedUser(token);
    user = await findUserByAuthId(token.sub);
    if (!user) throw AppError.forbidden(NO_ACCOUNT_MESSAGE);
  }
  assertUsable(user);
  if (user.userRoles.length === 0) {
    throw AppError.forbidden("This account has no role assigned. Please contact an administrator.");
  }

  // Invited users become active on first sign-in; track last login cheaply
  // (only on cache miss, and at most every 15 minutes).
  const staleLogin = !user.lastLoginAt || Date.now() - user.lastLoginAt.getTime() > 15 * 60_000;
  if (user.status === "INVITED" || staleLogin) {
    const activated = user.status === "INVITED";
    const userId = user.id;
    prisma.user
      .update({
        where: { id: userId },
        data: { lastLoginAt: new Date(), ...(activated ? { status: "ACTIVE" } : {}) },
      })
      .catch((err: unknown) => logger.warn({ err, userId }, "failed to update lastLoginAt"));
    if (activated) user = { ...user, status: "ACTIVE" };
  }

  const principal = toPrincipal(user);
  cacheSet(principal);
  return principal;
}
