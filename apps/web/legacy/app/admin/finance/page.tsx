"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  FINANCE_TX_TYPES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type FinanceTransactionDto,
  type FinanceTxType,
  type PaymentMethod,
} from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/dashboard/app-shell";
import { BarList } from "@/components/charts/bar-list";
import { Pagination } from "@/components/tables/pagination";
import { usePermissions } from "@/lib/auth/hooks";
import { downloadAuthed, useCreateTransaction, useFinanceCategories, useFinanceSummary, useTransactions, useVoidTransaction } from "@/lib/api/finance";
import { ApiError } from "@/lib/api-client";
import { formatMoney, localDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function FinancePage() {
  const { me, can } = usePermissions();
  const tz = me?.organization.timezone ?? "Asia/Karachi";
  const today = localDate(new Date(), tz);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [type, setType] = useState<FinanceTxType | "all">("all");
  const [page, setPage] = useState(1);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [voiding, setVoiding] = useState<FinanceTransactionDto | null>(null);
  useEffect(() => setPage(1), [from, to, type]);

  const rangeOk = Boolean(from && to && to >= from);
  const summary = useFinanceSummary(from, to);
  const txQuery = { from, to, ...(type !== "all" ? { type } : {}) };
  const tx = useTransactions({ ...txQuery, page, pageSize: 25 }, rangeOk);
  const s = rangeOk ? summary.data : undefined;
  const m = (v: string | number) => formatMoney(v, s?.currency ?? me?.organization.currency ?? "PKR");

  return (
    <>
      <PageHeader
        title="Finance"
        description="Ledger of posted income, refunds, expenses and adjustments."
        actions={
          <>
            {can("finance.export") && (
              <Button
                variant="outline"
                disabled={!rangeOk}
                onClick={() =>
                  downloadAuthed(`/finance/transactions/export?${new URLSearchParams(txQuery as Record<string, string>)}`, `transactions-${from}-${to}.csv`, false).catch(() =>
                    toast.error("Export failed"),
                  )
                }
              >
                <Download className="size-4" /> Export CSV
              </Button>
            )}
            {can("finance.create") && (
              <Button onClick={() => setAdjustOpen(true)}>
                <Plus className="size-4" /> Manual entry
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="fin-from">From</Label>
          <Input id="fin-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="fin-to">To</Label>
          <Input id="fin-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        {!rangeOk && <p className="text-sm text-destructive">Choose a valid date range.</p>}
        {summary.error && <p className="text-sm text-destructive">{summary.error.message}</p>}
      </div>

      {/* Headline numbers */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {s
          ? [
              ["Income", s.income],
              ["Refunds", s.refunds],
              ["Expenses", s.expenses],
              ["Adjustments", s.adjustments],
              ["Net", s.net],
              ["Outstanding", s.outstanding],
            ].map(([label, value]) => (
              <Card key={label} className="gap-1 py-4">
                <CardContent className="px-4">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className={cn("text-xl font-semibold tabular-nums", label === "Net" && Number(value) < 0 && "text-destructive")}>{m(value!)}</div>
                  {label === "Outstanding" && <div className="text-xs text-muted-foreground">unpaid on live bookings & invoices</div>}
                </CardContent>
              </Card>
            ))
          : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20" />)}
      </div>

      {s && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Income by payment method</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList rows={s.byMethod.map((r) => ({ label: r.method === "UNSPECIFIED" ? "Unspecified" : PAYMENT_METHOD_LABELS[r.method], value: Number(r.amount) }))} format={m} empty="No income in this period." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By category</CardTitle>
            </CardHeader>
            <CardContent>
              {s.byCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing posted in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.byCategory.map((c) => (
                      <TableRow key={`${c.categoryId}-${c.type}`}>
                        <TableCell>{c.name}</TableCell>
                        <TableCell className="text-muted-foreground">{titleCase(c.type)}</TableCell>
                        <TableCell className="text-right tabular-nums">{m(c.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Daily income</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                rows={s.daily.filter((d) => Number(d.income) > 0 || Number(d.outgoing) > 0).map((d) => ({ label: d.date, value: Number(d.income), note: Number(d.outgoing) > 0 ? `${m(d.outgoing)} out` : undefined }))}
                format={m}
                empty="No activity in this period."
              />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Transactions</h2>
        <Select value={type} onValueChange={(v) => setType(v as FinanceTxType | "all")}>
          <SelectTrigger className="w-40" aria-label="Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {FINANCE_TX_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {titleCase(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entry</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tx.isPending && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-16 w-full" />
                </TableCell>
              </TableRow>
            )}
            {tx.error && (
              <TableRow>
                <TableCell colSpan={6} className="text-destructive">
                  {tx.error.message}
                </TableCell>
              </TableRow>
            )}
            {tx.data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No transactions in this period.
                </TableCell>
              </TableRow>
            )}
            {tx.data?.data.map((t) => {
              const outgoing = t.type === "EXPENSE" || t.type === "REFUND";
              const manual = !t.paymentId && !t.expenseId;
              return (
                <TableRow key={t.id} className={cn(t.status === "VOID" && "opacity-50")}>
                  <TableCell>
                    <div className="font-medium">{t.transactionNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.transactionDate}
                      {t.paymentMethod && ` · ${PAYMENT_METHOD_LABELS[t.paymentMethod]}`}
                      {t.reference && ` · ${t.reference}`}
                    </div>
                    {t.notes && <div className="max-w-xs truncate text-xs text-muted-foreground">{t.notes}</div>}
                  </TableCell>
                  <TableCell>
                    {titleCase(t.type)} {t.status !== "POSTED" && <Badge variant="outline">{titleCase(t.status)}</Badge>}
                  </TableCell>
                  <TableCell>{t.category?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {t.paymentId ? (
                      <Link className="hover:underline" href={`/admin/payments/${t.paymentId}`}>
                        {t.booking?.bookingNumber ?? "Payment"}
                      </Link>
                    ) : t.expenseId ? (
                      <Link className="hover:underline" href="/admin/expenses">
                        Expense
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Manual{t.createdBy && ` · ${t.createdBy}`}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {outgoing ? "−" : ""}
                    {formatMoney(t.amount, t.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {manual && t.status === "POSTED" && can("finance.update") && (
                      <Button variant="ghost" size="sm" onClick={() => setVoiding(t)}>
                        Void
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={tx.data?.meta} onPage={setPage} noun="transactions" />
      {adjustOpen && <ManualEntryDialog today={today} onClose={() => setAdjustOpen(false)} />}
      {voiding && <VoidTxDialog tx={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}

function ManualEntryDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const create = useCreateTransaction();
  const categories = useFinanceCategories();
  const [type, setType] = useState<"INCOME" | "EXPENSE" | "ADJUSTMENT">("ADJUSTMENT");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("none");
  const [method, setMethod] = useState<PaymentMethod | "none">("none");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const cats = categories.data?.filter((c) => type === "ADJUSTMENT" || c.type === type) ?? [];
  const valid = Number(amount) > 0 && date && notes.trim().length >= 2;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manual ledger entry</DialogTitle>
          <DialogDescription>For money that didn&apos;t go through a booking, invoice or expense. Every entry is audited and can only be voided, not edited.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="me-type">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v as typeof type);
                setCategoryId("none");
              }}
            >
              <SelectTrigger id="me-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INCOME">Income</SelectItem>
                <SelectItem value="EXPENSE">Expense</SelectItem>
                <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="me-amount">Amount</Label>
            <Input id="me-amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="me-cat">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="me-cat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {cats.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="me-method">Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod | "none")}>
              <SelectTrigger id="me-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not applicable</SelectItem>
                {PAYMENT_METHODS.map((pm) => (
                  <SelectItem key={pm} value={pm}>
                    {PAYMENT_METHOD_LABELS[pm]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="me-date">Date</Label>
            <Input id="me-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="me-ref">Reference</Label>
            <Input id="me-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="me-notes">Explanation</Label>
            <Textarea id="me-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  type,
                  amount: Number(amount),
                  transactionDate: date,
                  notes: notes.trim(),
                  categoryId: categoryId === "none" ? null : categoryId,
                  paymentMethod: method === "none" ? null : method,
                  ...(reference.trim() ? { reference: reference.trim() } : {}),
                },
                {
                  onSuccess: (t) => {
                    toast.success(`${t.transactionNumber} posted`);
                    onClose();
                  },
                  onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not post"),
                },
              )
            }
          >
            Post entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidTxDialog({ tx, onClose }: { tx: FinanceTransactionDto; onClose: () => void }) {
  const voidTx = useVoidTransaction();
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {tx.transactionNumber}</DialogTitle>
          <DialogDescription>
            {titleCase(tx.type)} of {formatMoney(tx.amount, tx.currency)}. It stays in the ledger marked void and stops counting in totals.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="vt-reason">Reason</Label>
          <Textarea id="vt-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 2 || voidTx.isPending}
            onClick={() =>
              voidTx.mutate(
                { id: tx.id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success("Entry voided");
                    onClose();
                  },
                  onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not void"),
                },
              )
            }
          >
            Void entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
