"use client";

import { Suspense, useEffect, useState } from "react";
import { Ban, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceDto, type InvoiceStatus } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { BulkActionBar } from "@/components/tables/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/tables/bulk-delete-dialog";
import { InvoiceStatusBadge } from "@/components/finance/status-badges";
import { InvoiceDetailDialog } from "@/components/invoices/invoice-detail-dialog";
import { downloadInvoicesCsv, useBulkVoidInvoices, useInvoices } from "@/lib/api/invoices";
import { usePermissions } from "@/lib/auth/hooks";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const TABS = ["ALL", ...INVOICE_STATUSES] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = { ALL: "All", ...INVOICE_STATUS_LABELS };
// A pay slip's "amountPaid" is the payout itself (set the moment it's issued), not a customer
// payment to refund first — so it stays voidable regardless, unlike a customer invoice.
const isVoidable = (inv: InvoiceDto) => inv.status !== "VOID" && (inv.audience === "PROVIDER" || Number(inv.amountPaid) === 0);

export default function InvoicesPage() {
  return (
    <Suspense>
      <Invoices />
    </Suspense>
  );
}

function Invoices() {
  const { can } = usePermissions();
  const [audience, setAudience] = useState<"CUSTOMER" | "PROVIDER">("CUSTOMER");
  const [status, setStatus] = useState<(typeof TABS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkVoiding, setBulkVoiding] = useState(false);
  const [bulkReason, setBulkReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const debounced = useDebounced(search);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debounced, status, audience]);
  useEffect(() => setSelected(new Set()), [page]);
  const isPayslips = audience === "PROVIDER";
  const canVoid = can("invoices.void");
  const bulkVoid = useBulkVoidInvoices();

  const query = {
    page,
    pageSize: 25,
    audience,
    ...(status !== "ALL" ? { status: status as InvoiceStatus } : {}),
    ...(debounced ? { search: debounced } : {}),
  };
  const { data, isPending, error } = useInvoices(query);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadInvoicesCsv(query);
    } catch (e) {
      toast.error(errorText(e, "Could not export invoices"));
    } finally {
      setExporting(false);
    }
  };

  const eligibleIds = (data?.data ?? []).filter(isVoidable).map((i) => i.id);
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
          if (result.failed.length === 0) toast.success(`${result.succeeded} voided`);
          else toast(`${result.succeeded} voided, ${result.failed.length} could not be voided`);
        },
        onError: (e) => toast.error(errorText(e, "Could not void the selected invoices")),
      },
    );
  };

  return (
    <div>
      <PageHeader
        title={isPayslips ? "Pay slips" : "Invoices"}
        description="Raised from bookings or entered directly; not required for every booking."
        actions={
          <Button variant="outline" onClick={() => void onExport()} disabled={exporting}>
            <Download className="size-4" /> {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />
      <div className="mb-4">
        <Tabs value={audience} onValueChange={(v) => setAudience(v as "CUSTOMER" | "PROVIDER")}>
          <TabsList>
            <TabsTrigger value="CUSTOMER">Customer invoices</TabsTrigger>
            <TabsTrigger value="PROVIDER">Pay slips</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => setStatus(v as (typeof TABS)[number])}>
          <TabsList className="flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={isPayslips ? "Search pay slips" : "Search invoices"}
            placeholder={isPayslips ? "Pay-slip number" : "Invoice number, booking, customer"}
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {canVoid && (
        <BulkActionBar count={selected.size} noun={isPayslips ? "pay slip" : "invoice"} onDelete={() => setBulkVoiding(true)} onClear={() => setSelected(new Set())} verb="Void" />
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canVoid && (
                <TableHead className="w-10">
                  {eligibleIds.length > 0 && (
                    <Checkbox
                      aria-label="Select all voidable invoices on this page"
                      checked={allEligibleSelected ? true : someEligibleSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                  )}
                </TableHead>
              )}
              <TableHead>Number</TableHead>
              <TableHead>{isPayslips ? "Provider" : "Customer"}</TableHead>
              {!isPayslips && <TableHead className="hidden sm:table-cell">Booking</TableHead>}
              <TableHead>Total</TableHead>
              <TableHead className="hidden md:table-cell">Due</TableHead>
              <TableHead>Status</TableHead>
              {canVoid && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={(isPayslips ? 5 : 6) + (canVoid ? 2 : 0)}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={(isPayslips ? 5 : 6) + (canVoid ? 2 : 0)} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={(isPayslips ? 5 : 6) + (canVoid ? 2 : 0)} className="py-8 text-center text-muted-foreground">
                  {isPayslips ? "No pay slips match these filters." : "No invoices match these filters."}
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((inv) => (
              <TableRow
                key={inv.id}
                data-state={selected.has(inv.id) ? "selected" : undefined}
                className="cursor-pointer hover:bg-accent/50"
                onClick={() => setViewingId(inv.id)}
              >
                {canVoid && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isVoidable(inv) && (
                      <Checkbox aria-label={`Select ${inv.invoiceNumber}`} checked={selected.has(inv.id)} onCheckedChange={() => toggleOne(inv.id)} />
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <span className="font-mono text-sm font-medium hover:underline">{inv.invoiceNumber}</span>
                </TableCell>
                <TableCell className="text-sm">{inv.customer?.name ?? inv.provider?.displayName ?? "-"}</TableCell>
                {!isPayslips && <TableCell className="hidden font-mono text-sm sm:table-cell">{inv.booking?.bookingNumber ?? "-"}</TableCell>}
                <TableCell>{formatMoney(inv.totalAmount, inv.currency)}</TableCell>
                <TableCell className="hidden text-sm md:table-cell">{formatMoney(inv.amountDue, inv.currency)}</TableCell>
                <TableCell>
                  <InvoiceStatusBadge status={inv.status} />
                </TableCell>
                {canVoid && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isVoidable(inv) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Void ${inv.invoiceNumber}`}
                        disabled={bulkVoid.isPending}
                        onClick={() => {
                          const reason = window.prompt("Reason for voiding this invoice?");
                          if (!reason?.trim()) return;
                          bulkVoid.mutate(
                            { ids: [inv.id], reason: reason.trim() },
                            {
                              onSuccess: (result) =>
                                result.failed.length ? toast.error(errorText(new Error(result.failed[0]!.message), "Could not void")) : toast.success("Invoice voided"),
                              onError: (e) => toast.error(errorText(e, "Could not void")),
                            },
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
      <Pagination meta={data?.meta} onPage={setPage} noun={isPayslips ? "pay slips" : "invoices"} />
      {bulkVoiding && (
        <BulkDeleteDialog
          count={selected.size}
          noun={isPayslips ? "pay slip" : "invoice"}
          description="This voids each selected invoice - only ones with nothing paid against them can be voided."
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
      {viewingId && <InvoiceDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}
