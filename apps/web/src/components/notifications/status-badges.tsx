import { NOTIFICATION_STATUS_LABELS, type DeliveryStatus, type NotificationStatus } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLES: Record<NotificationStatus, string> = {
  QUEUED: "bg-muted text-muted-foreground",
  SENDING: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  SENT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  FAILED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  SKIPPED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
};

export function NotificationStatusBadge({ status }: { status: NotificationStatus }) {
  return <Badge variant="outline" className={cn("border-transparent", STYLES[status])}>{NOTIFICATION_STATUS_LABELS[status]}</Badge>;
}

const DELIVERY_STYLES: Record<DeliveryStatus, string> = {
  SENT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  DELIVERED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  FAILED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  BOUNCED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return <Badge variant="outline" className={cn("border-transparent", DELIVERY_STYLES[status])}>{status}</Badge>;
}
