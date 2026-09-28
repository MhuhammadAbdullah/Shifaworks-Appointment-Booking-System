"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CheckInLookupDto, CheckInLookupQuery, CheckInResultDto } from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const checkinKeys = {
  lookup: (q: CheckInLookupQuery) => ["checkin", "lookup", q] as const,
};

export function useCheckInLookup(query: CheckInLookupQuery | null) {
  return useQuery({
    queryKey: checkinKeys.lookup(query ?? {}),
    queryFn: ({ signal }) => data(authedRequest<CheckInLookupDto>("/check-in/lookup", { query: query as Record<string, string>, signal })),
    enabled: query !== null,
    retry: false,
  });
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appointmentId: string) => data(authedRequest<CheckInResultDto>(`/check-in/${appointmentId}`, { method: "POST" })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["checkin"] }),
  });
}

export function useResetCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appointmentId: string) => data(authedRequest<CheckInResultDto>(`/check-in/${appointmentId}/reset`, { method: "POST" })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["checkin"] }),
  });
}
