"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ExternalLink, RotateCcw, Send, XCircle } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/forms/field";
import { PaymentStatusBadge } from "@/components/bookings/status-badges";
import { usePermissions } from "@/lib/auth/hooks";
import { usePayment, useMarkSubmitted, useVerifyPayment, useRejectPayment, useRefundPayment } from "@/lib/api/payments";
import { openPrivateFile, useUploadPrivateFile } from "@/lib/api/files";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Pass `backHref`/`backLabel` for a full-page use (renders a back link); omit both when embedded in a dialog. */
export function PaymentDetailView({ id, backHref, backLabel }: { id: string; backHref?: string; backLabel?: string }) {
  const { can } = usePermissions();
  const { data: pay, isPending, error } = usePayment(id);
  const [dialog, setDialog] = useState<"submitted" | "verify" | "reject" | "refund" | null>(null);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !pay) return <p className="text-destructive">{error?.message ?? "Payment not found"}</p>;

  const refundable = Number(pay.amount) - Number(pay.refundedAmount);

  return (
    <div className="grid gap-6">
      <div>
        {backHref && (
          <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {backLabel}
          </Link>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{pay.paymentNumber}</h1>
            <div className="mt-1">
              <PaymentStatusBadge status={pay.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can("payments.verify") && pay.status === "PENDING" && !pay.submittedAt && (
              <Button variant="outline" onClick={() => setDialog("submitted")}>
                <Send className="size-4" /> Mark submitted
              </Button>
            )}
            {can("payments.verify") && pay.status === "PENDING" && (
              <Button onClick={() => setDialog("verify")}>
                <CheckCircle2 className="size-4" /> Verify
              </Button>
            )}
            {can("payments.verify") && pay.status === "PENDING" && (
              <Button variant="outline" className="text-destructive" onClick={() => setDialog("reject")}>
                <XCircle className="size-4" /> Reject
              </Button>
            )}
            {can("payments.refund") && pay.status === "VERIFIED" && refundable > 0 && (
              <Button variant="outline" onClick={() => setDialog("refund")}>
                <RotateCcw className="size-4" /> Refund
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Amount" value={formatMoney(pay.amount, pay.currency)} />
          <Row label="Method" value={pay.method ? PAYMENT_METHOD_LABELS[pay.method] : "-"} />
          <Row label="Reference" value={pay.reference ?? "-"} />
          {pay.booking && (
            <div>
              <div className="text-muted-foreground">Booking</div>
              <Link href={`/admin/bookings/${pay.booking.id}`} className="font-mono font-medium hover:underline">
                {pay.booking.bookingNumber}
              </Link>
            </div>
          )}
          {pay.customer && <Row label="Customer" value={`${pay.customer.name} (${pay.customer.customerNumber})`} />}
          {pay.proofFileId && (
            <div>
              <div className="text-muted-foreground">Proof</div>
              <button type="button" onClick={() => void openPrivateFile(pay.proofFileId!)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                View <ExternalLink className="size-3.5" />
              </button>
            </div>
          )}
          {pay.notes && <Row label="Notes" value={pay.notes} />}
        </CardContent>
      </Card>

      {(pay.verifiedAt || pay.rejectedAt || pay.refundedAt) && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {pay.verifiedAt && <Row label="Verified" value={`${new Date(pay.verifiedAt).toLocaleString("en-GB")} by ${pay.verifiedBy ?? "-"}`} />}
            {pay.rejectedAt && <Row label="Rejected" value={`${new Date(pay.rejectedAt).toLocaleString("en-GB")} by ${pay.rejectedBy ?? "-"}${pay.rejectionReason ? ` - ${pay.rejectionReason}` : ""}`} />}
            {pay.refundedAt && (
              <Row
                label="Refunded"
                value={`${formatMoney(pay.refundedAmount, pay.currency)} on ${new Date(pay.refundedAt).toLocaleString("en-GB")} by ${pay.refundedBy ?? "-"}${pay.refundReason ? ` - ${pay.refundReason}` : ""}`}
              />
            )}
          </CardContent>
        </Card>
      )}

      {dialog === "submitted" && <MarkSubmittedDialog id={id} onClose={() => setDialog(null)} />}
      {dialog === "verify" && <VerifyDialog id={id} onClose={() => setDialog(null)} />}
      {dialog === "reject" && <RejectDialog id={id} onClose={() => setDialog(null)} />}
      {dialog === "refund" && <RefundDialog id={id} refundable={refundable} currency={pay.currency} onClose={() => setDialog(null)} />}
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

function MarkSubmittedDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const mark = useMarkSubmitted(id);
  const form = useForm({ defaultValues: { reference: "" } });
  const onSubmit = form.handleSubmit((v) =>
    mark.mutate(
      { reference: v.reference || undefined },
      { onSuccess: () => { toast.success("Marked as submitted"); onClose(); }, onError: (e) => toast.error(errorText(e, "Could not update")) },
    ),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark proof as submitted</DialogTitle>
          <DialogDescription>Records that the customer sent proof; the payment stays pending until you verify it.</DialogDescription>
        </DialogHeader>
        <form id="ms-form" onSubmit={onSubmit}>
          <Field id="ms-reference" label="Reference" optional>
            <Input id="ms-reference" {...form.register("reference")} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="ms-form" disabled={mark.isPending}>
            {mark.isPending ? "Saving…" : "Mark submitted"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const verify = useVerifyPayment(id);
  const upload = useUploadPrivateFile();
  const form = useForm({ defaultValues: { method: "BANK_TRANSFER" as (typeof PAYMENT_METHODS)[number], reference: "", proofFileId: null as string | null } });
  const proofFileId = form.watch("proofFileId");

  const onSubmit = form.handleSubmit((v) =>
    verify.mutate(
      { method: v.method, reference: v.reference || undefined, proofFileId: v.proofFileId },
      { onSuccess: () => { toast.success("Payment verified"); onClose(); }, onError: (e) => toast.error(errorText(e, "Could not verify")) },
    ),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify this payment</DialogTitle>
          <DialogDescription>Confirms the booking and posts the income entry to the finance ledger.</DialogDescription>
        </DialogHeader>
        <form id="verify-form" onSubmit={onSubmit} className="grid gap-4">
          <Field id="v-method" label="Method" required>
            <Controller
              control={form.control}
              name="method"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="v-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field id="v-reference" label="Transaction reference" optional>
            <Input id="v-reference" {...form.register("reference")} />
          </Field>
          <Field id="v-proof" label="Proof" optional>
            {proofFileId ? (
              <p className="text-sm text-muted-foreground">Uploaded.</p>
            ) : (
              <input
                id="v-proof"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={upload.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  upload.mutate(file, {
                    onSuccess: (f) => form.setValue("proofFileId", f.id),
                    onError: (err) => toast.error(errorText(err, "Upload failed")),
                  });
                }}
              />
            )}
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="verify-form" disabled={verify.isPending || upload.isPending}>
            {verify.isPending ? "Verifying…" : "Verify payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const reject = useRejectPayment(id);
  const form = useForm({ defaultValues: { reason: "" } });
  const onSubmit = form.handleSubmit((v) =>
    reject.mutate(
      { reason: v.reason },
      { onSuccess: () => { toast.success("Payment rejected"); onClose(); }, onError: (e) => toast.error(errorText(e, "Could not reject")) },
    ),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this payment?</DialogTitle>
          <DialogDescription>The booking goes back to pending payment and a fresh payment is opened so the customer can pay again.</DialogDescription>
        </DialogHeader>
        <form id="reject-form" onSubmit={onSubmit}>
          <Field id="reject-reason" label="Reason" required>
            <Textarea id="reject-reason" rows={3} {...form.register("reason", { required: true })} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reject-form" variant="destructive" disabled={reject.isPending || !form.watch("reason").trim()}>
            {reject.isPending ? "Rejecting…" : "Reject payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({ id, refundable, currency, onClose }: { id: string; refundable: number; currency: string; onClose: () => void }) {
  const refund = useRefundPayment(id);
  const form = useForm({ defaultValues: { amount: String(refundable.toFixed(2)), reason: "" } });
  const onSubmit = form.handleSubmit((v) =>
    refund.mutate(
      { amount: Number(v.amount), reason: v.reason },
      { onSuccess: () => { toast.success("Refund recorded"); onClose(); }, onError: (e) => toast.error(errorText(e, "Could not refund")) },
    ),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund this payment</DialogTitle>
          <DialogDescription>Up to {formatMoney(refundable, currency)} can be refunded. This posts a REFUND entry to the ledger.</DialogDescription>
        </DialogHeader>
        <form id="refund-form" onSubmit={onSubmit} className="grid gap-4">
          <Field id="r-amount" label="Amount" required>
            <Input id="r-amount" type="number" step="0.01" min="0" max={refundable} {...form.register("amount", { required: true })} />
          </Field>
          <Field id="r-reason" label="Reason" required>
            <Textarea id="r-reason" rows={3} {...form.register("reason", { required: true })} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="refund-form" variant="destructive" disabled={refund.isPending}>
            {refund.isPending ? "Refunding…" : "Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
