"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_METHOD_LABELS, type PaymentDto } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PaymentStatusBadge } from "@/components/payments/badges";
import { usePermissions } from "@/lib/auth/hooks";
import { usePayment, useRefund } from "@/lib/api/finance";
import { ApiError } from "@/lib/api-client";
import { formatMoney, titleCase } from "@/lib/format";

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const { data: p, isPending, error } = usePayment(id);
  const [refundOpen, setRefundOpen] = useState(false);

  if (isPending) return <Skeleton className="h-80 w-full" />;
  if (error || !p) return <p className="text-destructive">{error?.message ?? "Payment not found"}</p>;
  const refundable = Number(p.amount) - Number(p.refundedAmount);
  const canRefund = can("payments.refund") && (p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED") && refundable > 0;

  return (
    <div className="grid gap-6">
      <Link href="/admin/payments" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Payments
      </Link>
      {p.needsRefund && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="font-medium text-destructive">Refund required.</span> This payment arrived after the booking&apos;s reservation lapsed and the
          place was no longer available, so the booking could not be kept. Refund the customer below.
        </div>
      )}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-xl tabular-nums">{formatMoney(p.amount, p.currency)}</CardTitle>
            <PaymentStatusBadge status={p.status} />
          </div>
          <CardDescription>
            {p.paymentNumber} · {PAYMENT_METHOD_LABELS[p.method]}
            {p.gateway && ` via ${p.gateway}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Customer" value={p.customer ? `${p.customer.name}${p.customer.customerNumber ? ` (${p.customer.customerNumber})` : ""}` : null} />
          <Field label="Booking" value={p.booking?.bookingNumber ?? null} />
          <Field
            label="Invoice"
            value={
              p.invoice ? (
                <Link className="underline" href={`/admin/invoices/${p.invoice.id}`}>
                  {p.invoice.invoiceNumber}
                </Link>
              ) : null
            }
          />
          <Field label="Paid at" value={p.paidAt ? new Date(p.paidAt).toLocaleString() : null} />
          <Field label="Reference" value={p.reference} />
          <Field label="Gateway reference" value={p.gatewayReference} />
          <Field label="Received by" value={p.receivedBy} />
          <Field label="Created" value={new Date(p.createdAt).toLocaleString()} />
          {p.failureReason && <Field label="Failure reason" value={p.failureReason} />}
          {Number(p.refundedAmount) > 0 && <Field label="Refunded" value={formatMoney(p.refundedAmount, p.currency)} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Refunds</CardTitle>
          {canRefund && (
            <Button variant="outline" onClick={() => setRefundOpen(true)}>
              Refund
            </Button>
          )}
        </CardHeader>
        <CardContent className="text-sm">
          {p.refunds.length === 0 ? (
            <p className="text-muted-foreground">No refunds.</p>
          ) : (
            <ul className="grid gap-2">
              {p.refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                  <span>
                    <span className="font-medium tabular-nums">{formatMoney(r.amount, p.currency)}</span>{" "}
                    <span className="text-muted-foreground">
                      · {r.reason} {r.processedBy && `· by ${r.processedBy}`}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {titleCase(r.status)} {r.processedAt && `· ${new Date(r.processedAt).toLocaleString()}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {refundOpen && <RefundDialog payment={p} max={refundable} onClose={() => setRefundOpen(false)} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value ?? "—"}</div>
    </div>
  );
}

function RefundDialog({ payment, max, onClose }: { payment: PaymentDto; max: number; onClose: () => void }) {
  const refund = useRefund(payment.id);
  const [amount, setAmount] = useState(max.toFixed(2));
  const [reason, setReason] = useState(payment.needsRefund ? "Booking could not be kept after late payment" : "");
  const value = Number(amount);
  const valid = value > 0 && value <= max && reason.trim().length >= 2;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund {payment.paymentNumber}</DialogTitle>
          <DialogDescription>
            Records money returned to the customer (up to {formatMoney(max, payment.currency)}). Pay the money back through the original channel; this entry updates the booking,
            invoice and ledger.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="rf-amount">Amount ({payment.currency})</Label>
            <Input id="rf-amount" type="number" min={0.01} max={max} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rf-reason">Reason</Label>
            <Textarea id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || refund.isPending}
            onClick={() =>
              refund.mutate(
                { amount: value, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success("Refund recorded");
                    onClose();
                  },
                  onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not refund"),
                },
              )
            }
          >
            Refund {formatMoney(value > 0 ? value : 0, payment.currency)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
