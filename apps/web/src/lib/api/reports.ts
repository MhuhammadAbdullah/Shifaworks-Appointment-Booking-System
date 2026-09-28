"use client";

import { useQuery } from "@tanstack/react-query";
import type { BookingsReportDto, ProvidersReportDto, ReportQuery, ReportType, ServicesReportDto } from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { publicEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

type ReportDtoFor<T extends ReportType> = T extends "bookings" ? BookingsReportDto : T extends "providers" ? ProvidersReportDto : ServicesReportDto;

export const reportKeys = {
  detail: (type: ReportType, q: ReportQuery) => ["reports", type, q] as const,
};

export function useReport<T extends ReportType>(type: T, query: ReportQuery) {
  return useQuery({
    queryKey: reportKeys.detail(type, query),
    queryFn: ({ signal }) => data(authedRequest<ReportDtoFor<T>>(`/reports/${type}`, { query, signal })),
  });
}

/** CSV needs a raw fetch (not the JSON-envelope apiRequest) but still carries the Bearer token. */
export async function downloadReportCsv(type: ReportType, query: ReportQuery): Promise<void> {
  const { data: session } = await getSupabaseBrowserClient().auth.getSession();
  const params = new URLSearchParams({ from: query.from, to: query.to });
  const url = new URL(`/api/v1/reports/${type}/export?${params.toString()}`, publicEnv.NEXT_PUBLIC_API_URL);
  const res = await fetch(url, {
    headers: session.session?.access_token ? { Authorization: `Bearer ${session.session.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not export report");
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${type}-report-${query.from}-${query.to}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
