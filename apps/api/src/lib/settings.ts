import { SETTINGS, SETTING_DEFAULTS, type OrgSettings, type SettingName } from "@booking/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type DbClient } from "./prisma.js";

/**
 * Typed view over system_settings (see SETTINGS in @booking/shared). A stored
 * value is used only if it has the default's shape; anything else falls back
 * to the default, so a bad row can never break booking.
 */
function sameShape(raw: unknown, dflt: unknown): boolean {
  if (Array.isArray(dflt)) return Array.isArray(raw) && raw.every((v) => typeof v === "string");
  return typeof raw === typeof dflt && raw !== null;
}

const cache = new Map<string, { value: OrgSettings; expiresAt: number }>();
const CACHE_MS = 60_000;

export async function getOrgSettings(organizationId: string): Promise<OrgSettings> {
  const hit = cache.get(organizationId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const byName = Object.entries(SETTINGS) as [SettingName, (typeof SETTINGS)[SettingName]][];
  const rows = await prisma.systemSetting.findMany({
    where: { organizationId, key: { in: byName.map(([, d]) => d.key) } },
    select: { key: true, value: true },
  });
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const value = { ...SETTING_DEFAULTS } as OrgSettings;
  for (const [name, d] of byName) {
    const raw = stored.get(d.key);
    if (raw !== undefined && sameShape(raw, d.default)) (value as Record<string, unknown>)[name] = raw;
  }
  cache.set(organizationId, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

/** Upserts the given settings (inside the caller's transaction) and clears the cache. */
export async function writeOrgSettings(db: DbClient, organizationId: string, patch: Partial<OrgSettings>, updatedById: string | null): Promise<void> {
  for (const [name, value] of Object.entries(patch) as [SettingName, unknown][]) {
    if (value === undefined) continue;
    const d = SETTINGS[name];
    await db.systemSetting.upsert({
      where: { organizationId_key: { organizationId, key: d.key } },
      create: { organizationId, key: d.key, value: value as Prisma.InputJsonValue, description: d.description, updatedById },
      update: { value: value as Prisma.InputJsonValue, updatedById },
    });
  }
  invalidateOrgSettings(organizationId);
}

export function invalidateOrgSettings(organizationId: string): void {
  cache.delete(organizationId);
}
