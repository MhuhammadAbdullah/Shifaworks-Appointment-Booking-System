"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListPaymentsQuery, MarkSubmittedInput, PaymentDto, RefundPaymentInput, RejectPaymentInput, VerifyPaymentInput } from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { ApiError } from "@/lib/api-client";
import { publicEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

/** `status` travels as a comma-separated string on the wire (multi-select) — the server parses it back into ListPaymentsQuery["status"]. */
type PaymentsListQuery = Partial<Omit<ListPaymentsQuery, "status">> & { status?: string };

export const paymentKeys = {
  list: (q: PaymentsListQuery) => ["payments", "list", q] as const,
  listAll: ["payments", "list"] as const,
  detail: (id: string) => ["payments", "detail", id] as const,
};

export function usePayments(query: PaymentsListQuery) {
  return useQuery({
    queryKey: paymentKeys.list(query),
    queryFn: ({ signal }) => authedRequest<PaymentDto[]>("/payments", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function usePayment(id: string) {
  return useQuery({
    queryKey: paymentKeys.detail(id),
    queryFn: ({ signal }) => data(authedRequest<PaymentDto>(`/payments/${id}`, { signal })),
  });
}

function usePaymentMutation<TInput>(request: (input: TInput) => Promise<PaymentDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (p) => {
      qc.setQueryData(paymentKeys.detail(p.id), p);
      void qc.invalidateQueries({ queryKey: paymentKeys.listAll });
      if (p.booking) void qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export const useMarkSubmitted = (id: string) =>
  usePaymentMutation((body: MarkSubmittedInput) => data(authedRequest<PaymentDto>(`/payments/${id}/mark-submitted`, { method: "POST", body })));

export const useVerifyPayment = (id: string) =>
  usePaymentMutation((body: VerifyPaymentInput) => data(authedRequest<PaymentDto>(`/payments/${id}/verify`, { method: "POST", body })));

export const useRejectPayment = (id: string) =>
  usePaymentMutation((body: RejectPaymentInput) => data(authedRequest<PaymentDto>(`/payments/${id}/reject`, { method: "POST", body })));

export const useRefundPayment = (id: string) =>
  usePaymentMutation((body: RefundPaymentInput) => data(authedRequest<PaymentDto>(`/payments/${id}/refund`, { method: "POST", body })));

export function useDeletePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedRequest<void>(`/payments/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: paymentKeys.listAll }),
  });
}

export interface BulkDeleteResult {
  succeeded: number;
  failed: { id: string; message: string }[];
}

/** Deletes each payment independently (the guard is per-payment) and reports which ones could not be removed. */
export function useBulkDeletePayments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<BulkDeleteResult> => {
      const results = await Promise.allSettled(ids.map((id) => authedRequest<void>(`/payments/${id}`, { method: "DELETE" })));
      const failed: BulkDeleteResult["failed"] = [];
      let succeeded = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") succeeded++;
        else failed.push({ id: ids[i]!, message: r.reason instanceof ApiError ? r.reason.message : "Could not delete" });
      });
      return { succeeded, failed };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: paymentKeys.listAll }),
  });
}

/** CSV needs a raw fetch (not the JSON-envelope apiRequest) but still carries the Bearer token. */
export async function downloadPaymentsCsv(query: PaymentsListQuery): Promise<void> {
  const { data: session } = await getSupabaseBrowserClient().auth.getSession();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const url = new URL(`/api/v1/payments/export?${params.toString()}`, publicEnv.NEXT_PUBLIC_API_URL);
  const res = await fetch(url, {
    headers: session.session?.access_token ? { Authorization: `Bearer ${session.session.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not export payments");
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
