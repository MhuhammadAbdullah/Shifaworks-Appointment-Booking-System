"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { INVOICE_STATUSES, type InvoiceStatus } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { InvoiceStatusBadge } from "@/components/payments/badges";
import { Pagination } from "@/components/tables/pagination";
import { usePermissions } from "@/lib/auth/hooks";
import { useInvoices } from "@/lib/api/finance";
import { formatMoney, titleCase } from "@/lib/format";

export default function AdminInvoicesPage() {
  const { can } = usePermissions();
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, from, to]);
  const { data, isPending, error } = useInvoices({
    page,
    pageSize: 25,
    ...(status !== "all" ? { status } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });

  return (
    <>
      <PageHeader
        title="Invoices"
        actions={
          can("invoices.create") && (
            <Button asChild>
              <Link href="/admin/invoices/new">
                <Plus className="size-4" /> New invoice
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatus | "all")}>
          <SelectTrigger className="w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {titleCase(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="grid gap-1.5">
          <Label htmlFor="inv-from">Issued from</Label>
          <Input id="inv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="inv-to">To</Label>
          <Input id="inv-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-16 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={6} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No invoices yet.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link href={`/admin/invoices/${i.id}`} className="font-medium hover:underline">
                    {i.invoiceNumber}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {i.issueDate}
                    {i.booking && ` · ${i.booking.bookingNumber}`}
                  </div>
                </TableCell>
                <TableCell>{i.customer.name}</TableCell>
                <TableCell>{i.dueDate ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.totalAmount, i.currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.amountDue, i.currency)}</TableCell>
                <TableCell>
                  <InvoiceStatusBadge status={i.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="invoices" />
    </>
  );
}
