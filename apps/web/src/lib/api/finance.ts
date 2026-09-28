"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateExpenseInput,
  CreateFinanceCategoryInput,
  CreateFinanceTxInput,
  ExpenseActionInput,
  ExpenseCategoryDto,
  ExpenseDto,
  FinanceCategoryDto,
  FinanceSummaryDto,
  FinanceTransactionDto,
  ListExpensesQuery,
  ListFinanceTxQuery,
  UpdateExpenseInput,
  VoidFinanceTxInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { ApiError } from "@/lib/api-client";
import { publicEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface BulkActionResult {
  succeeded: number;
  failed: { id: string; message: string }[];
}

async function bulkAllSettled(ids: string[], run: (id: string) => Promise<unknown>): Promise<BulkActionResult> {
  const results = await Promise.allSettled(ids.map(run));
  const failed: BulkActionResult["failed"] = [];
  let succeeded = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") succeeded++;
    else failed.push({ id: ids[i]!, message: r.reason instanceof ApiError ? r.reason.message : "Failed" });
  });
  return { succeeded, failed };
}

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

/** `status` travels as a comma-separated string on the wire (multi-select) — the server parses it back into ListExpensesQuery["status"]. */
type ExpensesListQuery = Partial<Omit<ListExpensesQuery, "status">> & { status?: string };

export const financeKeys = {
  summary: (from: string, to: string) => ["finance", "summary", from, to] as const,
  txList: (q: Partial<ListFinanceTxQuery>) => ["finance", "transactions", q] as const,
  txListAll: ["finance", "transactions"] as const,
  categories: ["finance", "categories"] as const,
  expenseCategories: ["expenses", "categories"] as const,
  expenseList: (q: ExpensesListQuery) => ["expenses", "list", q] as const,
  expenseListAll: ["expenses", "list"] as const,
  expenseDetail: (id: string) => ["expenses", "detail", id] as const,
};

// ---------------------------------------------------------------------------
// Summary & transactions
// ---------------------------------------------------------------------------

export function useFinanceSummary(from: string, to: string) {
  return useQuery({
    queryKey: financeKeys.summary(from, to),
    queryFn: ({ signal }) => data(authedRequest<FinanceSummaryDto>("/finance/summary", { query: { from, to }, signal })),
  });
}

export function useFinanceTransactions(query: Partial<ListFinanceTxQuery>) {
  return useQuery({
    queryKey: financeKeys.txList(query),
    queryFn: ({ signal }) => authedRequest<FinanceTransactionDto[]>("/finance/transactions", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useFinanceCategories() {
  return useQuery({
    queryKey: financeKeys.categories,
    queryFn: ({ signal }) => data(authedRequest<FinanceCategoryDto[]>("/finance/categories", { signal })),
  });
}

export function useCreateFinanceTx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFinanceTxInput) => data(authedRequest<FinanceTransactionDto>("/finance/transactions", { method: "POST", body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: financeKeys.txListAll });
    },
  });
}

export function useVoidFinanceTx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: VoidFinanceTxInput & { id: string }) => data(authedRequest<FinanceTransactionDto>(`/finance/transactions/${id}/void`, { method: "POST", body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: financeKeys.txListAll });
    },
  });
}

/** Voids each transaction independently (the guard is per-row — only manual entries can be voided) and reports which ones could not be. */
export function useBulkVoidTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) =>
      bulkAllSettled(ids, (id) => authedRequest<FinanceTransactionDto>(`/finance/transactions/${id}/void`, { method: "POST", body: { reason } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: financeKeys.txListAll }),
  });
}

export function useCreateFinanceCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFinanceCategoryInput) => data(authedRequest<FinanceCategoryDto>("/finance/categories", { method: "POST", body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: financeKeys.categories });
    },
  });
}

/** CSV needs a raw fetch (not the JSON-envelope apiRequest) but still carries the Bearer token. */
export async function downloadTransactionsCsv(query: Partial<ListFinanceTxQuery>): Promise<void> {
  const { data: session } = await getSupabaseBrowserClient().auth.getSession();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const url = new URL(`/api/v1/finance/transactions/export?${params.toString()}`, publicEnv.NEXT_PUBLIC_API_URL);
  const res = await fetch(url, {
    headers: session.session?.access_token ? { Authorization: `Bearer ${session.session.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not export transactions");
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `transactions-${query.from ?? "all"}-${query.to ?? "all"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export function useExpenseCategories() {
  return useQuery({
    queryKey: financeKeys.expenseCategories,
    queryFn: ({ signal }) => data(authedRequest<ExpenseCategoryDto[]>("/finance/expense-categories", { signal })),
  });
}

export function useCreateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => data(authedRequest<ExpenseCategoryDto>("/finance/expense-categories", { method: "POST", body: { name } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: financeKeys.expenseCategories });
    },
  });
}

export function useExpenses(query: ExpensesListQuery) {
  return useQuery({
    queryKey: financeKeys.expenseList(query),
    queryFn: ({ signal }) => authedRequest<ExpenseDto[]>("/finance/expenses", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useExpense(id: string) {
  return useQuery({
    queryKey: financeKeys.expenseDetail(id),
    queryFn: ({ signal }) => data(authedRequest<ExpenseDto>(`/finance/expenses/${id}`, { signal })),
  });
}

function useExpenseMutation<TInput>(request: (input: TInput) => Promise<ExpenseDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (e) => {
      qc.setQueryData(financeKeys.expenseDetail(e.id), e);
      void qc.invalidateQueries({ queryKey: financeKeys.expenseListAll });
    },
  });
}

export const useCreateExpense = () => useExpenseMutation((body: CreateExpenseInput) => data(authedRequest<ExpenseDto>("/finance/expenses", { method: "POST", body })));

export const useUpdateExpense = (id: string) =>
  useExpenseMutation((body: UpdateExpenseInput) => data(authedRequest<ExpenseDto>(`/finance/expenses/${id}`, { method: "PATCH", body })));

export const useExpenseAction = (id: string) =>
  useExpenseMutation((body: ExpenseActionInput) => data(authedRequest<ExpenseDto>(`/finance/expenses/${id}/actions`, { method: "POST", body })));

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedRequest<void>(`/finance/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: financeKeys.expenseListAll });
    },
  });
}

/** Deletes each expense independently (the guard is per-expense — approved/paid ones are kept) and reports which ones could not be removed. */
export function useBulkDeleteExpenses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => bulkAllSettled(ids, (id) => authedRequest<void>(`/finance/expenses/${id}`, { method: "DELETE" })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: financeKeys.expenseListAll }),
  });
}

/** CSV needs a raw fetch (not the JSON-envelope apiRequest) but still carries the Bearer token. */
export async function downloadExpensesCsv(query: ExpensesListQuery): Promise<void> {
  const { data: session } = await getSupabaseBrowserClient().auth.getSession();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const url = new URL(`/api/v1/finance/expenses/export?${params.toString()}`, publicEnv.NEXT_PUBLIC_API_URL);
  const res = await fetch(url, {
    headers: session.session?.access_token ? { Authorization: `Bearer ${session.session.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not export expenses");
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
