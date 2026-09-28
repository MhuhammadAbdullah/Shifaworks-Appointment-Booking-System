"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CustomerListItem } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/dashboard/app-shell";
import { CheckField } from "@/components/forms/check-field";
import { CustomerPicker } from "@/components/customers/customer-picker";
import { usePermissions } from "@/lib/auth/hooks";
import { useCreateInvoice } from "@/lib/api/finance";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

interface Line {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRatePercent: string;
}

const blank = (key: number): Line => ({ key, description: "", quantity: "1", unitPrice: "", discountAmount: "", taxRatePercent: "" });
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

/** Preview only: the API recomputes every amount with exact decimals. */
function lineTotals(l: Line) {
  const net = Math.max(0, num(l.quantity) * num(l.unitPrice) - num(l.discountAmount));
  const tax = Math.round(net * num(l.taxRatePercent)) / 100;
  return { gross: num(l.quantity) * num(l.unitPrice), discount: num(l.discountAmount), tax, total: net + tax };
}

export default function NewInvoicePage() {
  const router = useRouter();
  const { me } = usePermissions();
  const currency = me?.organization.currency ?? "PKR";
  const create = useCreateInvoice();
  const [customer, setCustomer] = useState<CustomerListItem | null>(null);
  const [lines, setLines] = useState<Line[]>([blank(1)]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [issue, setIssue] = useState(true);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const totals = lines.map(lineTotals).reduce(
    (a, t) => ({ gross: a.gross + t.gross, discount: a.discount + t.discount, tax: a.tax + t.tax, total: a.total + t.total }),
    { gross: 0, discount: 0, tax: 0, total: 0 },
  );
  const linesValid = lines.every((l) => l.description.trim() && num(l.quantity) > 0 && l.unitPrice.trim() !== "" && num(l.unitPrice) >= 0);

  function submit() {
    if (!customer || !linesValid) return;
    create.mutate(
      {
        customerId: customer.id,
        issue,
        ...(dueDate ? { dueDate } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: lines.map((l) => ({
          description: l.description.trim(),
          quantity: num(l.quantity),
          unitPrice: num(l.unitPrice),
          ...(l.discountAmount.trim() ? { discountAmount: num(l.discountAmount) } : {}),
          ...(l.taxRatePercent.trim() ? { taxRatePercent: num(l.taxRatePercent) } : {}),
        })),
      },
      {
        onSuccess: (inv) => {
          toast.success(`Invoice ${inv.invoiceNumber} ${issue ? "issued" : "saved as draft"}`);
          router.push(`/admin/invoices/${inv.id}`);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not create invoice"),
      },
    );
  }

  return (
    <>
      <PageHeader title="New invoice" description="For work not tied to a booking. Booking invoices are created from the booking page." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Bill to</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomerPicker value={customer} onChange={setCustomer} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {lines.map((l, i) => (
                <div key={l.key} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_80px_120px] ">
                  <div className="grid gap-1.5 sm:col-span-3">
                    <Label htmlFor={`li-d-${l.key}`}>Description</Label>
                    <div className="flex gap-2">
                      <Input id={`li-d-${l.key}`} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                      {lines.length > 1 && (
                        <Button variant="ghost" size="icon" aria-label={`Remove item ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`li-q-${l.key}`}>Qty</Label>
                    <Input id={`li-q-${l.key}`} type="number" min={0.01} step="0.01" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`li-p-${l.key}`}>Unit price</Label>
                    <Input id={`li-p-${l.key}`} type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:col-span-1">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`li-x-${l.key}`}>Discount</Label>
                      <Input id={`li-x-${l.key}`} type="number" min={0} step="0.01" value={l.discountAmount} onChange={(e) => update(l.key, { discountAmount: e.target.value })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`li-t-${l.key}`}>Tax %</Label>
                      <Input id={`li-t-${l.key}`} type="number" min={0} max={100} step="0.01" value={l.taxRatePercent} onChange={(e) => update(l.key, { taxRatePercent: e.target.value })} />
                    </div>
                  </div>
                  <div className="text-right text-sm text-muted-foreground sm:col-span-3">Line total {formatMoney(lineTotals(l).total, currency)}</div>
                </div>
              ))}
              <Button variant="outline" className="w-fit" onClick={() => setLines((ls) => [...ls, blank(Math.max(...ls.map((x) => x.key)) + 1)])}>
                <Plus className="size-4" /> Add item
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="grid gap-1 tabular-nums">
              <Row label="Subtotal" value={formatMoney(totals.gross, currency)} />
              {totals.discount > 0 && <Row label="Discount" value={`−${formatMoney(totals.discount, currency)}`} />}
              {totals.tax > 0 && <Row label="Tax" value={formatMoney(totals.tax, currency)} />}
              <div className="border-t pt-1 font-semibold">
                <Row label="Total" value={formatMoney(totals.total, currency)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ni-due">Due date</Label>
              <Input id="ni-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ni-notes">Notes (printed on the invoice)</Label>
              <Textarea id="ni-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <CheckField id="ni-issue" label="Issue now" description="Untick to save a draft you can still review." checked={issue} onCheckedChange={setIssue} />
            <Button onClick={submit} disabled={!customer || !linesValid || create.isPending}>
              {create.isPending ? "Saving…" : issue ? "Create & issue" : "Save draft"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
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
