import { BOOKING_STATUS_LABELS, PAYMENT_STATUS_LABELS, type BookingStatus, type PaymentStatus } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const BOOKING_STYLES: Record<BookingStatus, string> = {
  PENDING_PAYMENT: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  PAYMENT_SUBMITTED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  PAYMENT_VERIFIED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  CONFIRMED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  CANCELLED: "bg-muted text-muted-foreground",
  COMPLETED: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  NO_SHOW: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  RESCHEDULED: "bg-muted text-muted-foreground",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge variant="outline" className={cn("border-transparent", BOOKING_STYLES[status])}>{BOOKING_STATUS_LABELS[status]}</Badge>;
}

const PAYMENT_STYLES: Record<PaymentStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  VERIFIED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  REFUNDED: "bg-muted text-muted-foreground",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant="outline" className={cn("border-transparent", PAYMENT_STYLES[status])}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}
