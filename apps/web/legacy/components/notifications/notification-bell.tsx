"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import type { InboxItemDto } from "@booking/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useInbox, useMarkAllRead, useMarkRead, useUnreadCount } from "@/lib/api/notifications";
import { cn } from "@/lib/utils";

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d} d ago` : new Date(iso).toLocaleDateString();
}

/** Header bell: unread count (polled every minute) and the latest in-app notifications. */
export function NotificationBell() {
  const router = useRouter();
  const { data: unread = 0 } = useUnreadCount();
  const { data, isPending, refetch } = useInbox({ page: 1, pageSize: 8 });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  function open(item: InboxItemDto) {
    if (!item.readAt) markRead.mutate(item.id);
    if (item.link) router.push(item.link);
  }

  return (
    <DropdownMenu onOpenChange={(o) => o && void refetch()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unread > 0 && (
            <button type="button" className="text-xs font-normal text-muted-foreground hover:text-foreground" onClick={() => markAll.mutate(undefined)}>
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isPending && <div className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</div>}
        {data?.data.length === 0 && <div className="px-2 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>}
        {data?.data.map((n) => (
          <DropdownMenuItem key={n.id} onSelect={() => open(n)} className="flex items-start gap-2 py-2">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden />
            <span className="grid min-w-0 gap-0.5">
              <span className={cn("truncate text-sm", !n.readAt && "font-medium")}>{n.title}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
              <span className="text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account/notifications" className="justify-center text-sm">
            See all notifications
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
