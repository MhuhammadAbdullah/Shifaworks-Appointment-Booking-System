"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AuditLogDto, ListAuditLogsQuery } from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { publicEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Query = Record<string, string | number | boolean | undefined>;

export const auditKeys = {
  list: (q: Partial<ListAuditLogsQuery>) => ["audit-logs", "list", q] as const,
};

export function useAuditLogs(query: Partial<ListAuditLogsQuery>) {
  return useQuery({
    queryKey: auditKeys.list(query),
    queryFn: ({ signal }) => authedRequest<AuditLogDto[]>("/audit-logs", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
  });
}

/** CSV needs a raw fetch (not the JSON-envelope apiRequest) but still carries the Bearer token. */
export async function downloadAuditLogsCsv(query: Partial<ListAuditLogsQuery>): Promise<void> {
  const { data: session } = await getSupabaseBrowserClient().auth.getSession();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const url = new URL(`/api/v1/audit-logs/export?${params.toString()}`, publicEnv.NEXT_PUBLIC_API_URL);
  const res = await fetch(url, {
    headers: session.session?.access_token ? { Authorization: `Bearer ${session.session.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not export the audit log");
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `audit-log-${query.from ?? "all"}-${query.to ?? "all"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
