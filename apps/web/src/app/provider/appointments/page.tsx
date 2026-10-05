"use client";

import { Suspense, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { BookingStatusBadge } from "@/components/bookings/status-badges";
import { BookingDetailDialog } from "@/components/bookings/booking-detail-dialog";
import { useBookings } from "@/lib/api/bookings";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { formatDateTime } from "@/lib/format";

export default function ProviderAppointmentsPage() {
  return (
    <Suspense>
      <Appointments />
    </Suspense>
  );
}

function Appointments() {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [debounced, from, to]);

  const { data, isPending, error } = useBookings({
    page,
    pageSize: 25,
    sort: "asc",
    status: "CONFIRMED",
    ...(debounced ? { search: debounced } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });

  return (
    <div>
      <PageHeader title="My appointments" description="Confirmed appointments only - only your own, never another provider's." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search appointments" placeholder="Reference, name" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pa-from">From</Label>
          <Input id="pa-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pa-to">To</Label>
          <Input id="pa-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden sm:table-cell">Service</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={5} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No confirmed appointments match these filters.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((b) => (
              <TableRow key={b.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setViewingId(b.id)}>
                <TableCell>
                  <span className="font-mono text-sm font-medium hover:underline">{b.bookingNumber}</span>
                </TableCell>
                <TableCell className="font-medium">{b.customerName}</TableCell>
                <TableCell className="hidden text-sm sm:table-cell">{b.serviceName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDateTime(b.startsAt, b.timezone)}</TableCell>
                <TableCell>
                  <BookingStatusBadge status={b.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="appointments" />
      {viewingId && <BookingDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}
