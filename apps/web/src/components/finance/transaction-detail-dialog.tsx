"use client";

import { useState } from "react";
import { PAYMENT_METHOD_LABELS, type FinanceTransactionDto } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FinanceTxTypeBadge } from "@/components/finance/status-badges";
import { PaymentDetailDialog } from "@/components/payments/payment-detail-dialog";
import { ExpenseDetailDialog } from "@/components/finance/expense-detail-dialog";
import { formatMoney } from "@/lib/format";

/**
 * The list already fetches every field of a transaction row, so this popup needs no fetch of its own -
 * it's handed the row directly. "View payment"/"View expense" open that record's own popup in turn.
 */
export function TransactionDetailDialog({ tx, onClose }: { tx: FinanceTransactionDto; onClose: () => void }) {
  const [viewingPaymentId, setViewingPaymentId] = useState<string | null>(null);
  const [viewingExpenseId, setViewingExpenseId] = useState<string | null>(null);

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono">
              {tx.transactionNumber}
              {tx.status === "VOID" && (
                <Badge variant="outline" className="font-sans">
                  Void
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <div className="text-muted-foreground">Type</div>
              <FinanceTxTypeBadge type={tx.type} />
            </div>
            <Row label="Date" value={new Date(tx.transactionDate).toLocaleDateString("en-GB")} />
            <Row label="Amount" value={formatMoney(tx.amount, tx.currency)} />
            <Row label="Category" value={tx.category?.name ?? "-"} />
            <Row label="Method" value={tx.paymentMethod ? PAYMENT_METHOD_LABELS[tx.paymentMethod] : "-"} />
            <Row label="Reference" value={tx.reference ?? "-"} />
            {tx.booking && <Row label="Booking" value={tx.booking.bookingNumber} />}
            <Row label="Created by" value={tx.createdBy ?? "-"} />
            {tx.notes && (
              <div className="sm:col-span-2">
                <div className="text-muted-foreground">Notes</div>
                <p className="whitespace-pre-wrap">{tx.notes}</p>
              </div>
            )}
          </div>
          {(tx.paymentId || tx.expenseId) && (
            <DialogFooter className="sm:justify-start">
              {tx.paymentId && (
                <Button variant="outline" onClick={() => setViewingPaymentId(tx.paymentId)}>
                  View payment
                </Button>
              )}
              {tx.expenseId && (
                <Button variant="outline" onClick={() => setViewingExpenseId(tx.expenseId)}>
                  View expense
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {viewingPaymentId && <PaymentDetailDialog id={viewingPaymentId} onClose={() => setViewingPaymentId(null)} />}
      {viewingExpenseId && <ExpenseDetailDialog id={viewingExpenseId} onClose={() => setViewingExpenseId(null)} />}
    </>
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
