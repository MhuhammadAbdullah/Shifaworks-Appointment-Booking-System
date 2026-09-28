import { isPermissionKey, type PermissionKey } from "@booking/shared";

/**
 * Effective permissions = union of role grants + user grants − user denies.
 * An explicit deny always wins. Unknown keys (e.g. a permission removed from
 * the code but still in the DB) are dropped.
 */
export function computeEffectivePermissions(
  rolePermissionKeys: Iterable<string>,
  overrides: Iterable<{ key: string; granted: boolean }>,
): Set<PermissionKey> {
  const result = new Set<PermissionKey>();
  for (const key of rolePermissionKeys) if (isPermissionKey(key)) result.add(key);
  const denies: PermissionKey[] = [];
  for (const o of overrides) {
    if (!isPermissionKey(o.key)) continue;
    if (o.granted) result.add(o.key);
    else denies.push(o.key);
  }
  for (const key of denies) result.delete(key);
  return result;
}

export interface GrantingActor {
  isSuperAdmin: boolean;
  permissions: ReadonlySet<PermissionKey>;
}

/**
 * Privilege-escalation guard: an actor may only hand out permissions they
 * hold themselves. Returns the keys the actor is NOT allowed to grant.
 */
export function ungrantablePermissions(actor: GrantingActor, keys: Iterable<string>): string[] {
  if (actor.isSuperAdmin) return [];
  const denied: string[] = [];
  for (const key of keys) {
    if (!isPermissionKey(key) || !actor.permissions.has(key)) denied.push(key);
  }
  return denied;
}

export function hasPermission(
  principal: GrantingActor | undefined,
  key: PermissionKey,
): boolean {
  if (!principal) return false;
  return principal.isSuperAdmin || principal.permissions.has(key);
}
