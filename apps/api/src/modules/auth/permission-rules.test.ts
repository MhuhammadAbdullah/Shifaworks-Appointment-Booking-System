import { describe, expect, it } from "vitest";
import { homeAreaFor, type PermissionKey } from "@booking/shared";
import { computeEffectivePermissions, hasPermission, ungrantablePermissions } from "./permission-rules.js";

describe("computeEffectivePermissions", () => {
  it("unions permissions across roles", () => {
    const set = computeEffectivePermissions(["bookings.view", "services.view", "bookings.view"], []);
    expect([...set].sort()).toEqual(["bookings.view", "services.view"]);
  });

  it("adds user grants and lets explicit denies win over role grants", () => {
    const set = computeEffectivePermissions(
      ["bookings.view", "bookings.cancel"],
      [
        { key: "finance.view", granted: true },
        { key: "bookings.cancel", granted: false },
      ],
    );
    expect(set.has("finance.view")).toBe(true);
    expect(set.has("bookings.cancel")).toBe(false);
    expect(set.has("bookings.view")).toBe(true);
  });

  it("a deny wins even when the same key is also granted as an override", () => {
    const set = computeEffectivePermissions([], [
      { key: "finance.view", granted: false },
      { key: "finance.view", granted: true },
    ]);
    expect(set.has("finance.view")).toBe(false);
  });

  it("drops unknown permission keys", () => {
    const set = computeEffectivePermissions(["legacy.removed", "services.view"], [{ key: "bogus.key", granted: true }]);
    expect([...set]).toEqual(["services.view"]);
  });
});

describe("ungrantablePermissions (escalation guard)", () => {
  const manager = { isSuperAdmin: false, permissions: new Set<PermissionKey>(["services.view", "services.update"]) };

  it("allows granting permissions the actor holds", () => {
    expect(ungrantablePermissions(manager, ["services.view"])).toEqual([]);
  });

  it("reports permissions the actor does not hold", () => {
    expect(ungrantablePermissions(manager, ["services.view", "settings.manage"])).toEqual(["settings.manage"]);
  });

  it("treats unknown keys as ungrantable", () => {
    expect(ungrantablePermissions(manager, ["root.everything"])).toEqual(["root.everything"]);
  });

  it("super admin can grant anything", () => {
    expect(ungrantablePermissions({ isSuperAdmin: true, permissions: new Set() }, ["settings.manage"])).toEqual([]);
  });
});

describe("hasPermission", () => {
  it("is false without a principal and true for super admins", () => {
    expect(hasPermission(undefined, "services.view")).toBe(false);
    expect(hasPermission({ isSuperAdmin: true, permissions: new Set() }, "settings.manage")).toBe(true);
  });
});

describe("homeAreaFor", () => {
  it("routes staff to admin, linked providers to provider, anyone else nowhere", () => {
    expect(homeAreaFor({ roles: ["RECEPTIONIST"], isSuperAdmin: false, providerProfileId: null })).toBe("admin");
    expect(homeAreaFor({ roles: ["THERAPIST"], isSuperAdmin: false, providerProfileId: "p1" })).toBe("provider");
    expect(homeAreaFor({ roles: ["COUNSELLOR"], isSuperAdmin: false, providerProfileId: null })).toBeNull();
    expect(homeAreaFor({ roles: [], isSuperAdmin: false, providerProfileId: null })).toBeNull();
    expect(homeAreaFor({ roles: [], isSuperAdmin: true, providerProfileId: null })).toBe("admin");
    expect(homeAreaFor({ roles: ["THERAPIST", "MANAGER"], isSuperAdmin: false, providerProfileId: "p1" })).toBe("admin");
  });
});
