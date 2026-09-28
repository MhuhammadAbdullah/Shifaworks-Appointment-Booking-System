"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { EMAIL_TEMPLATE_KEY_LABELS } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NotificationStatusBadge, DeliveryStatusBadge } from "@/components/notifications/status-badges";
import { useNotification, useRetryNotification } from "@/lib/api/notifications";
import { usePermissions } from "@/lib/auth/hooks";
import { ApiError } from "@/lib/api-client";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function NotificationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const { data: n, isPending, error } = useNotification(id);
  const retry = useRetryNotification();

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !n) return <p className="text-destructive">{error?.message ?? "Notification not found"}</p>;

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/notifications" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Email log
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{EMAIL_TEMPLATE_KEY_LABELS[n.templateKey]}</h1>
            <div className="mt-1">
              <NotificationStatusBadge status={n.status} />
            </div>
          </div>
          {can("notifications.send") && (n.status === "FAILED" || n.status === "SKIPPED") && (
            <Button
              variant="outline"
              disabled={retry.isPending}
              onClick={() => retry.mutate(id, { onSuccess: () => toast.success("Queued for another attempt"), onError: (e) => toast.error(errorText(e, "Could not retry")) })}
            >
              <RotateCcw className="size-4" /> Retry
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Audience" value={n.audience} />
          <Row label="Recipient" value={n.recipient.name ? `${n.recipient.name} <${n.recipient.email ?? "-"}>` : (n.recipient.email ?? "-")} />
          <Row label="Attempts" value={String(n.attempts)} />
          <Row label="Sent" value={n.sentAt ? new Date(n.sentAt).toLocaleString("en-GB") : "-"} />
          {n.booking && (
            <div>
              <div className="text-muted-foreground">Booking</div>
              <Link href={`/admin/bookings/${n.booking.id}`} className="font-mono font-medium hover:underline">
                {n.booking.bookingNumber}
              </Link>
            </div>
          )}
          {n.lastError && (
            <div className="sm:col-span-2">
              <div className="text-muted-foreground">Last error</div>
              <p className="text-destructive">{n.lastError}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {n.subject && (
        <Card>
          <CardHeader>
            <CardTitle>Rendered message</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Row label="Subject" value={n.subject} />
            {n.body && (
              <div className="overflow-hidden rounded-md border">
                <iframe title="Email preview" srcDoc={n.body} className="h-64 w-full bg-white" sandbox="" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {n.logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Delivery attempts</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {n.logs.map((l) => (
              <div key={l.id} className="flex items-center justify-between border-b pb-1.5 last:border-0">
                <span>#{l.attempt} · {new Date(l.createdAt).toLocaleString("en-GB")}</span>
                <DeliveryStatusBadge status={l.status} />
                {l.error && <span className="max-w-xs truncate text-destructive" title={l.error}>{l.error}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{value}</div>
    </div>
  );
}
