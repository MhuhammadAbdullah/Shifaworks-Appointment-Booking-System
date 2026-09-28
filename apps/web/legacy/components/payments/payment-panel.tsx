"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, FileText } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_METHOD_LABELS } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/lib/auth/hooks";
import { downloadAuthed, followCheckout, useBookingPayments, useCheckout, useInvoiceFromBooking } from "@/lib/api/finance";
import { ApiError } from "@/lib/api-client";
import { formatMoney, titleCase } from "@/lib/format";
import { InvoiceStatusBadge, PaymentStatusBadge } from "./badges";
import { RecordPaymentDialog } from "./record-payment-dialog";

/** Totals, payments and actions for one booking (appointment or event). */
export function PaymentPanel({ bookingId, audience }: { bookingId: string; audience: "staff" | "provider" | "customer" }) {
  const { can } = usePermissions();
  const canSeeMoney = audience === "customer" || can("payments.view");
  const { data: s, isPending, error } = useBookingPayments(canSeeMoney ? bookingId : null);
  const checkout = useCheckout();
  const invoice = useInvoiceFromBooking();
  const [recordOpen, setRecordOpen] = useState(false);

  if (!canSeeMoney) return null;
  if (isPending) return <Skeleton className="h-32 w-full" />;
  if (error || !s) return null;
  const due = Number(s.amountDue);
  const live = s.bookingStatus === "PENDING" || s.bookingStatus === "CONFIRMED";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-5 text-muted-foreground" /> Payment
        </CardTitle>
        <span className="text-sm font-medium">{titleCase(s.paymentStatus)}</span>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-3 text-center">
          <div>
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="font-semibold tabular-nums">{formatMoney(s.totalAmount, s.currency)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Paid</div>
            <div className="font-semibold tabular-nums">{formatMoney(s.amountPaid, s.currency)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Due</div>
            <div className="font-semibold tabular-nums">{formatMoney(s.amountDue, s.currency)}</div>
          </div>
        </div>

        {s.payments.length > 0 && (
          <ul className="grid gap-1">
            {s.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0">
                <span>
                  {audience === "staff" ? (
                    <Link href={`/admin/payments/${p.id}`} className="font-medium hover:underline">
                      {p.paymentNumber}
                    </Link>
                  ) : (
                    <span className="font-medium">{p.paymentNumber}</span>
                  )}{" "}
                  <span className="text-muted-foreground">
                    · {PAYMENT_METHOD_LABELS[p.method]}
                    {p.paidAt && ` · ${new Date(p.paidAt).toLocaleDateString()}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney(p.amount, p.currency)}</span>
                  <PaymentStatusBadge status={p.status} />
                </span>
                {p.needsRefund && audience === "staff" && (
                  <span className="w-full text-xs font-medium text-destructive">Paid after the reservation lapsed: refund required.</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {audience === "customer" && live && due > 0 &&
            s.onlineGateways.map((g) => (
              <Button
                key={g.key}
                disabled={checkout.isPending}
                onClick={() =>
                  checkout.mutate(
                    { bookingId, gateway: g.key },
                    { onSuccess: followCheckout, onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not start payment") },
                  )
                }
              >
                Pay {formatMoney(s.amountDue, s.currency)} · {g.label}
              </Button>
            ))}
          {audience === "staff" && can("payments.create") && live && due > 0 && <Button onClick={() => setRecordOpen(true)}>Record payment</Button>}
          {s.invoice ? (
            <>
              {audience === "staff" && (
                <Button variant="outline" asChild>
                  <Link href={`/admin/invoices/${s.invoice.id}`}>
                    <FileText className="size-4" /> {s.invoice.invoiceNumber}
                  </Link>
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => downloadAuthed(`/invoices/${s.invoice!.id}/pdf`, `${s.invoice!.invoiceNumber}.pdf`).catch(() => toast.error("Could not open the invoice"))}
              >
                Invoice PDF <InvoiceStatusBadge status={s.invoice.status} />
              </Button>
            </>
          ) : (
            audience === "staff" &&
            can("invoices.create") &&
            live && (
              <Button
                variant="outline"
                disabled={invoice.isPending}
                onClick={() =>
                  invoice.mutate(bookingId, {
                    onSuccess: (inv) => toast.success(`Invoice ${inv.invoiceNumber} created`),
                    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not create invoice"),
                  })
                }
              >
                <FileText className="size-4" /> Create invoice
              </Button>
            )
          )}
        </div>
      </CardContent>
      {recordOpen && <RecordPaymentDialog target={{ bookingId }} due={s.amountDue} currency={s.currency} onClose={() => setRecordOpen(false)} />}
    </Card>
  );
}
