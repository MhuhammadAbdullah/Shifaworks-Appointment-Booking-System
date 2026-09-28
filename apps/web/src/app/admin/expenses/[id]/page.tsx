"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, Trash2, Wallet, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_METHOD_LABELS } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpenseStatusBadge } from "@/components/finance/status-badges";
import { useDeleteExpense, useExpense, useExpenseAction } from "@/lib/api/finance";
import { openPrivateFile } from "@/lib/api/files";
import { usePermissions } from "@/lib/auth/hooks";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const { data: e, isPending, error } = useExpense(id);
  const action = useExpenseAction(id);
  const del = useDeleteExpense();
  const [deleting, setDeleting] = useState(false);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !e) return <p className="text-destructive">{error?.message ?? "Expense not found"}</p>;

  // The API also rejects approving/rejecting your own expense (separation of duties); this only hides the buttons in the common case.
  const canApprove = can("expenses.approve");

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/expenses" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Expenses
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{e.expenseNumber}</h1>
            <div className="mt-1">
              <ExpenseStatusBadge status={e.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canApprove && e.status === "DRAFT" && (
              <Button
                onClick={() => action.mutate({ action: "approve" }, { onSuccess: () => toast.success("Approved"), onError: (err) => toast.error(errorText(err, "Could not approve")) })}
              >
                <CheckCircle2 className="size-4" /> Approve
              </Button>
            )}
            {canApprove && e.status === "DRAFT" && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => action.mutate({ action: "reject" }, { onSuccess: () => toast.success("Rejected"), onError: (err) => toast.error(errorText(err, "Could not reject")) })}
              >
                <XCircle className="size-4" /> Reject
              </Button>
            )}
            {canApprove && e.status === "APPROVED" && (
              <Button
                variant="outline"
                onClick={() => action.mutate({ action: "mark_paid" }, { onSuccess: () => toast.success("Marked paid"), onError: (err) => toast.error(errorText(err, "Could not mark paid")) })}
              >
                <Wallet className="size-4" /> Mark paid
              </Button>
            )}
            {can("expenses.update") && (e.status === "DRAFT" || e.status === "REJECTED") && (
              <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
                <Trash2 className="size-4" /> Delete
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
          <Row label="Category" value={e.category.name} />
          <Row label="Amount" value={formatMoney(e.amount, e.currency)} />
          <Row label="Vendor" value={e.vendor ?? "-"} />
          <Row label="Date" value={e.expenseDate} />
          <Row label="Method" value={e.paymentMethod ? PAYMENT_METHOD_LABELS[e.paymentMethod] : "-"} />
          <Row label="Reference" value={e.reference ?? "-"} />
          <div className="sm:col-span-2">
            <div className="text-muted-foreground">Description</div>
            <p className="whitespace-pre-wrap">{e.description}</p>
          </div>
          {e.receiptFileId && (
            <div>
              <div className="text-muted-foreground">Receipt</div>
              <button type="button" onClick={() => void openPrivateFile(e.receiptFileId!)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                View <ExternalLink className="size-3.5" />
              </button>
            </div>
          )}
          <Row label="Created by" value={e.createdBy ?? "-"} />
          {e.approvedBy && <Row label="Approved/rejected by" value={e.approvedBy} />}
        </CardContent>
      </Card>

      {deleting && (
        <Dialog open onOpenChange={(o) => !o && setDeleting(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this expense?</DialogTitle>
              <DialogDescription>This cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(false)}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(id, {
                    onSuccess: () => { toast.success("Expense deleted"); router.push("/admin/expenses"); },
                    onError: (err) => toast.error(errorText(err, "Could not delete")),
                  })
                }
              >
                {del.isPending ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
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
