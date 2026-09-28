"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NotificationChannel, NotificationStatus } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";

const TONE = {
  green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300",
  blue: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300",
  grey: "bg-muted text-muted-foreground",
} as const;

const STATUS: Record<NotificationStatus, [string, keyof typeof TONE]> = {
  QUEUED: ["Queued", "blue"],
  SENDING: ["Sending", "blue"],
  SENT: ["Sent", "green"],
  DELIVERED: ["Delivered", "green"],
  READ: ["Read", "green"],
  FAILED: ["Failed", "red"],
  SKIPPED: ["Skipped", "grey"],
};

export function NotificationStatusBadge({ status, retrying }: { status: NotificationStatus; retrying?: boolean }) {
  const [label, tone] = retrying ? (["Retrying", "amber"] as const) : STATUS[status];
  return (
    <Badge variant="outline" className={cn("border-transparent", TONE[tone])}>
      {label}
    </Badge>
  );
}

export const CHANNEL_LABELS: Record<NotificationChannel, string> = { EMAIL: "Email", WHATSAPP: "WhatsApp", IN_APP: "In-app", SMS: "SMS" };
export const AUDIENCE_LABELS: Record<string, string> = { CUSTOMER: "Customer", PROVIDER: "Provider", ADMIN: "Staff copy" };

/** Sub-navigation for the notifications area. */
export function NotificationTabs() {
  const pathname = usePathname();
  const { can } = usePermissions();
  const tabs = [
    { href: "/admin/notifications", label: "Delivery log", show: can("notifications.view") },
    { href: "/admin/notifications/templates", label: "Templates", show: can("notifications.view") || can("notifications.manage_templates") },
    { href: "/admin/notifications/reminders", label: "Reminders", show: can("notifications.view") || can("notifications.manage_templates") },
  ].filter((t) => t.show);
  return (
    <nav className="mb-6 flex gap-1 border-b" aria-label="Notifications sections">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
