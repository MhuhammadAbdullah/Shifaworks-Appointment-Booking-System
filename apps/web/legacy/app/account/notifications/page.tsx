"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/tables/pagination";
import { timeAgo } from "@/components/notifications/notification-bell";
import { useInbox, useMarkAllRead, useMarkRead } from "@/lib/api/notifications";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isPending, error } = useInbox({ page, pageSize: 20, ...(unreadOnly ? { unread: true } : {}) });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <div className="flex gap-2">
          <Button
            variant={unreadOnly ? "secondary" : "outline"}
            size="sm"
            onClick={() => {
              setUnreadOnly((u) => !u);
              setPage(1);
            }}
          >
            {unreadOnly ? "Showing unread" : "Unread only"}
          </Button>
          <Button variant="ghost" size="sm" disabled={markAll.isPending} onClick={() => markAll.mutate(undefined)}>
            Mark all read
          </Button>
        </div>
      </div>
      {isPending && <Skeleton className="h-40 w-full" />}
      {error && <p className="text-destructive">{error.message}</p>}
      {data?.data.length === 0 && <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">No notifications.</p>}
      <ul className="grid gap-2">
        {data?.data.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className={cn("flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left hover:bg-accent", !n.readAt && "border-primary/40")}
              onClick={() => {
                if (!n.readAt) markRead.mutate(n.id);
                if (n.link) router.push(n.link);
              }}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden />
              <span className="grid min-w-0 gap-0.5">
                <span className={cn("text-sm", !n.readAt && "font-medium")}>{n.title}</span>
                <span className="text-sm text-muted-foreground">{n.body}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Pagination meta={data?.meta} onPage={setPage} noun="notifications" />
    </div>
  );
}
