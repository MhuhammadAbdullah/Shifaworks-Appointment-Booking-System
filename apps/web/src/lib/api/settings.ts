"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsPageDto, UpdateSettingsInput } from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { meQueryKey } from "@/lib/auth/hooks";

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const settingsKeys = {
  page: ["settings"] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.page,
    queryFn: ({ signal }) => data(authedRequest<SettingsPageDto>("/admin/settings", { signal })),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsInput) => data(authedRequest<SettingsPageDto>("/admin/settings", { method: "PATCH", body })),
    onSuccess: (page) => {
      qc.setQueryData(settingsKeys.page, page);
      void qc.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}
