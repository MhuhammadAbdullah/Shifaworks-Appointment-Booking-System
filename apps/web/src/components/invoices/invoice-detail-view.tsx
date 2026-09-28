"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Send, Ban } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/forms/field";
import { InvoiceStatusBadge } from "@/components/finance/status-badges";
import { PaymentStatusBadge } from "@/components/bookings/status-badges";
import { usePermissions } from "@/lib/auth/hooks";
import { openInvoicePdf, useInvoice, useIssueInvoice, useVoidInvoice } from "@/lib/api/invoices";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Pass `backHref`/`backLabel` for a full-page use (renders a back link); omit both when embedded in a dialog. */
export function InvoiceDetailView({ id, backHref, backLabel }: { id: string; backHref?: string; backLabel?: string }) {
  const { can } = usePermissions();
  const { data: inv, isPending, error } = useInvoice(id);
  const issue = useIssueInvoice(id);
  const [voiding, setVoiding] = useState(false);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !inv) return <p className="text-destructive">{error?.message ?? "Invoice not found"}</p>;
  const isPayslip = inv.audience === "PROVIDER";

  return (
    <div className="grid gap-6">
      <div>
        {backHref && (
          <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {backLabel ?? (isPayslip ? "Pay slips" : "Invoices")}
          </Link>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{inv.invoiceNumber}</h1>
            <div className="mt-1">
              <InvoiceStatusBadge status={inv.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void openInvoicePdf(id).catch((e: unknown) => toast.error(errorText(e, "Could not open the PDF")))}
            >
              <FileText className="size-4" /> PDF
            </Button>
            {can("invoices.update") && inv.status === "DRAFT" && (
              <Button
                variant="outline"
                onClick={() => issue.mutate(undefined, { onSuccess: () => toast.success("Invoice issued"), onError: (e) => toast.error(errorText(e, "Could not issue")) })}
              >
                <Send className="size-4" /> Issue
              </Button>
            )}
            {can("invoices.void") && inv.status !== "VOID" && (
              <Button variant="outline" className="text-destructive" onClick={() => setVoiding(true)}>
                <Ban className="size-4" /> Void
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isPayslip ? "Paid to" : "Bill to"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          {isPayslip
            ? inv.provider && <Row label="Provider" value={inv.provider.displayName} />
            : inv.customer && <Row label="Customer" value={`${inv.customer.name} (${inv.customer.customerNumber})`} />}
          {inv.booking && (
            <div>
              <div className="text-muted-foreground">Booking</div>
              <Link href={`/admin/bookings/${inv.booking.id}`} className="font-mono font-medium hover:underline">
                {inv.booking.bookingNumber}
              </Link>
            </div>
          )}
          <Row label="Issue date" value={inv.issueDate} />
          <Row label="Due date" value={inv.dueDate ?? "-"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inv.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="text-sm">{it.description}</TableCell>
                  <TableCell className="text-right text-sm">{it.quantity}</TableCell>
                  <TableCell className="text-right text-sm">{formatMoney(it.unitPrice, inv.currency)}</TableCell>
                  <TableCell className="text-right text-sm font-medium">{formatMoney(it.totalAmount, inv.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-2 pt-6 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatMoney(inv.subtotal, inv.currency)}</span></div>
          {Number(inv.discountAmount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>−{formatMoney(inv.discountAmount, inv.currency)}</span></div>}
          {Number(inv.taxAmount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatMoney(inv.taxAmount, inv.currency)}</span></div>}
          <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{formatMoney(inv.totalAmount, inv.currency)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span>{formatMoney(inv.amountPaid, inv.currency)}</span></div>
          <div className="flex justify-between font-medium"><span>Balance due</span><span>{formatMoney(inv.amountDue, inv.currency)}</span></div>
        </CardContent>
      </Card>

      {inv.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payments received</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {inv.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b pb-1.5 last:border-0">
                <span className="font-mono">{p.paymentNumber}</span>
                <PaymentStatusBadge status={p.status} />
                <span className="font-medium">{formatMoney(p.amount, inv.currency)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {voiding && <VoidDialog id={id} onClose={() => setVoiding(false)} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function VoidDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const voidInvoice = useVoidInvoice(id);
  const form = useForm({ defaultValues: { reason: "" } });
  const onSubmit = form.handleSubmit((v) =>
    voidInvoice.mutate(
      { reason: v.reason },
      { onSuccess: () => { toast.success("Invoice voided"); onClose(); }, onError: (e) => toast.error(errorText(e, "Could not void")) },
    ),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void this invoice?</DialogTitle>
          <DialogDescription>Refund any payments first - a voided invoice with money still applied cannot be created.</DialogDescription>
        </DialogHeader>
        <form id="void-form" onSubmit={onSubmit}>
          <Field id="void-reason" label="Reason" required>
            <Textarea id="void-reason" rows={3} {...form.register("reason", { required: true })} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep invoice
          </Button>
          <Button type="submit" form="void-form" variant="destructive" disabled={voidInvoice.isPending}>
            {voidInvoice.isPending ? "Voiding…" : "Void invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
