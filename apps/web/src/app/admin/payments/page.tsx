"use client";

import { Suspense, useEffect, useState } from "react";
import { Download, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, type PaymentMethod } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { StatusFilter } from "@/components/tables/status-filter";
import { BulkActionBar } from "@/components/tables/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/tables/bulk-delete-dialog";
import { PaymentStatusBadge } from "@/components/bookings/status-badges";
import { PaymentDetailDialog } from "@/components/payments/payment-detail-dialog";
import { downloadPaymentsCsv, useBulkDeletePayments, useDeletePayment, usePayments } from "@/lib/api/payments";
import { usePermissions } from "@/lib/auth/hooks";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { formatMoney } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const STATUS_OPTIONS = PAYMENT_STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] }));
const isDeletable = (status: string) => status === "PENDING" || status === "REJECTED";

export default function PaymentsPage() {
  return (
    <Suspense>
      <Payments />
    </Suspense>
  );
}

function Payments() {
  const { can } = usePermissions();
  const [status, setStatus] = useState<string[]>(["PENDING"]);
  const [method, setMethod] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const debounced = useDebounced(search);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debounced, status, method]);
  useEffect(() => setSelected(new Set()), [page]);
  const canDelete = can("payments.delete");
  const remove = useDeletePayment();
  const bulkDelete = useBulkDeletePayments();

  const query = {
    page,
    pageSize: 25,
    ...(status.length ? { status: status.join(",") } : {}),
    ...(method !== "all" ? { method: method as PaymentMethod } : {}),
    ...(debounced ? { search: debounced } : {}),
  };
  const { data, isPending, error } = usePayments(query);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadPaymentsCsv(query);
    } catch (e) {
      toast.error(errorText(e, "Could not export payments"));
    } finally {
      setExporting(false);
    }
  };

  const eligibleIds = (data?.data ?? []).filter((p) => isDeletable(p.status)).map((p) => p.id);
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
        if (result.failed.length === 0) toast.success(`${result.succeeded} payment${result.succeeded === 1 ? "" : "s"} deleted`);
        else toast(`${result.succeeded} deleted, ${result.failed.length} could not be deleted (ledger history)`);
      },
      onError: (e) => toast.error(errorText(e, "Could not delete the selected payments")),
    });
  };

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Verify, reject or refund manually-submitted payments."
        actions={
          <Button variant="outline" onClick={() => void onExport()} disabled={exporting}>
            <Download className="size-4" /> {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusFilter options={STATUS_OPTIONS} selected={status} onChange={setStatus} />
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search payments" placeholder="Reference, booking number" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="w-44" aria-label="Filter by method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {canDelete && (
        <BulkActionBar count={selected.size} noun="payment" onDelete={() => setBulkDeleting(true)} onClear={() => setSelected(new Set())} />
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canDelete && (
                <TableHead className="w-10">
                  {eligibleIds.length > 0 && (
                    <Checkbox
                      aria-label="Select all deletable payments on this page"
                      checked={allEligibleSelected ? true : someEligibleSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                  )}
                </TableHead>
              )}
              <TableHead>Reference</TableHead>
              <TableHead>Booking</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="hidden sm:table-cell">Method</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Received</TableHead>
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
                  No payments match these filters.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((pay) => (
              <TableRow
                key={pay.id}
                data-state={selected.has(pay.id) ? "selected" : undefined}
                className="cursor-pointer hover:bg-accent/50"
                onClick={() => setViewingId(pay.id)}
              >
                {canDelete && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isDeletable(pay.status) && (
                      <Checkbox aria-label={`Select ${pay.paymentNumber}`} checked={selected.has(pay.id)} onCheckedChange={() => toggleOne(pay.id)} />
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <span className="font-mono text-sm font-medium hover:underline">{pay.paymentNumber}</span>
                </TableCell>
                <TableCell className="font-mono text-sm">{pay.booking?.bookingNumber ?? "-"}</TableCell>
                <TableCell>{formatMoney(pay.amount, pay.currency)}</TableCell>
                <TableCell className="hidden text-sm sm:table-cell">{pay.method ? PAYMENT_METHOD_LABELS[pay.method] : "-"}</TableCell>
                <TableCell>
                  <PaymentStatusBadge status={pay.status} />
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{new Date(pay.createdAt).toLocaleDateString("en-GB")}</TableCell>
                {canDelete && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isDeletable(pay.status) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${pay.paymentNumber}`}
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate(pay.id, {
                            onSuccess: () => toast.success("Payment deleted"),
                            onError: (e) => toast.error(errorText(e, "Could not delete")),
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
      <Pagination meta={data?.meta} onPage={setPage} noun="payments" />
      {viewingId && <PaymentDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
      {bulkDeleting && (
        <BulkDeleteDialog
          count={selected.size}
          noun="payment"
          description="This permanently removes each selected payment - it only works for pending or rejected payments with no ledger history."
          deleting={bulkDelete.isPending}
          onConfirm={runBulkDelete}
          onClose={() => setBulkDeleting(false)}
        />
      )}
    </div>
  );
}
