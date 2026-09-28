"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { PROVIDER_TYPE_LABELS } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { ServiceOpenBadge } from "@/components/services/service-open-badge";
import { ServiceDetailDialog } from "@/components/services/service-detail-dialog";
import { useServices } from "@/lib/api/catalog";
import { formatDuration, formatMoney } from "@/lib/format";

export default function ServicesPage() {
  const { data, isPending, error } = useServices();
  const [viewingSlug, setViewingSlug] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="Services"
        description="The five ShifaWorks booking forms. Open or close a form, set timing, and manage packages and providers."
      />
      {isPending && <Skeleton className="h-64 w-full" />}
      {error && <p className="text-destructive">{error.message}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((s) => {
          const activePackages = s.packages.filter((p) => p.isActive);
          const prices = activePackages.map((p) => Number(p.price));
          const activeProviders = s.providers.filter((p) => p.isActive && p.linkActive);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setViewingSlug(s.slug)}
              className="rounded-xl text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Card className="h-full cursor-pointer transition-colors hover:bg-accent/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    <ServiceOpenBadge service={s} />
                  </div>
                  <CardDescription className="flex items-center gap-1">
                    /{s.slug} <ExternalLink className="size-3" aria-hidden />
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    {s.providerType && <Badge variant="outline">{PROVIDER_TYPE_LABELS[s.providerType]}s</Badge>}
                    <Badge variant="outline">{formatDuration(s.defaultDurationMinutes)}</Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {activeProviders.length} active provider{activeProviders.length === 1 ? "" : "s"} ·{" "}
                    {activePackages.length} option{activePackages.length === 1 ? "" : "s"}
                    {prices.length > 0 &&
                      ` · ${formatMoney(Math.min(...prices), s.currency)}${
                        Math.max(...prices) !== Math.min(...prices) ? `–${formatMoney(Math.max(...prices), s.currency)}` : ""
                      }`}
                  </p>
                  {s.open && activeProviders.length === 0 && (
                    <p className="text-amber-700 dark:text-amber-400">Open, but no active provider: customers cannot book.</p>
                  )}
                  {s.open && activePackages.length === 0 && (
                    <p className="text-amber-700 dark:text-amber-400">Open, but no active package or session type.</p>
                  )}
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
      {viewingSlug && <ServiceDetailDialog slug={viewingSlug} onClose={() => setViewingSlug(null)} />}
    </div>
  );
}
