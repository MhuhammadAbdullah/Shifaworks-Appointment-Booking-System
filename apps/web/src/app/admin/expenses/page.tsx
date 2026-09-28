"use client";

import { Suspense, useEffect, useState } from "react";
import { Download, Plus, Search, Trash2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { EXPENSE_STATUSES, EXPENSE_STATUS_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@booking/shared";
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
import { StatusFilter } from "@/components/tables/status-filter";
import { BulkActionBar } from "@/components/tables/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/tables/bulk-delete-dialog";
import { ExpenseStatusBadge } from "@/components/finance/status-badges";
import { ExpenseDetailDialog } from "@/components/finance/expense-detail-dialog";
import { downloadExpensesCsv, useBulkDeleteExpenses, useCreateExpense, useDeleteExpense, useExpenseCategories, useExpenses } from "@/lib/api/finance";
import { useUploadPrivateFile } from "@/lib/api/files";
import { usePermissions } from "@/lib/auth/hooks";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ApiError } from "@/lib/api-client";
import { formatMoney, localDate } from "@/lib/format";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const STATUS_OPTIONS = EXPENSE_STATUSES.map((s) => ({ value: s, label: EXPENSE_STATUS_LABELS[s] }));
const isDeletable = (status: string) => status === "DRAFT" || status === "REJECTED";

export default function ExpensesPage() {
  return (
    <Suspense>
      <Expenses />
    </Suspense>
  );
}

function Expenses() {
  const { can } = usePermissions();
  const categories = useExpenseCategories();
  const [status, setStatus] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const debounced = useDebounced(search);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [status, categoryId, debounced, from, to]);
  useEffect(() => setSelected(new Set()), [page]);
  const canDelete = can("expenses.update");
  const remove = useDeleteExpense();
  const bulkDelete = useBulkDeleteExpenses();

  const query = {
    page,
    pageSize: 25,
    ...(status.length ? { status: status.join(",") } : {}),
    ...(categoryId !== "all" ? { categoryId } : {}),
    ...(debounced ? { search: debounced } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const { data, isPending, error } = useExpenses(query);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadExpensesCsv(query);
    } catch (e) {
      toast.error(errorText(e, "Could not export expenses"));
    } finally {
      setExporting(false);
    }
  };

  const eligibleIds = (data?.data ?? []).filter((x) => isDeletable(x.status)).map((x) => x.id);
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

  const runBulkDelete = () => {
    bulkDelete.mutate(Array.from(selected), {
      onSuccess: (result) => {
        setBulkDeleting(false);
        setSelected(new Set());
        if (result.failed.length === 0) toast.success(`${result.succeeded} expense${result.succeeded === 1 ? "" : "s"} deleted`);
        else toast(`${result.succeeded} deleted, ${result.failed.length} could not be deleted (approved or paid)`);
      },
      onError: (e) => toast.error(errorText(e, "Could not delete the selected expenses")),
    });
  };

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Draft → approved → paid. Paying posts the expense entry to the ledger."
        actions={
          <>
            <Button variant="outline" onClick={() => void onExport()} disabled={exporting}>
              <Download className="size-4" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            {can("expenses.create") && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New expense
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <StatusFilter options={STATUS_OPTIONS} selected={status} onChange={setStatus} />
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search expenses" placeholder="Number, vendor, description" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
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
          <Label htmlFor="exp-from">From</Label>
          <Input id="exp-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="exp-to">To</Label>
          <Input id="exp-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {canDelete && (
        <BulkActionBar count={selected.size} noun="expense" onDelete={() => setBulkDeleting(true)} onClear={() => setSelected(new Set())} />
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canDelete && (
                <TableHead className="w-10">
                  {eligibleIds.length > 0 && (
                    <Checkbox
                      aria-label="Select all deletable expenses on this page"
                      checked={allEligibleSelected ? true : someEligibleSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                  )}
                </TableHead>
              )}
              <TableHead>Number</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="hidden sm:table-cell">Vendor</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="hidden md:table-cell">Date</TableHead>
              <TableHead>Status</TableHead>
              {canDelete && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={canDelete ? 8 : 6}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={canDelete ? 8 : 6} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={canDelete ? 8 : 6} className="py-8 text-center text-muted-foreground">
                  No expenses match these filters.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((e) => (
              <TableRow
                key={e.id}
                data-state={selected.has(e.id) ? "selected" : undefined}
                className="cursor-pointer hover:bg-accent/50"
                onClick={() => setViewingId(e.id)}
              >
                {canDelete && (
                  <TableCell onClick={(ev) => ev.stopPropagation()}>
                    {isDeletable(e.status) && (
                      <Checkbox aria-label={`Select ${e.expenseNumber}`} checked={selected.has(e.id)} onCheckedChange={() => toggleOne(e.id)} />
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <span className="font-mono text-sm font-medium hover:underline">{e.expenseNumber}</span>
                </TableCell>
                <TableCell className="text-sm">{e.category.name}</TableCell>
                <TableCell className="hidden text-sm sm:table-cell">{e.vendor ?? "-"}</TableCell>
                <TableCell className="font-medium">{formatMoney(e.amount, e.currency)}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{e.expenseDate}</TableCell>
                <TableCell>
                  <ExpenseStatusBadge status={e.status} />
                </TableCell>
                {canDelete && (
                  <TableCell onClick={(ev) => ev.stopPropagation()}>
                    {isDeletable(e.status) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${e.expenseNumber}`}
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate(e.id, {
                            onSuccess: () => toast.success("Expense deleted"),
                            onError: (err) => toast.error(errorText(err, "Could not delete")),
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="expenses" />
      {bulkDeleting && (
        <BulkDeleteDialog
          count={selected.size}
          noun="expense"
          description="This permanently removes each selected expense - it only works for draft or rejected expenses that haven't been approved or paid."
          deleting={bulkDelete.isPending}
          onConfirm={runBulkDelete}
          onClose={() => setBulkDeleting(false)}
        />
      )}

      {creating && <NewExpenseDialog onClose={() => setCreating(false)} />}
      {viewingId && <ExpenseDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}

function NewExpenseDialog({ onClose }: { onClose: () => void }) {
  const { me } = usePermissions();
  const categories = useExpenseCategories();
  const create = useCreateExpense();
  const upload = useUploadPrivateFile();
  const form = useForm({
    defaultValues: {
      categoryId: "",
      vendor: "",
      description: "",
      amount: "",
      paymentMethod: "" as string,
      reference: "",
      expenseDate: localDate(new Date(), me?.organization.timezone ?? "Asia/Karachi"),
      receiptFileId: null as string | null,
    },
  });
  const receiptFileId = form.watch("receiptFileId");

  const onSubmit = form.handleSubmit((v) => {
    if (!v.categoryId) {
      toast.error("Choose a category");
      return;
    }
    create.mutate(
      {
        categoryId: v.categoryId,
        vendor: v.vendor || undefined,
        description: v.description,
        amount: Number(v.amount),
        paymentMethod: (v.paymentMethod || undefined) as (typeof PAYMENT_METHODS)[number] | undefined,
        reference: v.reference || undefined,
        expenseDate: v.expenseDate,
        receiptFileId: v.receiptFileId,
      },
      { onSuccess: () => { toast.success("Expense recorded"); onClose(); }, onError: (e) => toast.error(errorText(e, "Could not record expense")) },
    );
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>New expense</DialogTitle>
          <DialogDescription>Starts as a draft; someone with approval rights needs to approve it before it can be paid.</DialogDescription>
        </DialogHeader>
        <form id="exp-form" onSubmit={onSubmit} className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4">
          <Field id="exp-category" label="Category" required>
            <Controller
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="exp-category">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.data?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field id="exp-vendor" label="Vendor" optional>
            <Input id="exp-vendor" {...form.register("vendor")} />
          </Field>
          <Field id="exp-description" label="Description" required>
            <Textarea id="exp-description" rows={2} {...form.register("description", { required: true })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="exp-amount" label="Amount" required>
              <Input id="exp-amount" type="number" step="0.01" min="0" {...form.register("amount", { required: true })} />
            </Field>
            <Field id="exp-date" label="Date" required>
              <Input id="exp-date" type="date" {...form.register("expenseDate", { required: true })} />
            </Field>
          </div>
          <Field id="exp-method" label="Payment method" optional>
            <Controller
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                  <SelectTrigger id="exp-method">
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
          <Field id="exp-reference" label="Reference" optional>
            <Input id="exp-reference" {...form.register("reference")} />
          </Field>
          <Field id="exp-receipt" label="Receipt" optional>
            {receiptFileId ? (
              <p className="text-sm text-muted-foreground">Uploaded.</p>
            ) : (
              <input
                id="exp-receipt"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={upload.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  upload.mutate(file, {
                    onSuccess: (f) => form.setValue("receiptFileId", f.id),
                    onError: (err) => toast.error(errorText(err, "Upload failed")),
                  });
                }}
              />
            )}
          </Field>
        </form>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="exp-form" disabled={create.isPending || upload.isPending}>
            {create.isPending ? "Saving…" : "Record expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
