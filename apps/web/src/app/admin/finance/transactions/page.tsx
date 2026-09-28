"use client";

import { Suspense, useEffect, useState } from "react";
import { Ban, Download, Plus, Search } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  FINANCE_TX_STATUSES,
  FINANCE_TX_TYPES,
  FINANCE_TX_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type FinanceTransactionDto,
  type FinanceTxStatus,
  type FinanceTxType,
} from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/forms/field";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { BulkActionBar } from "@/components/tables/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/tables/bulk-delete-dialog";
import { FinanceTxTypeBadge } from "@/components/finance/status-badges";
import { TransactionDetailDialog } from "@/components/finance/transaction-detail-dialog";
import {
  downloadTransactionsCsv,
  useBulkVoidTransactions,
  useCreateFinanceTx,
  useFinanceCategories,
  useFinanceTransactions,
  useVoidFinanceTx,
} from "@/lib/api/finance";
import { usePermissions } from "@/lib/auth/hooks";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ApiError } from "@/lib/api-client";
import { formatMoney, localDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const isVoidable = (t: FinanceTransactionDto) => t.status !== "VOID" && !t.paymentId && !t.expenseId;

export default function TransactionsPage() {
  return (
    <Suspense>
      <Transactions />
    </Suspense>
  );
}

function Transactions() {
  const { can } = usePermissions();
  const categories = useFinanceCategories();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<FinanceTransactionDto | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkVoiding, setBulkVoiding] = useState(false);
  const [bulkReason, setBulkReason] = useState("");
  const debounced = useDebounced(search);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debounced, type, status, categoryId, from, to]);
  useEffect(() => setSelected(new Set()), [page]);
  const canVoid = can("finance.update");
  const voidTx = useVoidFinanceTx();
  const bulkVoid = useBulkVoidTransactions();

  const query = {
    page,
    pageSize: 25,
    ...(debounced ? { search: debounced } : {}),
    ...(type !== "all" ? { type: type as FinanceTxType } : {}),
    ...(status !== "all" ? { status: status as FinanceTxStatus } : {}),
    ...(categoryId !== "all" ? { categoryId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const { data, isPending, error } = useFinanceTransactions(query);

  const eligibleIds = (data?.data ?? []).filter(isVoidable).map((t) => t.id);
  const allEligibleSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));
  const someEligibleSelected = eligibleIds.some((id) => selected.has(id));
  const toggleAll = () => setSelected(allEligibleSelected ? new Set() : new Set(eligibleIds));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulkVoid = () => {
    if (!bulkReason.trim()) return toast.error("Enter a reason");
    bulkVoid.mutate(
      { ids: Array.from(selected), reason: bulkReason.trim() },
      {
        onSuccess: (result) => {
          setBulkVoiding(false);
          setSelected(new Set());
          setBulkReason("");
          if (result.failed.length === 0) toast.success(`${result.succeeded} entr${result.succeeded === 1 ? "y" : "ies"} voided`);
          else toast(`${result.succeeded} voided, ${result.failed.length} could not be voided`);
        },
        onError: (e) => toast.error(errorText(e, "Could not void the selected entries")),
      },
    );
  };

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="The finance ledger. Payments and paid expenses post here automatically; add manual entries for anything else."
        actions={
          <div className="flex gap-2">
            {can("finance.export") && (
              <Button variant="outline" onClick={() => void downloadTransactionsCsv(query).catch((e: unknown) => toast.error(errorText(e, "Export failed")))}>
                <Download className="size-4" /> Export CSV
              </Button>
            )}
            {can("finance.create") && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New entry
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search transactions" placeholder="Number, reference, notes, booking" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {FINANCE_TX_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {FINANCE_TX_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {FINANCE_TX_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {titleCase(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="w-44" aria-label="Filter by category">
            <SelectValue placeholder={categories.isPending ? "Loading…" : "All categories"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="grid gap-1.5">
          <Label htmlFor="tx-from">From</Label>
          <Input id="tx-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tx-to">To</Label>
          <Input id="tx-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {canVoid && (
        <BulkActionBar count={selected.size} noun="entry" onDelete={() => setBulkVoiding(true)} onClear={() => setSelected(new Set())} verb="Void" />
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canVoid && (
                <TableHead className="w-10">
                  {eligibleIds.length > 0 && (
                    <Checkbox
                      aria-label="Select all voidable entries on this page"
                      checked={allEligibleSelected ? true : someEligibleSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                  )}
                </TableHead>
              )}
              <TableHead>Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden sm:table-cell">Category</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="hidden md:table-cell">Booking</TableHead>
              {canVoid && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={canVoid ? 8 : 6}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={canVoid ? 8 : 6} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={canVoid ? 8 : 6} className="py-8 text-center text-muted-foreground">
                  No transactions yet.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((t) => (
              <TableRow
                key={t.id}
                data-state={selected.has(t.id) ? "selected" : undefined}
                className={cn("cursor-pointer hover:bg-accent/50", t.status === "VOID" && "opacity-50")}
                onClick={() => setViewing(t)}
              >
                {canVoid && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isVoidable(t) && (
                      <Checkbox aria-label={`Select ${t.transactionNumber}`} checked={selected.has(t.id)} onCheckedChange={() => toggleOne(t.id)} />
                    )}
                  </TableCell>
                )}
                <TableCell className="font-mono text-sm">{t.transactionNumber}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(t.transactionDate).toLocaleDateString("en-GB")}</TableCell>
                <TableCell>
                  <FinanceTxTypeBadge type={t.type} />
                </TableCell>
                <TableCell className="hidden text-sm sm:table-cell">{t.category?.name ?? "-"}</TableCell>
                <TableCell className="font-medium">{formatMoney(t.amount, t.currency)}</TableCell>
                <TableCell className="hidden font-mono text-sm md:table-cell">{t.booking?.bookingNumber ?? "-"}</TableCell>
                {canVoid && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isVoidable(t) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Void ${t.transactionNumber}`}
                        disabled={voidTx.isPending}
                        onClick={() => {
                          const reason = window.prompt("Reason for voiding this entry?");
                          if (!reason?.trim()) return;
                          voidTx.mutate(
                            { id: t.id, reason: reason.trim() },
                            { onSuccess: () => toast.success("Entry voided"), onError: (e) => toast.error(errorText(e, "Could not void")) },
                          );
                        }}
                      >
                        <Ban className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="transactions" />
      {bulkVoiding && (
        <BulkDeleteDialog
          count={selected.size}
          noun="entry"
          description="This voids each selected entry - only manual entries not sourced from a payment or expense can be voided."
          deleting={bulkVoid.isPending}
          onConfirm={runBulkVoid}
          onClose={() => {
            setBulkVoiding(false);
            setBulkReason("");
          }}
          verb="Void"
          reason={bulkReason}
          onReasonChange={setBulkReason}
        />
      )}

      {creating && <NewEntryDialog onClose={() => setCreating(false)} />}
      {viewing && <TransactionDetailDialog tx={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function NewEntryDialog({ onClose }: { onClose: () => void }) {
  const { me } = usePermissions();
  const categories = useFinanceCategories();
  const create = useCreateFinanceTx();
  const form = useForm({
    defaultValues: {
      type: "ADJUSTMENT" as FinanceTxType,
      categoryId: "",
      amount: "",
      paymentMethod: "" as string,
      reference: "",
      notes: "",
      transactionDate: localDate(new Date(), me?.organization.timezone ?? "Asia/Karachi"),
    },
  });
  const type = form.watch("type");
  const relevantCategories = categories.data?.filter((c) => type === "ADJUSTMENT" || c.type === type) ?? [];

  const onSubmit = form.handleSubmit((v) =>
    create.mutate(
      {
        type: v.type as "INCOME" | "EXPENSE" | "ADJUSTMENT",
        categoryId: v.categoryId || undefined,
        amount: Number(v.amount),
        paymentMethod: (v.paymentMethod || undefined) as (typeof PAYMENT_METHODS)[number] | undefined,
        reference: v.reference || undefined,
        notes: v.notes,
        transactionDate: v.transactionDate,
      },
      { onSuccess: () => { toast.success("Entry recorded"); onClose(); }, onError: (e) => toast.error(errorText(e, "Could not record entry")) },
    ),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>New ledger entry</DialogTitle>
          <DialogDescription>For anything that doesn&apos;t come from a payment or expense - an adjustment, a manual income line, etc.</DialogDescription>
        </DialogHeader>
        <form id="tx-form" onSubmit={onSubmit} className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4">
          <Field id="tx-type" label="Type" required>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => { field.onChange(v); form.setValue("categoryId", ""); }}>
                  <SelectTrigger id="tx-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["INCOME", "EXPENSE", "ADJUSTMENT"] as const).map((t) => (
                      <SelectItem key={t} value={t}>
                        {FINANCE_TX_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field id="tx-category" label="Category" optional>
            <Controller
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                  <SelectTrigger id="tx-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {relevantCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="tx-amount" label="Amount" required>
              <Input id="tx-amount" type="number" step="0.01" min="0" {...form.register("amount", { required: true })} />
            </Field>
            <Field id="tx-date" label="Date" required>
              <Input id="tx-date" type="date" {...form.register("transactionDate", { required: true })} />
            </Field>
          </div>
          <Field id="tx-method" label="Payment method" optional>
            <Controller
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                  <SelectTrigger id="tx-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unspecified</SelectItem>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field id="tx-reference" label="Reference" optional>
            <Input id="tx-reference" {...form.register("reference")} />
          </Field>
          <Field id="tx-notes" label="Notes" required>
            <Textarea id="tx-notes" rows={2} {...form.register("notes", { required: true })} />
          </Field>
        </form>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="tx-form" disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Record entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
