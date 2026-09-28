"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarCheck, CalendarPlus, Landmark, Receipt, Users, Wallet, XCircle } from "lucide-react";
import { BOOKING_STATUS_LABELS, type BookingStatus } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/dashboard/app-shell";
import { DonutChart, InitialsAvatar, KpiCard, pctDelta, TrendChart } from "@/components/dashboard/charts";
import { BookingStatusBadge } from "@/components/bookings/status-badges";
import { NewBookingDialog } from "@/components/bookings/new-booking-dialog";
import { useBookings } from "@/lib/api/bookings";
import { useFinanceSummary } from "@/lib/api/finance";
import { useNotifications } from "@/lib/api/notifications";
import { useReport } from "@/lib/api/reports";
import { useUsers } from "@/lib/api/admin";
import { usePermissions } from "@/lib/auth/hooks";
import { addDays, formatDate, formatMoney, localDate } from "@/lib/format";

const STATUS_HEX: Record<BookingStatus, string> = {
  PENDING_PAYMENT: "#f59e0b",
  PAYMENT_SUBMITTED: "#0ea5e9",
  PAYMENT_VERIFIED: "#0284c7",
  CONFIRMED: "#86C242",
  CANCELLED: "#a1a1aa",
  COMPLETED: "#8b5cf6",
  NO_SHOW: "#f43f5e",
  RESCHEDULED: "#a1a1aa",
};

const SERVICE_HEX = ["#22d3ee", "#818cf8", "#fbbf24", "#f472b6", "#a78bfa", "#4ade80"];

type Period = "today" | "week" | "month" | "custom";
const PERIOD_TABS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

/** Whole days between two YYYY-MM-DD strings, inclusive of both ends. */
function daySpan(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}

/** Monday of the ISO week containing `dateStr`. */
function startOfWeek(dateStr: string): string {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return addDays(dateStr, -((day + 6) % 7));
}

function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // day 0 of next month = last day of this one
  return `${dateStr.slice(0, 8)}${String(lastDay).padStart(2, "0")}`;
}

export default function AdminDashboardPage() {
  const { me, can } = usePermissions();
  const canSeeBookings = can("bookings.view_all");
  const canReports = can("reports.view");
  const canFinance = can("finance.view");
  const canStaff = can("staff.view");
  const tz = me?.organization.timezone ?? "Asia/Karachi";
  const today = localDate(new Date(), tz);

  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState(startOfMonth(today));
  const [customTo, setCustomTo] = useState(endOfMonth(today));
  const [creating, setCreating] = useState(false);

  // Calendar periods (not rolling windows) so a booking made today for a future date within
  // the current week/month still counts — a rolling "last N days ending today" window would
  // silently exclude it, since new bookings are almost always for a future appointment date.
  let rangeFrom: string;
  let rangeTo: string;
  let prevFrom: string;
  let prevTo: string;
  if (period === "today") {
    rangeFrom = rangeTo = today;
    prevFrom = prevTo = addDays(today, -1);
  } else if (period === "week") {
    rangeFrom = startOfWeek(today);
    rangeTo = addDays(rangeFrom, 6);
    prevFrom = addDays(rangeFrom, -7);
    prevTo = addDays(rangeTo, -7);
  } else if (period === "month") {
    rangeFrom = startOfMonth(today);
    rangeTo = endOfMonth(today);
    prevTo = addDays(rangeFrom, -1);
    prevFrom = startOfMonth(prevTo);
  } else {
    rangeFrom = customFrom;
    rangeTo = customTo;
    const spanDays = daySpan(rangeFrom, rangeTo);
    prevTo = addDays(rangeFrom, -1);
    prevFrom = addDays(prevTo, -(spanDays - 1));
  }

  const recentBookings = useBookings({ page: 1, pageSize: 20, sort: "desc" });
  const failedEmails = useNotifications({ page: 1, pageSize: 1, status: "FAILED" });
  const failedCount = can("notifications.view") ? (failedEmails.data?.meta?.total ?? 0) : 0;

  // dateField "createdAt": the dashboard answers "how much was booked in this period" (activity),
  // not "what's scheduled to happen in this period" (that's /admin/reports, which stays startsAt-based) —
  // a booking made today is almost always for a future appointment date, so startsAt would miss it.
  const bookingsReport = useReport("bookings", { from: rangeFrom, to: rangeTo, dateField: "createdAt" });
  const prevBookingsReport = useReport("bookings", { from: prevFrom, to: prevTo, dateField: "createdAt" });
  const financeSummary = useFinanceSummary(rangeFrom, rangeTo);
  const prevFinanceSummary = useFinanceSummary(prevFrom, prevTo);
  const staffCount = useUsers({ page: 1, pageSize: 1, status: "ACTIVE" });

  const bookingsTrend = bookingsReport.data?.daily.map((d) => ({ date: d.date, value: d.count })) ?? [];
  const revenueTrend = financeSummary.data?.daily.map((d) => ({ date: d.date, value: Number(d.income) - Number(d.outgoing) })) ?? [];
  const statusItems =
    bookingsReport.data?.byStatus.map((s) => ({
      key: s.status,
      label: BOOKING_STATUS_LABELS[s.status],
      value: s.count,
      color: STATUS_HEX[s.status],
    })) ?? [];
  const serviceItems =
    bookingsReport.data?.byService.slice(0, 6).map((s, i) => ({ key: s.serviceId, label: s.serviceName, value: s.count, color: SERVICE_HEX[i % SERVICE_HEX.length]! })) ??
    [];

  const rangeLabel =
    rangeFrom === rangeTo ? formatDate(`${rangeFrom}T00:00:00Z`, "UTC") : `${formatDate(`${rangeFrom}T00:00:00Z`, "UTC")} – ${formatDate(`${rangeTo}T00:00:00Z`, "UTC")}`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={me ? `Assalamu alaikum, ${me.user.firstName}` : "Dashboard"}
        description="Your practice at a glance, plus anything that needs attention."
        actions={
          can("bookings.create") && (
            <Button onClick={() => setCreating(true)}>
              <CalendarPlus className="size-4" /> New booking
            </Button>
          )
        }
      />

      {failedCount > 0 && (
        <Link
          href="/admin/notifications?status=FAILED"
          className="mb-6 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300"
        >
          <AlertTriangle className="size-4 shrink-0" />
          {failedCount} email{failedCount === 1 ? "" : "s"} failed to send. Review the log →
        </Link>
      )}

      {(canReports || canFinance || canStaff) && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <TabsList>
                {PERIOD_TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {period === "custom" ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="dash-from">From</Label>
                  <Input id="dash-from" type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="dash-to">To</Label>
                  <Input id="dash-to" type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">{rangeLabel}</span>
            )}
          </div>

          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {canReports && (
              <>
                <KpiCard
                  icon={CalendarCheck}
                  label="Total bookings"
                  value={bookingsReport.isPending ? "…" : String(bookingsReport.data?.total ?? 0)}
                  delta={
                    bookingsReport.data && prevBookingsReport.data
                      ? { value: pctDelta(bookingsReport.data.total, prevBookingsReport.data.total) }
                      : undefined
                  }
                  hint="vs. previous period"
                />
                <KpiCard
                  icon={XCircle}
                  label="Cancellation rate"
                  value={bookingsReport.isPending ? "…" : `${bookingsReport.data?.cancellationRatePercent ?? 0}%`}
                  delta={
                    bookingsReport.data && prevBookingsReport.data
                      ? { value: pctDelta(bookingsReport.data.cancellationRatePercent, prevBookingsReport.data.cancellationRatePercent), invert: true }
                      : undefined
                  }
                  hint={bookingsReport.data ? `No-show rate ${bookingsReport.data.noShowRatePercent}%` : undefined}
                />
              </>
            )}
            {canFinance && (
              <>
                <KpiCard
                  icon={Wallet}
                  label="Total income"
                  value={financeSummary.isPending ? "…" : formatMoney(financeSummary.data?.income ?? "0", financeSummary.data?.currency)}
                  delta={
                    financeSummary.data && prevFinanceSummary.data
                      ? { value: pctDelta(Number(financeSummary.data.income), Number(prevFinanceSummary.data.income)) }
                      : undefined
                  }
                  hint="vs. previous period"
                />
                <KpiCard
                  icon={Receipt}
                  label="Total expenses"
                  value={financeSummary.isPending ? "…" : formatMoney(financeSummary.data?.expenses ?? "0", financeSummary.data?.currency)}
                  delta={
                    financeSummary.data && prevFinanceSummary.data
                      ? { value: pctDelta(Number(financeSummary.data.expenses), Number(prevFinanceSummary.data.expenses)), invert: true }
                      : undefined
                  }
                  hint="vs. previous period"
                />
                <KpiCard
                  icon={Landmark}
                  label="Net revenue"
                  value={financeSummary.isPending ? "…" : formatMoney(financeSummary.data?.net ?? "0", financeSummary.data?.currency)}
                  delta={
                    financeSummary.data && prevFinanceSummary.data
                      ? { value: pctDelta(Number(financeSummary.data.net), Number(prevFinanceSummary.data.net)) }
                      : undefined
                  }
                  hint={financeSummary.data ? `Outstanding ${formatMoney(financeSummary.data.outstanding, financeSummary.data.currency)}` : undefined}
                />
              </>
            )}
            {canStaff && (
              <KpiCard
                icon={Users}
                label="Total staff"
                value={staffCount.isPending ? "…" : String(staffCount.data?.meta?.total ?? 0)}
                hint="Active accounts"
              />
            )}
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            {canReports && (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">Bookings trend</CardTitle>
                      <CardDescription>Daily bookings.</CardDescription>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{rangeLabel}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  {bookingsReport.isPending ? (
                    <Skeleton className="h-44 w-full" />
                  ) : (
                    <TrendChart
                      data={bookingsTrend}
                      color="#8535AA"
                      seriesLabel="Bookings"
                      formatValue={(v) => `${v} booking${v === 1 ? "" : "s"}`}
                    />
                  )}
                </CardContent>
              </Card>
            )}
            {canFinance && (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">Revenue trend</CardTitle>
                      <CardDescription>Net income by day.</CardDescription>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{rangeLabel}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  {financeSummary.isPending ? (
                    <Skeleton className="h-44 w-full" />
                  ) : (
                    <TrendChart
                      data={revenueTrend}
                      color="#8535AA"
                      seriesLabel="Net revenue"
                      formatValue={(v) => formatMoney(v, financeSummary.data?.currency)}
                    />
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {canReports && (
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bookings by status</CardTitle>
                  <CardDescription>{rangeLabel}</CardDescription>
                </CardHeader>
                <CardContent>
                  {bookingsReport.isPending ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <DonutChart items={statusItems} centerLabel="Total" />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top services</CardTitle>
                  <CardDescription>By booking count · {rangeLabel}</CardDescription>
                </CardHeader>
                <CardContent>
                  {bookingsReport.isPending ? <Skeleton className="h-40 w-full" /> : <DonutChart items={serviceItems} centerLabel="Total" />}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {canSeeBookings && (
        <Card className="mb-6">
          <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Recent bookings</CardTitle>
                  <CardDescription>The latest activity across every service and provider.</CardDescription>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/bookings">View all →</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Customer</TableHead>
                      <TableHead className="hidden md:table-cell">Service &amp; provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Amount</TableHead>
                      <TableHead className="hidden pr-6 lg:table-cell">Booked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentBookings.isPending && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Skeleton className="h-24 w-full" />
                        </TableCell>
                      </TableRow>
                    )}
                    {recentBookings.data?.data.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                          No bookings yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {recentBookings.data?.data.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="pl-6">
                          <Link href={`/admin/bookings/${b.id}`} className="flex items-center gap-2.5 hover:underline">
                            <InitialsAvatar name={b.customerName} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{b.customerName}</span>
                              <span className="block font-mono text-xs text-muted-foreground">{b.bookingNumber}</span>
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="hidden text-sm md:table-cell">
                          {b.serviceName}
                          <div className="text-xs text-muted-foreground">{b.providerName}</div>
                        </TableCell>
                        <TableCell>
                          <BookingStatusBadge status={b.status} />
                        </TableCell>
                        <TableCell className="hidden text-sm font-medium tabular-nums sm:table-cell">{formatMoney(b.amount, b.currency)}</TableCell>
                        <TableCell className="hidden pr-6 text-sm text-muted-foreground lg:table-cell">{formatDate(b.createdAt, b.timezone)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
      )}
      {creating && <NewBookingDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
