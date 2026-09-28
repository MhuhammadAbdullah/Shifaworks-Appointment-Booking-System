"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, PAYMENT_RECORD_STATUSES, type PaymentMethod, type PaymentRecordStatus } from "@booking/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { CheckField } from "@/components/forms/check-field";
import { PaymentStatusBadge } from "@/components/payments/badges";
import { Pagination } from "@/components/tables/pagination";
import { usePayments } from "@/lib/api/finance";
import { formatMoney, titleCase } from "@/lib/format";

export default function AdminPaymentsPage() {
  const [status, setStatus] = useState<PaymentRecordStatus | "all">("all");
  const [method, setMethod] = useState<PaymentMethod | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [needsRefund, setNeedsRefund] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, method, from, to, needsRefund]);

  const { data, isPending, error } = usePayments({
    page,
    pageSize: 25,
    ...(status !== "all" ? { status } : {}),
    ...(method !== "all" ? { method } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(needsRefund ? { needsRefund: true } : {}),
  });

  return (
    <>
      <PageHeader title="Payments" description="Every payment attempt: gateway checkouts and payments recorded by staff." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select value={status} onValueChange={(v) => setStatus(v as PaymentRecordStatus | "all")}>
          <SelectTrigger className="w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PAYMENT_RECORD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {titleCase(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod | "all")}>
          <SelectTrigger className="w-40" aria-label="Method">
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
        <div className="grid gap-1.5">
          <Label htmlFor="pay-from">From</Label>
          <Input id="pay-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pay-to">To</Label>
          <Input id="pay-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <CheckField id="pay-refund" label="Needs refund" checked={needsRefund} onCheckedChange={setNeedsRefund} />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payment</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>For</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
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
                  No payments match these filters.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/admin/payments/${p.id}`} className="font-medium hover:underline">
                    {p.paymentNumber}
                  </Link>
                  <div className="text-xs text-muted-foreground">{new Date(p.paidAt ?? p.createdAt).toLocaleString()}</div>
                  {p.needsRefund && <div className="text-xs font-medium text-destructive">Refund required</div>}
                </TableCell>
                <TableCell>{p.customer ? p.customer.name : "—"}</TableCell>
                <TableCell className="text-sm">{p.booking?.bookingNumber ?? p.invoice?.invoiceNumber ?? "—"}</TableCell>
                <TableCell>{PAYMENT_METHOD_LABELS[p.method]}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(p.amount, p.currency)}
                  {Number(p.refundedAmount) > 0 && <div className="text-xs text-muted-foreground">−{formatMoney(p.refundedAmount, p.currency)} refunded</div>}
                </TableCell>
                <TableCell>
                  <PaymentStatusBadge status={p.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="payments" />
    </>
  );
}
