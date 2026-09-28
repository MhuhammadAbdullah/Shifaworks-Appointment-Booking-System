import type { InvoiceStatus, PaymentRecordStatus } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONE = {
  green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300",
  blue: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300",
  grey: "bg-muted text-muted-foreground",
} as const;

const PAYMENT: Record<PaymentRecordStatus, [string, keyof typeof TONE]> = {
  PENDING: ["Pending", "amber"],
  SUCCEEDED: ["Paid", "green"],
  FAILED: ["Failed", "red"],
  CANCELLED: ["Cancelled", "grey"],
  REFUNDED: ["Refunded", "grey"],
  PARTIALLY_REFUNDED: ["Part refunded", "blue"],
};
const INVOICE: Record<InvoiceStatus, [string, keyof typeof TONE]> = {
  DRAFT: ["Draft", "grey"],
  ISSUED: ["Issued", "blue"],
  PARTIALLY_PAID: ["Part paid", "amber"],
  PAID: ["Paid", "green"],
  OVERDUE: ["Overdue", "red"],
  VOID: ["Void", "grey"],
};

const pill = ([label, tone]: [string, keyof typeof TONE]) => (
  <Badge variant="outline" className={cn("border-transparent", TONE[tone])}>
    {label}
  </Badge>
);
export const PaymentStatusBadge = ({ status }: { status: PaymentRecordStatus }) => pill(PAYMENT[status]);
export const InvoiceStatusBadge = ({ status }: { status: InvoiceStatus }) => pill(INVOICE[status]);
