"use client";

import { Suspense, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATE_KEY_LABELS, NOTIFICATION_STATUSES, NOTIFICATION_STATUS_LABELS, type EmailTemplateKey } from "@booking/shared";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { StatusFilter } from "@/components/tables/status-filter";
import { NotificationStatusBadge } from "@/components/notifications/status-badges";
import { NotificationDetailDialog } from "@/components/notifications/notification-detail-dialog";
import { useNotifications } from "@/lib/api/notifications";
import { useDebounced } from "@/lib/hooks/use-debounced";

const STATUS_OPTIONS = NOTIFICATION_STATUSES.map((s) => ({ value: s, label: NOTIFICATION_STATUS_LABELS[s] }));

export default function NotificationsPage() {
  return (
    <Suspense>
      <Notifications />
    </Suspense>
  );
}

function Notifications() {
  const [status, setStatus] = useState<string[]>([]);
  const [templateKey, setTemplateKey] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [debounced, status, templateKey]);

  const { data, isPending, error } = useNotifications({
    page,
    pageSize: 25,
    ...(status.length ? { status: status.join(",") } : {}),
    ...(templateKey !== "all" ? { templateKey: templateKey as EmailTemplateKey } : {}),
    ...(debounced ? { search: debounced } : {}),
  });

  return (
    <div>
      <PageHeader title="Email log" description="Every message queued for a booking: what was sent, to whom, and whether it landed." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusFilter options={STATUS_OPTIONS} selected={status} onChange={setStatus} />
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search notifications" placeholder="Recipient, subject, booking" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={templateKey} onValueChange={setTemplateKey}>
          <SelectTrigger className="w-56" aria-label="Filter by template">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All templates</SelectItem>
            {EMAIL_TEMPLATE_KEYS.map((k) => (
              <SelectItem key={k} value={k}>
                {EMAIL_TEMPLATE_KEY_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead className="hidden sm:table-cell">Template</TableHead>
              <TableHead className="hidden md:table-cell">Booking</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={5} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No notifications match these filters.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((n) => (
              <TableRow key={n.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setViewingId(n.id)}>
                <TableCell>
                  <span className="text-sm font-medium hover:underline">{n.recipient.email ?? n.recipient.name ?? "-"}</span>
                  <div className="text-xs text-muted-foreground">{n.audience}</div>
                </TableCell>
                <TableCell className="hidden text-sm sm:table-cell">{EMAIL_TEMPLATE_KEY_LABELS[n.templateKey]}</TableCell>
                <TableCell className="hidden font-mono text-sm md:table-cell">{n.booking?.bookingNumber ?? "-"}</TableCell>
                <TableCell>
                  <NotificationStatusBadge status={n.status} />
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{n.sentAt ? new Date(n.sentAt).toLocaleString("en-GB") : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="notifications" />
      {viewingId && <NotificationDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}
