"use client";

import Link from "next/link";
import { REPORTS, REPORT_TYPES } from "@booking/shared";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/app-shell";

const GROUPS: { title: string; types: (typeof REPORT_TYPES)[number][] }[] = [
  { title: "Bookings & schedule", types: ["bookings", "appointments", "providers", "cancellations", "no-shows"] },
  { title: "Money", types: ["revenue", "payments", "expenses"] },
  { title: "Events & customers", types: ["events", "event-attendance", "customers"] },
];

export default function ReportsIndexPage() {
  return (
    <>
      <PageHeader title="Reports" description="Pick a report, then narrow it by date, provider, service, category, location or status. Every report exports to CSV." />
      <div className="grid gap-8">
        {GROUPS.map((g) => (
          <section key={g.title} className="grid gap-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase">{g.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.types.map((t) => (
                <Link key={t} href={`/admin/reports/${t}`}>
                  <Card className="h-full transition-colors hover:bg-accent">
                    <CardHeader>
                      <CardTitle className="text-base">{REPORTS[t].title}</CardTitle>
                      <CardDescription>{REPORTS[t].description}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
