"use client";

import Link from "next/link";
import { CalendarCheck, Clock, UserRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { BookingStatusBadge } from "@/components/bookings/status-badges";
import { useBookings } from "@/lib/api/bookings";
import { useMe } from "@/lib/auth/hooks";
import { formatDateTime, localDate } from "@/lib/format";

export default function ProviderHomePage() {
  const { data: me } = useMe();
  const today = localDate(new Date(), me?.organization.timezone ?? "Asia/Karachi");
  const todays = useBookings({ page: 1, pageSize: 10, status: "CONFIRMED", from: today, to: today, sort: "asc" });

  const links = [
    { href: "/provider/appointments", icon: CalendarCheck, title: "My appointments", text: "Search your full appointment history." },
    { href: "/provider/availability", icon: Clock, title: "My availability", text: "Weekly hours, specific dates, leave and blocked time." },
    { href: "/provider/profile", icon: UserRound, title: "My profile", text: "Photo, designation and bio customers see." },
  ];

  return (
    <div>
      <PageHeader title={me ? `Assalamu alaikum, ${me.user.firstName}` : "Dashboard"} description="Only ever your own appointments." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="size-4" /> Today
          </CardTitle>
          <CardDescription>{today}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {todays.isPending && <Skeleton className="h-20 w-full" />}
          {todays.data?.data.length === 0 && <p className="text-sm text-muted-foreground">Nothing scheduled today.</p>}
          {todays.data?.data.map((b) => (
            <Link key={b.id} href={`/provider/appointments/${b.id}`} className="flex items-center justify-between rounded-md border p-2 text-sm hover:bg-accent/50">
              <span>
                <span className="font-medium">{formatDateTime(b.startsAt, b.timezone).split(",").pop()?.trim()}</span> · {b.customerName}
              </span>
              <BookingStatusBadge status={b.status} />
            </Link>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
            <Card className="h-full transition-colors hover:bg-accent/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <l.icon className="size-4" /> {l.title}
                </CardTitle>
                <CardDescription>{l.text}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
