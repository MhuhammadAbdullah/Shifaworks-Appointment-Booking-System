/**
 * Phase 2 access control against real PostgreSQL: invite-only principal
 * resolution (no customer self-provisioning), staff account creation, role
 * assignment guards (escalation, self-management, provider roles) and custom
 * roles. Every fixture carries TAG and is removed by id afterwards.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, type PermissionKey } from "@booking/shared";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/utils/app-error.js";
import { resolvePrincipal, type Principal } from "../../src/modules/auth/principal.service.js";
import { createUser, getUser, setUserRoles, setUserStatus, updateUser } from "../../src/modules/users/users.service.js";
import { createRole, deleteRole } from "../../src/modules/roles/roles.service.js";
import { ids } from "./cleanup.js";

const TAG = `itest-${randomUUID().slice(0, 8)}`;
const ctx = { organizationId: null, userId: null, ipAddress: null, userAgent: "integration-test", requestId: TAG };
const email = (name: string) => `${TAG}-${name}@example.test`;

let org: { id: string; name: string; slug: string; timezone: string; currency: string; logoUrl: string | null };
const roleIds: Record<string, string> = {};
let actorId: string;
const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];

function principal(permissions: readonly PermissionKey[], over: Partial<Principal> = {}): Principal {
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
    staffProfileId: null,
    providerProfileId: null,
    providerType: null,
    ...over,
  };
}
const admin = () => principal(ALL_PERMISSIONS.filter((p) => p !== "roles.manage"));

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
}

async function makeUser(opts: { roles?: string[]; status?: "ACTIVE" | "SUSPENDED"; withLogin?: boolean }) {
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      authUserId: opts.withLogin === false ? null : randomUUID(),
      email: email(randomUUID().slice(0, 6)),
      firstName: TAG,
      status: opts.status ?? "ACTIVE",
      userRoles: { create: (opts.roles ?? []).map((k) => ({ roleId: roleIds[k]! })) },
    },
  });
  createdUserIds.push(user.id);
  return user;
}

const token = (sub: string) => ({ sub, email: null, sessionId: null, payload: {} });

beforeAll(async () => {
  const o = await prisma.organization.findUniqueOrThrow({
    where: { slug: process.env.DEFAULT_ORGANIZATION_SLUG ?? "default" },
  });
  org = { id: o.id, name: o.name, slug: o.slug, timezone: o.timezone, currency: o.currency, logoUrl: null };
  const roles = await prisma.role.findMany({ where: { organizationId: null } });
  for (const r of roles) roleIds[r.key] = r.id;
  actorId = (await makeUser({ roles: ["ADMIN"] })).id;
});

afterAll(async () => {
  // Let the fire-and-forget lastLoginAt updates from resolvePrincipal settle.
  await new Promise((r) => setTimeout(r, 300));
  if (createdRoleIds.length) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  if (createdUserIds.length) {
    await prisma.staffProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (ids(TAG)) await prisma.auditLog.deleteMany({ where: { requestId: TAG } });
  await prisma.$disconnect();
});

describe("principal resolution (invite-only)", () => {
  it("resolves an invited staff user and activates nothing else", async () => {
    const u = await makeUser({ roles: ["RECEPTIONIST"] });
    const p = await resolvePrincipal(token(u.authUserId!));
    expect(p.userId).toBe(u.id);
    expect(p.roleKeys).toEqual(["RECEPTIONIST"]);
    expect(p.permissions.has("bookings.view")).toBe(true);
    expect(p.permissions.has("settings.manage")).toBe(false);
    expect(p).not.toHaveProperty("customerProfileId");
  });

  it("rejects suspended accounts and accounts without a role", async () => {
    const suspended = await makeUser({ roles: ["ADMIN"], status: "SUSPENDED" });
    expect(await errorCode(resolvePrincipal(token(suspended.authUserId!)))).toBe("FORBIDDEN");
    const roleless = await makeUser({ roles: [] });
    expect(await errorCode(resolvePrincipal(token(roleless.authUserId!)))).toBe("FORBIDDEN");
  });

  it("never creates an account for an unknown sign-in (no customer provisioning)", async () => {
    const before = await prisma.user.count();
    const code = await errorCode(resolvePrincipal(token(randomUUID())));
    expect(["UNAUTHENTICATED", "FORBIDDEN"]).toContain(code);
    expect(await prisma.user.count()).toBe(before);
  });
});

describe("staff accounts", () => {
  it("creates a staff account with a staff profile (no invite email in tests)", async () => {
    const u = await createUser(
      admin(),
      {
        firstName: "Test",
        lastName: TAG,
        email: email("create"),
        roleIds: [roleIds.RECEPTIONIST!],
        sendInvite: false,
        department: "Front desk",
      },
      ctx,
    );
    createdUserIds.push(u.id);
    expect(u.status).toBe("INVITED");
    expect(u.hasLogin).toBe(false);
    expect(u.staffProfile?.department).toBe("Front desk");
    expect(u.roles.map((r) => r.key)).toEqual(["RECEPTIONIST"]);

    const updated = await updateUser(admin(), u.id, { jobTitle: "Receptionist", phone: "03001234567" }, ctx);
    expect(updated.staffProfile?.jobTitle).toBe("Receptionist");
    expect(updated.phone).toBe("03001234567");
  });

  it("refuses provider-only accounts here (they come from provider profiles)", async () => {
    const code = await errorCode(
      createUser(
        admin(),
        { firstName: "T", email: email("provider"), roleIds: [roleIds.THERAPIST!], sendInvite: false },
        ctx,
      ),
    );
    expect(code).toBe("BAD_REQUEST");
    expect(await prisma.user.count({ where: { email: email("provider") } })).toBe(0);
  });

  it("refuses duplicate emails", async () => {
    const existing = await makeUser({ roles: ["RECEPTIONIST"] });
    const code = await errorCode(
      createUser(admin(), { firstName: "T", email: existing.email!, roleIds: [roleIds.RECEPTIONIST!], sendInvite: false }, ctx),
    );
    expect(code).toBe("CONFLICT");
  });

  it("needs staff.view to read accounts", async () => {
    const u = await makeUser({ roles: ["RECEPTIONIST"] });
    expect(await errorCode(getUser(principal(["bookings.view"]), u.id))).toBe("FORBIDDEN");
    expect((await getUser(admin(), u.id)).id).toBe(u.id);
  });
});

describe("role assignment guards", () => {
  it("blocks assigning a role that grants permissions the actor lacks (escalation)", async () => {
    const target = await makeUser({ roles: ["RECEPTIONIST"] });
    const limited = principal(["staff.view", "staff.update", "bookings.view"]);
    expect(await errorCode(setUserRoles(limited, target.id, { roleIds: [roleIds.ADMIN!] }, ctx))).toBe("FORBIDDEN");
  });

  it("only a super admin assigns SUPER_ADMIN", async () => {
    const target = await makeUser({ roles: ["RECEPTIONIST"] });
    const code = await errorCode(
      setUserRoles(admin(), target.id, { roleIds: [roleIds.RECEPTIONIST!, roleIds.SUPER_ADMIN!] }, ctx),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("forbids managing your own roles and status", async () => {
    expect(await errorCode(setUserRoles(admin(), actorId, { roleIds: [roleIds.MANAGER!] }, ctx))).toBe("FORBIDDEN");
    expect(await errorCode(setUserStatus(admin(), actorId, { status: "SUSPENDED" }, ctx))).toBe("FORBIDDEN");
  });

  it("keeps at least one role", async () => {
    const target = await makeUser({ roles: ["RECEPTIONIST"] });
    expect(await errorCode(setUserRoles(admin(), target.id, { roleIds: [] }, ctx))).toBe("BAD_REQUEST");
    const after = await getUser(admin(), target.id);
    expect(after.roles.map((r) => r.key)).toEqual(["RECEPTIONIST"]);
  });

  it("changes roles and creates the staff profile when a staff role is added", async () => {
    const target = await makeUser({ roles: ["THERAPIST"] });
    const after = await setUserRoles(admin(), target.id, { roleIds: [roleIds.THERAPIST!, roleIds.RECEPTIONIST!] }, ctx);
    expect(after.roles.map((r) => r.key).sort()).toEqual(["RECEPTIONIST", "THERAPIST"]);
    expect(after.staffProfile).not.toBeNull();
  });

  it("suspends and reactivates an account without a login (no Supabase call needed)", async () => {
    const target = await makeUser({ roles: ["RECEPTIONIST"], withLogin: false });
    expect((await setUserStatus(admin(), target.id, { status: "SUSPENDED" }, ctx)).status).toBe("SUSPENDED");
    expect(await errorCode(setUserStatus(principal(["staff.update"]), target.id, { status: "DEACTIVATED" }, ctx))).toBe(
      "FORBIDDEN",
    );
    expect((await setUserStatus(admin(), target.id, { status: "ACTIVE" }, ctx)).status).toBe("ACTIVE");
  });
});

describe("custom roles", () => {
  it("creates a role only with permissions the actor holds, and deletes it", async () => {
    const key = `ITEST_${TAG.slice(6).toUpperCase()}`;
    const limited = principal(["roles.manage", "bookings.view"]);
    expect(
      await errorCode(createRole(limited, { key, name: "Test role", permissions: ["bookings.view", "settings.manage"] }, ctx)),
    ).toBe("FORBIDDEN");
    const role = await createRole(limited, { key, name: "Test role", permissions: ["bookings.view"] }, ctx);
    createdRoleIds.push(role.id);
    expect(role.permissions).toEqual(["bookings.view"]);
    await deleteRole(limited, role.id, ctx);
    expect(await prisma.role.count({ where: { id: role.id } })).toBe(0);
  });

  it("refuses system role keys", async () => {
    const code = await errorCode(createRole(principal(["roles.manage"]), { key: "ADMIN", name: "Admin 2", permissions: [] }, ctx));
    expect(code).toBe("CONFLICT");
  });
});
