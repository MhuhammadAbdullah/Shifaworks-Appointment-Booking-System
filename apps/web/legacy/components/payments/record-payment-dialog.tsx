"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRecordPayment } from "@/lib/api/finance";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

type Method = (typeof MANUAL_PAYMENT_METHODS)[number];

/** Staff records cash / bank / card-terminal / wallet-transfer payments. */
export function RecordPaymentDialog({
  target,
  due,
  currency,
  onClose,
}: {
  target: { bookingId: string } | { invoiceId: string };
  due: string;
  currency: string;
  onClose: () => void;
}) {
  const record = useRecordPayment();
  const [amount, setAmount] = useState(due);
  const [method, setMethod] = useState<Method>("CASH");
  const [reference, setReference] = useState("");

  function submit() {
    const value = Number(amount);
    if (!(value > 0)) return toast.error("Enter an amount");
    if (value > Number(due)) return toast.error(`At most ${formatMoney(due, currency)} is due`);
    record.mutate(
      { ...target, amount: value, method, ...(reference.trim() ? { reference: reference.trim() } : {}) },
      {
        onSuccess: (p) => {
          toast.success(`Payment ${p.paymentNumber} recorded`);
          onClose();
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not record the payment"),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>{formatMoney(due, currency)} outstanding. A fully paid pending booking is confirmed automatically.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="rp-amount">Amount ({currency})</Label>
            <Input id="rp-amount" type="number" min={0.01} step="0.01" max={due} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rp-method">Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
              <SelectTrigger id="rp-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="rp-ref">Reference (receipt / transaction id)</Label>
            <Input id="rp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
