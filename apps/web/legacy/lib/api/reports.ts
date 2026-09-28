"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminDashboardDto,
  AuditFacetsDto,
  AuditLogDto,
  ListAuditLogsQuery,
  ProviderDashboardDto,
  ReportDto,
  ReportType,
  SettingsDto,
  UpdateBookingSettingsInput,
  UpdateInvoiceSettingsInput,
  UpdateNotificationSettingsInput,
  UpdateOrganizationSettingsInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

// ---- dashboards -------------------------------------------------------------------

export function useAdminDashboard(enabled = true) {
  return useQuery({
    queryKey: ["dashboard", "admin"],
    queryFn: ({ signal }) => data(authedRequest<AdminDashboardDto>("/dashboard/admin", { signal })),
    refetchInterval: 120_000,
    enabled,
  });
}

export function useProviderDashboard(enabled = true) {
  return useQuery({
    queryKey: ["dashboard", "provider"],
    queryFn: ({ signal }) => data(authedRequest<ProviderDashboardDto>("/dashboard/provider", { signal })),
    enabled,
  });
}

// ---- reports ---------------------------------------------------------------------------

export function useReport(type: ReportType, q: Query, enabled = true) {
  return useQuery({
    queryKey: ["reports", type, q],
    queryFn: ({ signal }) => data(authedRequest<ReportDto>(`/reports/${type}`, { query: q, signal })),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Query string for export links (drops empty values and paging). */
export function reportQueryString(q: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "" && k !== "page" && k !== "pageSize") params.set(k, String(v));
  return params.toString();
}

// ---- audit log ---------------------------------------------------------------------------

export function useAuditLogs(q: Partial<ListAuditLogsQuery>) {
  return useQuery({
    queryKey: ["audit-logs", q],
    queryFn: ({ signal }) => authedRequest<AuditLogDto[]>("/audit-logs", { query: q as Query, signal }),
    placeholderData: keepPreviousData,
  });
}
export function useAuditFacets() {
  return useQuery({ queryKey: ["audit-logs", "facets"], queryFn: ({ signal }) => data(authedRequest<AuditFacetsDto>("/audit-logs/facets", { signal })), staleTime: 60_000 });
}

// ---- settings ------------------------------------------------------------------------------

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: ({ signal }) => data(authedRequest<SettingsDto>("/settings", { signal })) });
}

function useSettingsMutation<T>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => data(authedRequest<SettingsDto>(`/settings/${path}`, { method: "PATCH", body })),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      // Organisation name / timezone / currency travel in /auth/me.
      if (path === "organization") void qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}
export const useUpdateOrganization = () => useSettingsMutation<UpdateOrganizationSettingsInput>("organization");
export const useUpdateBookingSettings = () => useSettingsMutation<UpdateBookingSettingsInput>("booking");
export const useUpdateNotificationSettings = () => useSettingsMutation<UpdateNotificationSettingsInput>("notifications");
export const useUpdateInvoiceSettings = () => useSettingsMutation<UpdateInvoiceSettingsInput>("invoices");
