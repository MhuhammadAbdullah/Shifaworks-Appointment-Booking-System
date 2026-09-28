"use client";

import { useEffect, useState } from "react";
import { Paperclip, Plus } from "lucide-react";
import { toast } from "sonner";
import { EXPENSE_STATUSES, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type ExpenseDto, type ExpenseStatus, type PaymentMethod } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { usePermissions } from "@/lib/auth/hooks";
import {
  useCreateExpense,
  useCreateExpenseCategory,
  useDeleteExpense,
  useExpenseAction,
  useExpenseCategories,
  useExpenses,
  useUpdateExpense,
} from "@/lib/api/finance";
import { openPrivateFile, uploadPrivateFile } from "@/lib/api/forms";
import { ApiError } from "@/lib/api-client";
import { formatMoney, localDate, titleCase } from "@/lib/format";

const TONE: Record<ExpenseStatus, "outline" | "secondary" | "default" | "destructive"> = { DRAFT: "outline", APPROVED: "secondary", PAID: "default", REJECTED: "destructive" };
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export default function ExpensesPage() {
  const { me, can } = usePermissions();
  const currency = me?.organization.currency ?? "PKR";
  const [status, setStatus] = useState<ExpenseStatus | "all">("all");
  const [categoryId, setCategoryId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ExpenseDto | "new" | null>(null);
  const [paying, setPaying] = useState<ExpenseDto | null>(null);
  useEffect(() => setPage(1), [status, categoryId, from, to]);

  const categories = useExpenseCategories();
  const { data, isPending, error } = useExpenses({
    page,
    pageSize: 25,
    ...(status !== "all" ? { status } : {}),
    ...(categoryId !== "all" ? { categoryId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const sum = (data as { sum?: string } | undefined)?.sum;
  const action = useExpenseAction();
  const remove = useDeleteExpense();

  const act = (e: ExpenseDto, a: "approve" | "reject") =>
    action.mutate({ id: e.id, body: { action: a } }, { onSuccess: () => toast.success(`${e.expenseNumber} ${a === "approve" ? "approved" : "rejected"}`), onError: (err) => toast.error(errorText(err, "Action failed")) });

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Recorded → approved by someone else → paid. Paid expenses post to the ledger."
        actions={
          can("expenses.create") && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" /> New expense
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select value={status} onValueChange={(v) => setStatus(v as ExpenseStatus | "all")}>
          <SelectTrigger className="w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {EXPENSE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {titleCase(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="w-48" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="grid gap-1.5">
          <Label htmlFor="ex-from">From</Label>
          <Input id="ex-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ex-to">To</Label>
          <Input id="ex-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        {sum !== undefined && (
          <div className="ml-auto text-sm">
            <span className="text-muted-foreground">Total of matching expenses </span>
            <span className="font-semibold tabular-nums">{formatMoney(sum, currency)}</span>
          </div>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Expense</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
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
                  No expenses match these filters.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((e) => {
              const editable = e.status === "DRAFT" || e.status === "REJECTED";
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="font-medium">{e.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.expenseNumber} · {e.expenseDate}
                      {e.createdBy && ` · by ${e.createdBy}`}
                      {e.approvedBy && ` · ${e.status === "REJECTED" ? "rejected" : "approved"} by ${e.approvedBy}`}
                    </div>
                  </TableCell>
                  <TableCell>{e.category.name}</TableCell>
                  <TableCell>{e.vendor ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(e.amount, e.currency)}
                    {e.paymentMethod && <div className="text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[e.paymentMethod]}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={TONE[e.status]}>{titleCase(e.status)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      {e.receiptFileId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            openPrivateFile(e.receiptFileId!)
                              .then((url) => window.open(url, "_blank", "noopener"))
                              .catch(() => toast.error("Could not open the receipt"))
                          }
                        >
                          <Paperclip className="size-4" /> Receipt
                        </Button>
                      )}
                      {e.status === "DRAFT" && can("expenses.approve") && (
                        <>
                          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => act(e, "approve")}>
                            Approve
                          </Button>
                          <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => act(e, "reject")}>
                            Reject
                          </Button>
                        </>
                      )}
                      {e.status === "APPROVED" && can("expenses.approve") && (
                        <Button size="sm" onClick={() => setPaying(e)}>
                          Mark paid
                        </Button>
                      )}
                      {editable && can("expenses.update") && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (!window.confirm(`Delete ${e.expenseNumber}?`)) return;
                              remove.mutate(e.id, { onSuccess: () => toast.success("Expense deleted"), onError: (err) => toast.error(errorText(err, "Could not delete")) });
                            }}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="expenses" />
      {editing && <ExpenseDialog expense={editing === "new" ? null : editing} today={localDate(new Date(), me?.organization.timezone ?? "Asia/Karachi")} currency={currency} onClose={() => setEditing(null)} />}
      {paying && <MarkPaidDialog expense={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

function ExpenseDialog({ expense, today, currency, onClose }: { expense: ExpenseDto | null; today: string; currency: string; onClose: () => void }) {
  const { can } = usePermissions();
  const categories = useExpenseCategories();
  const createCategory = useCreateExpenseCategory();
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const [categoryId, setCategoryId] = useState(expense?.category.id ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [vendor, setVendor] = useState(expense?.vendor ?? "");
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const [date, setDate] = useState(expense?.expenseDate ?? today);
  const [method, setMethod] = useState<PaymentMethod | "none">(expense?.paymentMethod ?? "none");
  const [reference, setReference] = useState(expense?.reference ?? "");
  const [receiptFileId, setReceiptFileId] = useState<string | null>(expense?.receiptFileId ?? null);
  const [uploading, setUploading] = useState(false);
  const saving = create.isPending || update.isPending;
  const valid = categoryId && description.trim().length >= 2 && Number(amount) > 0 && date;

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const f = await uploadPrivateFile(file, file.name);
      setReceiptFileId(f.id);
      toast.success("Receipt attached");
    } catch (e) {
      toast.error(errorText(e, "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  function save() {
    if (!valid) return;
    const body = {
      categoryId,
      description: description.trim(),
      vendor: vendor.trim() || null,
      amount: Number(amount),
      expenseDate: date,
      paymentMethod: method === "none" ? null : method,
      reference: reference.trim() || null,
      receiptFileId,
    };
    const done = {
      onSuccess: () => {
        toast.success(expense ? "Expense updated (back to draft for approval)" : "Expense recorded");
        onClose();
      },
      onError: (e: unknown) => toast.error(errorText(e, "Could not save")),
    };
    if (expense) update.mutate({ id: expense.id, body }, done);
    else create.mutate(body, done);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{expense ? `Edit ${expense.expenseNumber}` : "New expense"}</DialogTitle>
          <DialogDescription>Needs approval by another team member before it can be paid.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ed-desc">Description</Label>
            <Input id="ed-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Monthly clinic rent" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-cat">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="ed-cat">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {categories.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {can("expenses.approve") && (
              <div className="flex gap-1">
                <Input aria-label="New category name" placeholder="Add category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="h-8" />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={newCategory.trim().length < 2 || createCategory.isPending}
                  onClick={() =>
                    createCategory.mutate(newCategory.trim(), {
                      onSuccess: (c) => {
                        setCategoryId(c.id);
                        setNewCategory("");
                      },
                      onError: (e) => toast.error(errorText(e, "Could not add category")),
                    })
                  }
                >
                  Add
                </Button>
              </div>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-amount">Amount ({currency})</Label>
            <Input id="ed-amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-vendor">Vendor</Label>
            <Input id="ed-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-date">Date</Label>
            <Input id="ed-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-method">Payment method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod | "none")}>
              <SelectTrigger id="ed-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not yet known</SelectItem>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-ref">Reference</Label>
            <Input id="ed-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bill / cheque no." />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ed-receipt">Receipt (private; image or PDF)</Label>
            <Input id="ed-receipt" type="file" accept="image/*,application/pdf" disabled={uploading} onChange={(e) => void upload(e.target.files?.[0])} />
            {receiptFileId && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Paperclip className="size-3" /> Receipt attached
                <button type="button" className="underline" onClick={() => setReceiptFileId(null)}>
                  remove
                </button>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || saving || uploading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkPaidDialog({ expense, onClose }: { expense: ExpenseDto; onClose: () => void }) {
  const action = useExpenseAction();
  const [method, setMethod] = useState<PaymentMethod>(expense.paymentMethod ?? "BANK_TRANSFER");
  const [reference, setReference] = useState(expense.reference ?? "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {expense.expenseNumber} as paid</DialogTitle>
          <DialogDescription>Posts {formatMoney(expense.amount, expense.currency)} to the ledger as an expense.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="mp-method">Paid by</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="mp-method">
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
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mp-ref">Reference</Label>
            <Input id="mp-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                { id: expense.id, body: { action: "mark_paid", paymentMethod: method, ...(reference.trim() ? { reference: reference.trim() } : {}) } },
                {
                  onSuccess: () => {
                    toast.success("Expense paid and posted");
                    onClose();
                  },
                  onError: (e) => toast.error(errorText(e, "Could not mark paid")),
                },
              )
            }
          >
            Mark paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
