import { EXPENSE_STATUS_LABELS, FINANCE_TX_TYPE_LABELS, INVOICE_STATUS_LABELS, type ExpenseStatus, type FinanceTxType, type InvoiceStatus } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const INVOICE_STYLES: Record<InvoiceStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  ISSUED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  PARTIALLY_PAID: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  OVERDUE: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  VOID: "bg-muted text-muted-foreground",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge variant="outline" className={cn("border-transparent", INVOICE_STYLES[status])}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}

const TX_STYLES: Record<FinanceTxType, string> = {
  INCOME: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  EXPENSE: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  REFUND: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  ADJUSTMENT: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

export function FinanceTxTypeBadge({ type }: { type: FinanceTxType }) {
  return <Badge variant="outline" className={cn("border-transparent", TX_STYLES[type])}>{FINANCE_TX_TYPE_LABELS[type]}</Badge>;
}

const EXPENSE_STYLES: Record<ExpenseStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  APPROVED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <Badge variant="outline" className={cn("border-transparent", EXPENSE_STYLES[status])}>{EXPENSE_STATUS_LABELS[status]}</Badge>;
}
