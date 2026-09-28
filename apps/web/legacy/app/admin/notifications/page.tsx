"use client";

import { useEffect, useState } from "react";
import { Search, Send } from "lucide-react";
import { toast } from "sonner";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_STATUSES,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationStatus,
} from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { AUDIENCE_LABELS, CHANNEL_LABELS, NotificationStatusBadge, NotificationTabs } from "@/components/notifications/shared";
import { usePermissions } from "@/lib/auth/hooks";
import { useChannelStatus, useNotification, useNotificationLog, useRetryNotification, useSendTest } from "@/lib/api/notifications";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ApiError } from "@/lib/api-client";
import { titleCase } from "@/lib/format";

const CHANNELS: NotificationChannel[] = ["EMAIL", "WHATSAPP", "IN_APP"];
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export default function NotificationLogPage() {
  const { can } = usePermissions();
  const [channel, setChannel] = useState<NotificationChannel | "all">("all");
  const [status, setStatus] = useState<NotificationStatus | "all">("all");
  const [event, setEvent] = useState<NotificationEvent | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [channel, status, event, debounced]);

  const { data, isPending, error } = useNotificationLog({
    page,
    pageSize: 25,
    ...(channel !== "all" ? { channel } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(event !== "all" ? { event } : {}),
    ...(debounced ? { search: debounced } : {}),
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Every email, WhatsApp and in-app message the system has sent or scheduled."
        actions={
          can("notifications.send") && (
            <Button variant="outline" onClick={() => setTestOpen(true)}>
              <Send className="size-4" /> Send a test
            </Button>
          )
        }
      />
      <NotificationTabs />
      <ChannelCards />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select value={channel} onValueChange={(v) => setChannel(v as NotificationChannel | "all")}>
          <SelectTrigger className="w-36" aria-label="Channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            {CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as NotificationStatus | "all")}>
          <SelectTrigger className="w-36" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {NOTIFICATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {titleCase(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={event} onValueChange={(v) => setEvent(v as NotificationEvent | "all")}>
          <SelectTrigger className="w-52" aria-label="Event">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All messages</SelectItem>
            {NOTIFICATION_EVENTS.map((e) => (
              <SelectItem key={e} value={e}>
                {NOTIFICATION_EVENT_LABELS[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search" placeholder="Recipient name, email or phone" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Message</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-16 w-full" />
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
            {data?.data.map((n) => {
              const scheduled = n.status === "QUEUED" && n.scheduledFor && Date.parse(n.scheduledFor) > Date.now();
              return (
                <TableRow key={n.id} className="cursor-pointer" onClick={() => setOpenId(n.id)}>
                  <TableCell>
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpenId(n.id)}>
                      {NOTIFICATION_EVENT_LABELS[n.event]}
                    </button>
                    <div className="max-w-xs truncate text-xs text-muted-foreground">{n.title ?? (n.audience ? AUDIENCE_LABELS[n.audience] : "")}</div>
                  </TableCell>
                  <TableCell>{CHANNEL_LABELS[n.channel]}</TableCell>
                  <TableCell className="text-sm">
                    <div>{n.recipient.name ?? n.recipient.email ?? n.recipient.phone ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{n.channel === "EMAIL" ? n.recipient.email : n.channel === "WHATSAPP" ? n.recipient.phone : n.audience && AUDIENCE_LABELS[n.audience]}</div>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {scheduled ? (
                      <span>Scheduled {new Date(n.scheduledFor!).toLocaleString()}</span>
                    ) : (
                      new Date(n.sentAt ?? n.createdAt).toLocaleString()
                    )}
                  </TableCell>
                  <TableCell>
                    <NotificationStatusBadge status={n.status} retrying={n.status === "FAILED" && n.attempts < MAX_NOTIFICATION_ATTEMPTS} />
                    {n.lastError && <div className="mt-1 max-w-56 truncate text-xs text-muted-foreground" title={n.lastError}>{n.lastError}</div>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="notifications" />
      {openId && <DetailDialog id={openId} onClose={() => setOpenId(null)} />}
      {testOpen && <TestDialog onClose={() => setTestOpen(false)} />}
    </>
  );
}

function ChannelCards() {
  const { data } = useChannelStatus();
  if (!data) return null;
  const item = (label: string, value: string, ok: boolean, note?: string) => (
    <Card className="gap-1 py-3">
      <CardContent className="px-4 text-sm">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="flex items-center gap-2 font-medium">
          <span className={ok ? "text-emerald-600" : "text-amber-600"} aria-hidden>
            ●
          </span>
          {value}
        </div>
        {note && <div className="mt-0.5 truncate text-xs text-muted-foreground" title={note}>{note}</div>}
      </CardContent>
    </Card>
  );
  const mode = (p: string, configured: boolean) => (p === "console" ? "Test mode (logged, not sent)" : p === "disabled" || !configured ? "Not configured" : `Live (${p})`);
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      {item("Email", mode(data.email.provider, data.email.configured), data.email.provider !== "disabled" && data.email.configured, data.email.from ?? undefined)}
      {item("WhatsApp", mode(data.whatsapp.provider, data.whatsapp.configured), data.whatsapp.provider !== "disabled" && data.whatsapp.configured, `Status webhook: ${data.whatsapp.webhookUrl}`)}
      {item("Delivery", data.queue.mode === "bullmq" ? "BullMQ queue workers" : "In-process worker", data.queue.mode === "in-process" || data.queue.redis, data.queue.mode === "bullmq" ? (data.queue.redis ? "Redis connected" : "Redis unreachable") : "Every 30 s + right after changes")}
    </div>
  );
}

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = usePermissions();
  const { data: n, isPending } = useNotification(id);
  const retry = useRetryNotification();
  const canRetry = n && can("notifications.send") && n.channel !== "IN_APP" && (n.status === "FAILED" || n.status === "SKIPPED");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{n ? NOTIFICATION_EVENT_LABELS[n.event] : "Notification"}</DialogTitle>
          <DialogDescription>
            {n && `${CHANNEL_LABELS[n.channel]} to ${n.recipient.name ?? n.recipient.email ?? n.recipient.phone ?? "—"}${n.audience ? ` (${AUDIENCE_LABELS[n.audience]})` : ""}`}
          </DialogDescription>
        </DialogHeader>
        {isPending || !n ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <NotificationStatusBadge status={n.status} retrying={n.status === "FAILED" && n.attempts < MAX_NOTIFICATION_ATTEMPTS} />
              <span className="text-muted-foreground">
                {n.attempts} attempt{n.attempts === 1 ? "" : "s"}
                {n.scheduledFor && ` · scheduled ${new Date(n.scheduledFor).toLocaleString()}`}
                {n.sentAt && ` · sent ${new Date(n.sentAt).toLocaleString()}`}
              </span>
            </div>
            {n.lastError && <p className="rounded-md bg-muted p-2 text-muted-foreground">{n.lastError}</p>}
            {(n.title || n.body) && (
              <div className="rounded-md border p-3">
                {n.title && <div className="font-medium">{n.title}</div>}
                {n.body && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{n.body}</p>}
              </div>
            )}
            {n.whatsApp && (
              <div className="text-muted-foreground">
                WhatsApp: {titleCase(n.whatsApp.status)}
                {n.whatsApp.deliveredAt && ` · delivered ${new Date(n.whatsApp.deliveredAt).toLocaleString()}`}
                {n.whatsApp.readAt && ` · read ${new Date(n.whatsApp.readAt).toLocaleString()}`}
                {n.whatsApp.error && ` · ${n.whatsApp.error}`}
              </div>
            )}
            {n.logs.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground uppercase">Attempts</div>
                <ul className="grid gap-1">
                  {n.logs.map((l) => (
                    <li key={l.id} className="flex flex-wrap justify-between gap-2 border-b pb-1 last:border-0">
                      <span>
                        #{l.attempt} {titleCase(l.status)} {l.provider && <span className="text-muted-foreground">via {l.provider}</span>}
                        {l.error && <span className="block text-xs text-muted-foreground">{l.error}</span>}
                      </span>
                      <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {canRetry && (
            <Button
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(id, {
                  onSuccess: () => toast.success("Queued for another attempt"),
                  onError: (e) => toast.error(errorText(e, "Could not retry")),
                })
              }
            >
              Retry now
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestDialog({ onClose }: { onClose: () => void }) {
  const send = useSendTest();
  const { me } = usePermissions();
  const [channel, setChannel] = useState<"EMAIL" | "WHATSAPP">("EMAIL");
  const [to, setTo] = useState(me?.user.email ?? "");
  const [event, setEvent] = useState<NotificationEvent>("BOOKING_CONFIRMED");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a test message</DialogTitle>
          <DialogDescription>Uses the customer template for the chosen message with sample booking details.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="t-channel">Channel</Label>
            <Select
              value={channel}
              onValueChange={(v) => {
                setChannel(v as "EMAIL" | "WHATSAPP");
                setTo(v === "EMAIL" ? (me?.user.email ?? "") : (me?.user.phone ?? ""));
              }}
            >
              <SelectTrigger id="t-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-event">Message</Label>
            <Select value={event} onValueChange={(v) => setEvent(v as NotificationEvent)}>
              <SelectTrigger id="t-event">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFICATION_EVENTS.map((e) => (
                  <SelectItem key={e} value={e}>
                    {NOTIFICATION_EVENT_LABELS[e]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="t-to">{channel === "EMAIL" ? "Email address" : "Mobile number"}</Label>
            <Input id="t-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === "EMAIL" ? "you@example.com" : "0300 1234567"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={to.trim().length < 5 || send.isPending}
            onClick={() =>
              send.mutate(
                { channel, to: to.trim(), event },
                {
                  onSuccess: (n) => {
                    if (n.status === "SENT") toast.success("Test message sent");
                    else toast.error(`Not sent: ${n.lastError ?? titleCase(n.status)}`);
                    onClose();
                  },
                  onError: (e) => toast.error(errorText(e, "Could not send")),
                },
              )
            }
          >
            {send.isPending ? "Sending…" : "Send test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
