"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateInvoiceInput, CreatePayslipInput, InvoiceDto, InvoiceFromBookingInput, ListInvoicesQuery, VoidInvoiceInput } from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { ApiError } from "@/lib/api-client";
import { publicEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const invoiceKeys = {
  list: (q: Partial<ListInvoicesQuery>) => ["invoices", "list", q] as const,
  listAll: ["invoices", "list"] as const,
  detail: (id: string) => ["invoices", "detail", id] as const,
};

export function useInvoices(query: Partial<ListInvoicesQuery>) {
  return useQuery({
    queryKey: invoiceKeys.list(query),
    queryFn: ({ signal }) => authedRequest<InvoiceDto[]>("/invoices", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: invoiceKeys.detail(id),
    queryFn: ({ signal }) => data(authedRequest<InvoiceDto>(`/invoices/${id}`, { signal })),
  });
}

function useInvoiceMutation<TInput>(request: (input: TInput) => Promise<InvoiceDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (inv) => {
      qc.setQueryData(invoiceKeys.detail(inv.id), inv);
      void qc.invalidateQueries({ queryKey: invoiceKeys.listAll });
    },
  });
}

export const useCreateInvoice = () => useInvoiceMutation((body: CreateInvoiceInput) => data(authedRequest<InvoiceDto>("/invoices", { method: "POST", body })));

export const useInvoiceFromBooking = () =>
  useInvoiceMutation((body: InvoiceFromBookingInput) => data(authedRequest<InvoiceDto>("/invoices/from-booking", { method: "POST", body })));

export const useCreatePayslip = () =>
  useInvoiceMutation((body: CreatePayslipInput) => data(authedRequest<InvoiceDto>("/invoices/for-provider", { method: "POST", body })));

export const useIssueInvoice = (id: string) => useInvoiceMutation(() => data(authedRequest<InvoiceDto>(`/invoices/${id}/issue`, { method: "POST" })));

export const useVoidInvoice = (id: string) =>
  useInvoiceMutation((body: VoidInvoiceInput) => data(authedRequest<InvoiceDto>(`/invoices/${id}/void`, { method: "POST", body })));

export interface BulkActionResult {
  succeeded: number;
  failed: { id: string; message: string }[];
}

/** Voids each invoice independently (the guard is per-invoice — one with payments still owing must be refunded first) and reports which ones could not be. */
export function useBulkVoidInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }): Promise<BulkActionResult> => {
      const results = await Promise.allSettled(
        ids.map((id) => authedRequest<InvoiceDto>(`/invoices/${id}/void`, { method: "POST", body: { reason } })),
      );
      const failed: BulkActionResult["failed"] = [];
      let succeeded = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") succeeded++;
        else failed.push({ id: ids[i]!, message: r.reason instanceof ApiError ? r.reason.message : "Could not void" });
      });
      return { succeeded, failed };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: invoiceKeys.listAll }),
  });
}

/** CSV needs a raw fetch (not the JSON-envelope apiRequest) but still carries the Bearer token. */
export async function downloadInvoicesCsv(query: Partial<ListInvoicesQuery>): Promise<void> {
  const { data: session } = await getSupabaseBrowserClient().auth.getSession();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const url = new URL(`/api/v1/invoices/export?${params.toString()}`, publicEnv.NEXT_PUBLIC_API_URL);
  const res = await fetch(url, {
    headers: session.session?.access_token ? { Authorization: `Bearer ${session.session.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not export invoices");
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** The PDF route needs the Bearer token, so it can't be a plain <a href>; fetch it and open a blob URL instead. */
export async function openInvoicePdf(id: string): Promise<void> {
  const { data: session } = await getSupabaseBrowserClient().auth.getSession();
  const url = new URL(`/api/v1/invoices/${id}/pdf`, publicEnv.NEXT_PUBLIC_API_URL);
  const res = await fetch(url, {
    headers: session.session?.access_token ? { Authorization: `Bearer ${session.session.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not open the PDF");
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
}
