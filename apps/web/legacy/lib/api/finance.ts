"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BookingPaymentSummary,
  CheckoutResponse,
  CreateExpenseInput,
  CreateFinanceTxInput,
  CreateInvoiceInput,
  ExpenseActionInput,
  ExpenseCategoryDto,
  ExpenseDto,
  FinanceCategoryDto,
  FinanceSummaryDto,
  FinanceTransactionDto,
  GatewayInfo,
  InvoiceDto,
  ListExpensesQuery,
  ListFinanceTxQuery,
  ListInvoicesQuery,
  ListPaymentsQuery,
  ManualPaymentInput,
  PaymentDto,
  RefundInput,
  UpdateExpenseInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { ApiError } from "@/lib/api-client";

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const financeKeys = {
  payments: ["payments"] as const,
  payment: (id: string) => ["payments", "one", id] as const,
  bookingSummary: (bookingId: string) => ["payments", "booking", bookingId] as const,
  invoices: ["invoices"] as const,
  invoice: (id: string) => ["invoices", "one", id] as const,
  finance: ["finance"] as const,
  expenses: ["finance", "expenses"] as const,
};

/** Every money mutation can affect bookings, invoices, the ledger and lists. */
function useMoneyMutation<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      for (const k of [financeKeys.payments, financeKeys.invoices, financeKeys.finance, ["appointments"], ["event-bookings"], ["events"]]) {
        void qc.invalidateQueries({ queryKey: k });
      }
    },
  });
}

// ---- payments -------------------------------------------------------------------

export function usePayments(q: Partial<ListPaymentsQuery>, enabled = true) {
  return useQuery({
    queryKey: [...financeKeys.payments, "list", q],
    queryFn: ({ signal }) => authedRequest<PaymentDto[]>("/payments", { query: q as Query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
export function usePayment(id: string) {
  return useQuery({ queryKey: financeKeys.payment(id), queryFn: ({ signal }) => data(authedRequest<PaymentDto>(`/payments/${id}`, { signal })) });
}
export function useBookingPayments(bookingId: string | null) {
  return useQuery({
    queryKey: financeKeys.bookingSummary(bookingId ?? ""),
    queryFn: ({ signal }) => data(authedRequest<BookingPaymentSummary>(`/payments/bookings/${bookingId}`, { signal })),
    enabled: Boolean(bookingId),
  });
}
export function useGateways() {
  return useQuery({ queryKey: [...financeKeys.payments, "gateways"], queryFn: ({ signal }) => data(authedRequest<GatewayInfo[]>("/payments/gateways", { signal })), staleTime: 5 * 60_000 });
}
export const useRecordPayment = () => useMoneyMutation((body: ManualPaymentInput) => data(authedRequest<PaymentDto>("/payments/manual", { method: "POST", body })));
export const useRefund = (paymentId: string) =>
  useMoneyMutation((body: RefundInput) => data(authedRequest<PaymentDto>(`/payments/${paymentId}/refunds`, { method: "POST", body })));
export const useCheckout = () =>
  useMutation({
    mutationFn: (body: { bookingId: string; gateway: string }) => data(authedRequest<CheckoutResponse>("/payments/checkout", { method: "POST", body })),
  });

/** Sends the browser to the gateway: plain redirect or an auto-submitted POST form. */
export function followCheckout(r: CheckoutResponse): void {
  if (r.action.type === "redirect") {
    window.location.assign(r.action.url);
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = r.action.url;
  for (const [k, v] of Object.entries(r.action.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

// ---- invoices -------------------------------------------------------------------

export function useInvoices(q: Partial<ListInvoicesQuery>, enabled = true) {
  return useQuery({
    queryKey: [...financeKeys.invoices, "list", q],
    queryFn: ({ signal }) => authedRequest<InvoiceDto[]>("/invoices", { query: q as Query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
export function useInvoice(id: string) {
  return useQuery({ queryKey: financeKeys.invoice(id), queryFn: ({ signal }) => data(authedRequest<InvoiceDto>(`/invoices/${id}`, { signal })) });
}
export const useInvoiceFromBooking = () =>
  useMoneyMutation((bookingId: string) => data(authedRequest<InvoiceDto>("/invoices/from-booking", { method: "POST", body: { bookingId } })));
export const useCreateInvoice = () => useMoneyMutation((body: CreateInvoiceInput) => data(authedRequest<InvoiceDto>("/invoices", { method: "POST", body })));
export const useIssueInvoice = (id: string) => useMoneyMutation(() => data(authedRequest<InvoiceDto>(`/invoices/${id}/issue`, { method: "POST" })));
export const useVoidInvoice = (id: string) =>
  useMoneyMutation((reason: string) => data(authedRequest<InvoiceDto>(`/invoices/${id}/void`, { method: "POST", body: { reason } })));

/** Downloads an authenticated file (PDF/CSV) and opens or saves it. */
export async function downloadAuthed(path: string, filename: string, open = true): Promise<void> {
  const { data: s } = await getSupabaseBrowserClient().auth.getSession();
  const res = await fetch(new URL(`/api/v1${path}`, publicEnv.NEXT_PUBLIC_API_URL), {
    headers: s.session ? { Authorization: `Bearer ${s.session.access_token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "INTERNAL_ERROR", "Download failed");
  const url = URL.createObjectURL(await res.blob());
  if (open) window.open(url, "_blank", "noopener");
  else {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---- finance ledger ---------------------------------------------------------------

export function useFinanceSummary(from: string, to: string) {
  return useQuery({
    queryKey: [...financeKeys.finance, "summary", from, to],
    queryFn: ({ signal }) => data(authedRequest<FinanceSummaryDto>("/finance/summary", { query: { from, to }, signal })),
    placeholderData: keepPreviousData,
    enabled: Boolean(from && to && to >= from),
  });
}
export function useTransactions(q: Partial<ListFinanceTxQuery>, enabled = true) {
  return useQuery({
    queryKey: [...financeKeys.finance, "tx", q],
    queryFn: ({ signal }) => authedRequest<FinanceTransactionDto[]>("/finance/transactions", { query: q as Query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
export function useFinanceCategories() {
  return useQuery({ queryKey: [...financeKeys.finance, "categories"], queryFn: ({ signal }) => data(authedRequest<FinanceCategoryDto[]>("/finance/categories", { signal })) });
}
export const useCreateTransaction = () =>
  useMoneyMutation((body: CreateFinanceTxInput) => data(authedRequest<FinanceTransactionDto>("/finance/transactions", { method: "POST", body })));
export const useVoidTransaction = () =>
  useMoneyMutation(({ id, reason }: { id: string; reason: string }) =>
    data(authedRequest<FinanceTransactionDto>(`/finance/transactions/${id}/void`, { method: "POST", body: { reason } })),
  );

// ---- expenses -----------------------------------------------------------------------

export function useExpenses(q: Partial<ListExpensesQuery>) {
  return useQuery({
    queryKey: [...financeKeys.expenses, q],
    queryFn: ({ signal }) => authedRequest<ExpenseDto[]>("/finance/expenses", { query: q as Query, signal }),
    placeholderData: keepPreviousData,
  });
}
export function useExpenseCategories() {
  return useQuery({ queryKey: [...financeKeys.expenses, "categories"], queryFn: ({ signal }) => data(authedRequest<ExpenseCategoryDto[]>("/finance/expense-categories", { signal })) });
}
export const useCreateExpenseCategory = () =>
  useMoneyMutation((name: string) => data(authedRequest<ExpenseCategoryDto>("/finance/expense-categories", { method: "POST", body: { name } })));
export const useCreateExpense =() => useMoneyMutation((body: CreateExpenseInput) => data(authedRequest<ExpenseDto>("/finance/expenses", { method: "POST", body })));
export const useUpdateExpense = () =>
  useMoneyMutation(({ id, body }: { id: string; body: UpdateExpenseInput }) => data(authedRequest<ExpenseDto>(`/finance/expenses/${id}`, { method: "PATCH", body })));
export const useExpenseAction = () =>
  useMoneyMutation(({ id, body }: { id: string; body: ExpenseActionInput }) =>
    data(authedRequest<ExpenseDto>(`/finance/expenses/${id}/actions`, { method: "POST", body })),
  );
export const useDeleteExpense = () => useMoneyMutation((id: string) => authedRequest<void>(`/finance/expenses/${id}`, { method: "DELETE" }));
