"use client";

import Link from "next/link";
import { AlertTriangle, CalendarPlus, ChartColumn, FileText, Plus, Ticket, UserPlus } from "lucide-react";
import { PAYMENT_METHOD_LABELS } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { ColumnChart, StatTile } from "@/components/charts/bar-list";
import { AppointmentStatusBadge } from "@/components/appointments/appointment-status-badge";
import { usePermissions } from "@/lib/auth/hooks";
import { useAdminDashboard } from "@/lib/api/reports";
import { formatDateTime, formatMoney, formatTime, titleCase } from "@/lib/format";
import type { AppointmentStatus } from "@booking/shared";

export default function AdminDashboardPage() {
  const { me, can } = usePermissions();
  const { data: d, isPending, error } = useAdminDashboard();
  const cur = d?.currency ?? me?.organization.currency ?? "PKR";
  const m = (v: string | number) => formatMoney(v, cur);

  const actions = [
    can("appointments.create") && { href: "/admin/appointments/new", label: "New appointment", icon: CalendarPlus },
    can("events.create") && { href: "/admin/events/new", label: "New event", icon: Ticket },
    can("customers.create") && { href: "/admin/customers", label: "Add customer", icon: UserPlus },
    can("invoices.create") && { href: "/admin/invoices/new", label: "New invoice", icon: FileText },
    can("reports.view") && { href: "/admin/reports", label: "Reports", icon: ChartColumn },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Plus }[];

  return (
    <>
      <PageHeader
        title={`Welcome, ${me?.user.firstName ?? ""}`}
        description={d ? `Today in ${d.timezone.replace("_", " ")} · updated ${new Date(d.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.href} variant="outline" size="sm" asChild>
                <Link href={a.href}>
                  <a.icon className="size-4" /> {a.label}
                </Link>
              </Button>
            ))}
          </div>
        }
      />
      {error && <p className="text-destructive">{error.message}</p>}
      {isPending && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {d && (
        <div className="grid gap-6">
          {d.attention.length > 0 && (
            <div className="flex flex-wrap gap-2" role="list" aria-label="Needs attention">
              {d.attention.map((a) => (
                <Link
                  role="listitem"
                  key={a.key}
                  href={a.href}
                  className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                >
                  <AlertTriangle className="size-4" /> <span className="font-semibold tabular-nums">{a.count}</span> {a.label}
                </Link>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {d.revenue && (
              <StatTile
                label="Net revenue this month"
                value={m(d.revenue.monthNet)}
                hint={`Last month ${m(d.revenue.previousMonthNet)}`}
                tone={Number(d.revenue.monthNet) < 0 ? "negative" : undefined}
              />
            )}
            {d.appointments && <StatTile label="Appointments today" value={String(d.appointments.today)} hint={`${d.appointments.week} in the next 7 days`} />}
            {d.events && <StatTile label="Tickets sold this month" value={String(d.events.monthTicketsSold)} />}
            {d.customers && <StatTile label="Customers" value={String(d.customers.total)} hint={`${d.customers.newThisMonth} new this month`} />}
            {d.payments && <StatTile label="Awaiting payment" value={m(d.payments.pendingAmount)} hint={`${d.payments.pendingCount} booking${d.payments.pendingCount === 1 ? "" : "s"}`} />}
            {d.appointments && <StatTile label="Cancelled this month" value={String(d.appointments.monthCancelled)} hint={`${d.appointments.monthNoShows} no-show${d.appointments.monthNoShows === 1 ? "" : "s"}`} />}
          </div>

          {d.appointments && (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Today&apos;s appointments</CardTitle>
                  <Link href="/admin/calendar" className="text-sm text-muted-foreground hover:text-foreground">
                    Calendar
                  </Link>
                </CardHeader>
                <CardContent className="grid gap-1.5">
                  {d.appointments.todayList.length === 0 && <p className="text-sm text-muted-foreground">No appointments today.</p>}
                  {d.appointments.todayList.map((a) => (
                    <Link key={a.id} href={`/admin/appointments/${a.id}`} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                      <span className="w-28 font-medium tabular-nums">
                        {formatTime(a.startsAt, a.timezone)}–{formatTime(a.endsAt, a.timezone)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {a.customer} <span className="text-muted-foreground">· {a.service} · {a.provider}</span>
                      </span>
                      <AppointmentStatusBadge status={a.status as AppointmentStatus} />
                    </Link>
                  ))}
                  {d.appointments.today > d.appointments.todayList.length && (
                    <Link href="/admin/appointments" className="text-sm text-muted-foreground hover:text-foreground">
                      All {d.appointments.today} appointments today
                    </Link>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Provider schedule</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  {d.appointments.providerSchedule.length === 0 && <p className="text-muted-foreground">Nobody is booked today.</p>}
                  {d.appointments.providerSchedule.map((s) => (
                    <div key={s.providerId} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0">
                      <div>
                        <div className="font-medium">{s.provider}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.firstStart && s.lastEnd && `${formatTime(s.firstStart, d.timezone)}–${formatTime(s.lastEnd, d.timezone)}`}
                          {s.next ? ` · next ${formatTime(s.next, d.timezone)}` : " · done for today"}
                        </div>
                      </div>
                      <span className="tabular-nums text-muted-foreground">{s.count}</span>
                    </div>
                  ))}
                  {d.appointments.pendingConfirmation > 0 && (
                    <p className="pt-1 text-xs text-muted-foreground">{d.appointments.pendingConfirmation} upcoming appointment(s) still pending.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {(d.revenue || d.events) && (
            <div className="grid gap-6 lg:grid-cols-3">
              {d.revenue && (
                <Card className="lg:col-span-2">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Net revenue, last 30 days</CardTitle>
                    <span className="text-sm text-muted-foreground">Today {m(d.revenue.todayIncome)}</span>
                  </CardHeader>
                  <CardContent>
                    <ColumnChart
                      label="Net revenue per day"
                      points={d.revenue.trend.map((p) => ({ label: new Date(`${p.date}T00:00`).toLocaleDateString([], { day: "numeric", month: "short" }), value: Number(p.net) }))}
                      format={m}
                    />
                  </CardContent>
                </Card>
              )}
              {d.events && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Upcoming events</CardTitle>
                    <Link href="/admin/events" className="text-sm text-muted-foreground hover:text-foreground">
                      All events
                    </Link>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    {d.events.upcoming.length === 0 && <p className="text-muted-foreground">No upcoming events.</p>}
                    {d.events.upcoming.map((e) => {
                      const pct = e.capacity ? Math.min(100, Math.round((e.sold / e.capacity) * 100)) : 0;
                      return (
                        <Link key={e.id} href={`/admin/events/${e.id}`} className="grid gap-1 hover:underline">
                          <div className="flex justify-between gap-2">
                            <span className="truncate font-medium">{e.name}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {e.sold}/{e.capacity ?? "∞"}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(e.startsAt, e.timezone)}</div>
                          <div className="h-1.5 rounded bg-muted" aria-hidden>
                            <div className="h-full rounded bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                        </Link>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {(d.recentBookings || d.payments) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {d.recentBookings && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recent bookings</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-1 text-sm">
                    {d.recentBookings.length === 0 && <p className="text-muted-foreground">No bookings yet.</p>}
                    {d.recentBookings.map((b) => (
                      <Link key={b.id} href={b.href} className="flex items-center justify-between gap-2 border-b py-1.5 last:border-0 hover:bg-accent">
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{b.customer}</span> <span className="text-muted-foreground">· {b.item}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          {titleCase(b.status)} · {m(b.totalAmount)}
                        </span>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              )}
              {d.payments && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Recent payments</CardTitle>
                    <Link href="/admin/payments" className="text-sm text-muted-foreground hover:text-foreground">
                      All payments
                    </Link>
                  </CardHeader>
                  <CardContent className="grid gap-1 text-sm">
                    {d.payments.recent.length === 0 && <p className="text-muted-foreground">No payments yet.</p>}
                    {d.payments.recent.map((p) => (
                      <Link key={p.id} href={`/admin/payments/${p.id}`} className="flex items-center justify-between gap-2 border-b py-1.5 last:border-0 hover:bg-accent">
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{p.customer ?? p.paymentNumber}</span>{" "}
                          <span className="text-muted-foreground">
                            · {PAYMENT_METHOD_LABELS[p.method]}
                            {p.paidAt && ` · ${new Date(p.paidAt).toLocaleDateString()}`}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums">{formatMoney(p.amount, p.currency)}</span>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
