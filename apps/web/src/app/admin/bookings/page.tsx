"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, Download, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, SERVICE_DEFINITIONS, SERVICE_SLUGS, type BookingStatus, type ServiceSlug } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { StatusFilter } from "@/components/tables/status-filter";
import { BulkActionBar } from "@/components/tables/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/tables/bulk-delete-dialog";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/bookings/status-badges";
import { NewBookingDialog } from "@/components/bookings/new-booking-dialog";
import { BookingDetailDialog } from "@/components/bookings/booking-detail-dialog";
import { usePermissions } from "@/lib/auth/hooks";
import { downloadBookingsCsv, useBookings, useBulkDeleteBookings, useDeleteBooking } from "@/lib/api/bookings";
import { useProviders } from "@/lib/api/catalog";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { formatDateTime } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

const STATUS_OPTIONS = BOOKING_STATUSES.map((s) => ({ value: s, label: BOOKING_STATUS_LABELS[s] }));

export default function BookingsPage() {
  return (
    <Suspense>
      <Bookings />
    </Suspense>
  );
}

function Bookings() {
  const { can } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const statusParam = params.get("status");
  const status = (statusParam?.split(",").filter((s) => (BOOKING_STATUSES as readonly string[]).includes(s)) ?? []) as BookingStatus[];
  const setStatus = (next: string[]) => router.replace(next.length === 0 ? pathname : `${pathname}?status=${next.join(",")}`);
  const [search, setSearch] = useState("");
  const [service, setService] = useState("all");
  const [providerId, setProviderId] = useState("all");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<{ id: string; bookingNumber: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const debounced = useDebounced(search);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debounced, statusParam, service, providerId]);
  useEffect(() => setSelected(new Set()), [page]);
  const canDelete = can("bookings.delete") && can("bookings.view_all");
  const bulkDelete = useBulkDeleteBookings();

  const providers = useProviders({ pageSize: 100 });
  const query = {
    page,
    pageSize: 25,
    sort: "desc" as const,
    ...(status.length ? { status: status.join(",") } : {}),
    ...(debounced ? { search: debounced } : {}),
    ...(service !== "all" ? { service: service as ServiceSlug } : {}),
    ...(providerId !== "all" ? { providerId } : {}),
  };
  const { data, isPending, error } = useBookings(query);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadBookingsCsv(query);
    } catch (e) {
      toast.error(errorText(e, "Could not export bookings"));
    } finally {
      setExporting(false);
    }
  };

  const eligibleIds = (data?.data ?? []).filter((b) => b.paymentStatus === "PENDING").map((b) => b.id);
  const allEligibleSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));
  const someEligibleSelected = eligibleIds.some((id) => selected.has(id));
  const toggleAll = () =>
    setSelected(allEligibleSelected ? new Set() : new Set(eligibleIds));
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
        if (result.failed.length === 0) toast.success(`${result.succeeded} booking${result.succeeded === 1 ? "" : "s"} deleted`);
        else toast(`${result.succeeded} deleted, ${result.failed.length} could not be deleted (payment or ledger history)`);
      },
      onError: (e) => toast.error(errorText(e, "Could not delete the selected bookings")),
    });
  };

  return (
    <div>
      <PageHeader
        title="Bookings"
        description="Appointment bookings across every service and provider."
        actions={
          <>
            <Button variant="outline" onClick={() => void onExport()} disabled={exporting}>
              <Download className="size-4" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            {can("bookings.create") && (
              <Button onClick={() => setCreating(true)}>
                <CalendarPlus className="size-4" /> New booking
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusFilter options={STATUS_OPTIONS} selected={status} onChange={setStatus} />
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search bookings" placeholder="Reference, name, email, phone" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger className="w-44" aria-label="Filter by service">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {SERVICE_SLUGS.map((s) => (
              <SelectItem key={s} value={s}>
                {SERVICE_DEFINITIONS[s].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={providerId} onValueChange={setProviderId}>
          <SelectTrigger className="w-44" aria-label="Filter by provider">
            <SelectValue placeholder={providers.isPending ? "Loading…" : "All providers"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers.data?.data.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {canDelete && (
        <BulkActionBar count={selected.size} noun="booking" onDelete={() => setBulkDeleting(true)} onClear={() => setSelected(new Set())} />
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canDelete && (
                <TableHead className="w-10">
                  {eligibleIds.length > 0 && (
                    <Checkbox
                      aria-label="Select all deletable bookings on this page"
                      checked={allEligibleSelected ? true : someEligibleSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                  )}
                </TableHead>
              )}
              <TableHead>Reference</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden md:table-cell">Service &amp; provider</TableHead>
              <TableHead className="hidden lg:table-cell">When</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Payment</TableHead>
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
                  No bookings match these filters.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((b) => (
              <TableRow
                key={b.id}
                data-state={selected.has(b.id) ? "selected" : undefined}
                className="cursor-pointer hover:bg-accent/50"
                onClick={() => setViewingId(b.id)}
              >
                {canDelete && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {b.paymentStatus === "PENDING" && (
                      <Checkbox aria-label={`Select ${b.bookingNumber}`} checked={selected.has(b.id)} onCheckedChange={() => toggleOne(b.id)} />
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <span className="font-mono text-sm font-medium hover:underline">{b.bookingNumber}</span>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{b.customerName}</div>
                  <div className="text-xs text-muted-foreground">{b.customerPhone ?? b.customerEmail ?? "-"}</div>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">
                  {b.serviceName}
                  <div className="text-xs text-muted-foreground">{b.providerName}</div>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDateTime(b.startsAt, b.timezone)}</TableCell>
                <TableCell>
                  <BookingStatusBadge status={b.status} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <PaymentStatusBadge status={b.paymentStatus} />
                </TableCell>
                {canDelete && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {b.paymentStatus === "PENDING" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${b.bookingNumber}`}
                        onClick={() => setDeleting({ id: b.id, bookingNumber: b.bookingNumber })}
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
      <Pagination meta={data?.meta} onPage={setPage} noun="bookings" />
      {deleting && <DeleteBookingDialog id={deleting.id} bookingNumber={deleting.bookingNumber} onClose={() => setDeleting(null)} />}
      {bulkDeleting && (
        <BulkDeleteDialog
          count={selected.size}
          noun="booking"
          description="This permanently removes each selected booking - it only works while there is no payment or ledger history. Any that can't be deleted are reported afterward and left untouched."
          deleting={bulkDelete.isPending}
          onConfirm={runBulkDelete}
          onClose={() => setBulkDeleting(false)}
        />
      )}
      {creating && <NewBookingDialog onClose={() => setCreating(false)} />}
      {viewingId && <BookingDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}

function DeleteBookingDialog({ id, bookingNumber, onClose }: { id: string; bookingNumber: string; onClose: () => void }) {
  const del = useDeleteBooking(id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {bookingNumber}?</DialogTitle>
          <DialogDescription>
            This permanently removes the booking - it only works while there is no payment history. This cannot be undone; cancel it
            instead if you just want to close it out.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep booking
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(undefined, {
                onSuccess: () => { toast.success("Booking deleted"); onClose(); },
                onError: (e) => toast.error(errorText(e, "Could not delete")),
              })
            }
          >
            {del.isPending ? "Deleting…" : "Delete booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
