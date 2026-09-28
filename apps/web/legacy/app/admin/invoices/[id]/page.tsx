"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_METHOD_LABELS } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { InvoiceStatusBadge, PaymentStatusBadge } from "@/components/payments/badges";
import { RecordPaymentDialog } from "@/components/payments/record-payment-dialog";
import { usePermissions } from "@/lib/auth/hooks";
import { downloadAuthed, useInvoice, useIssueInvoice, useVoidInvoice } from "@/lib/api/finance";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const { data: inv, isPending, error } = useInvoice(id);
  const issue = useIssueInvoice(id);
  const [recordOpen, setRecordOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !inv) return <p className="text-destructive">{error?.message ?? "Invoice not found"}</p>;
  const open = inv.status !== "DRAFT" && inv.status !== "VOID" && Number(inv.amountDue) > 0;
  const m = (v: string) => formatMoney(v, inv.currency);

  return (
    <div className="grid gap-6">
      <Link href="/admin/invoices" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Invoices
      </Link>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-xl">{inv.invoiceNumber}</CardTitle>
            <InvoiceStatusBadge status={inv.status} />
          </div>
          <CardDescription>
            Issued {inv.issueDate}
            {inv.dueDate && ` · due ${inv.dueDate}`}
            {inv.booking && ` · booking ${inv.booking.bookingNumber}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div>
            <div className="font-medium">
              {inv.customer.name} {inv.customer.customerNumber && <span className="text-muted-foreground">({inv.customer.customerNumber})</span>}
            </div>
            <div className="text-muted-foreground">{[inv.customer.phone, inv.customer.email].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => downloadAuthed(`/invoices/${inv.id}/pdf`, `${inv.invoiceNumber}.pdf`).catch(() => toast.error("Could not open the PDF"))}>
              <FileDown className="size-4" /> PDF
            </Button>
            {inv.status === "DRAFT" && can("invoices.update") && (
              <Button
                disabled={issue.isPending}
                onClick={() =>
                  issue.mutate(undefined, {
                    onSuccess: () => toast.success("Invoice issued"),
                    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not issue"),
                  })
                }
              >
                Issue invoice
              </Button>
            )}
            {open && can("payments.create") && <Button onClick={() => setRecordOpen(true)}>Record payment</Button>}
            {inv.status !== "VOID" && can("invoices.void") && (
              <Button variant="ghost" className="text-destructive" onClick={() => setVoidOpen(true)}>
                Void
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {inv.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.description}</TableCell>
                <TableCell className="text-right">{Number(i.quantity)}</TableCell>
                <TableCell className="text-right">{m(i.unitPrice)}</TableCell>
                <TableCell className="text-right">{Number(i.discountAmount) > 0 ? m(i.discountAmount) : "—"}</TableCell>
                <TableCell className="text-right">{Number(i.taxAmount) > 0 ? `${m(i.taxAmount)} (${Number(i.taxRatePercent)}%)` : "—"}</TableCell>
                <TableCell className="text-right">{m(i.totalAmount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="ml-auto grid w-full max-w-xs gap-1 p-4 text-sm tabular-nums">
          <Row label="Subtotal" value={m(inv.subtotal)} />
          {Number(inv.discountAmount) > 0 && <Row label="Discount" value={`−${m(inv.discountAmount)}`} />}
          {Number(inv.taxAmount) > 0 && <Row label="Tax" value={m(inv.taxAmount)} />}
          <div className="border-t pt-1 font-semibold">
            <Row label="Total" value={m(inv.totalAmount)} />
          </div>
          <Row label="Paid" value={m(inv.amountPaid)} />
          <div className="font-semibold">
            <Row label="Balance due" value={m(inv.amountDue)} />
          </div>
        </div>
      </div>

      {inv.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{inv.notes}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {inv.payments.length === 0 ? (
            <p className="text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="grid gap-1">
              {inv.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0">
                  <span>
                    <Link href={`/admin/payments/${p.id}`} className="font-medium hover:underline">
                      {p.paymentNumber}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      · {PAYMENT_METHOD_LABELS[p.method]}
                      {p.paidAt && ` · ${new Date(p.paidAt).toLocaleDateString()}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{m(p.amount)}</span>
                    <PaymentStatusBadge status={p.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {recordOpen && <RecordPaymentDialog target={{ invoiceId: inv.id }} due={inv.amountDue} currency={inv.currency} onClose={() => setRecordOpen(false)} />}
      {voidOpen && <VoidDialog id={inv.id} number={inv.invoiceNumber} onClose={() => setVoidOpen(false)} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function VoidDialog({ id, number, onClose }: { id: string; number: string; onClose: () => void }) {
  const voidInvoice = useVoidInvoice(id);
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {number}</DialogTitle>
          <DialogDescription>A voided invoice stays on record but is no longer payable. Refund any payments on it first.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep invoice
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 2 || voidInvoice.isPending}
            onClick={() =>
              voidInvoice.mutate(reason.trim(), {
                onSuccess: () => {
                  toast.success("Invoice voided");
                  onClose();
                },
                onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not void"),
              })
            }
          >
            Void invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
