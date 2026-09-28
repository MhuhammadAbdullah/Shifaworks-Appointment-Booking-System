"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PROVIDER_TYPE_LABELS } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { AvailabilityEditor } from "@/components/availability/availability-editor";
import { CheckField } from "@/components/forms/check-field";
import { Pagination } from "@/components/tables/pagination";
import { usePermissions } from "@/lib/auth/hooks";
import { useAddHoliday, useHolidays, useProvider, useProviders, useRemoveHoliday } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api-client";
import { usePagedItems } from "@/lib/hooks/use-paged-items";
import { weekdayLabel } from "@/lib/format";

export default function AvailabilityPage() {
  return (
    <Suspense>
      <Availability />
    </Suspense>
  );
}

function Availability() {
  const { can } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const providerId = useSearchParams().get("provider");
  const providers = useProviders({ pageSize: 100 });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Availability"
        description="Custom hours by date, leave and blocked time per provider, plus clinic holidays. Booking forms only offer times computed from these."
      />
      <div className="grid max-w-sm gap-1.5">
        <Label htmlFor="av-provider">Provider</Label>
        <Select value={providerId ?? ""} onValueChange={(v) => router.replace(`${pathname}?provider=${v}`)}>
          <SelectTrigger id="av-provider">
            <SelectValue placeholder={providers.isPending ? "Loading…" : "Choose a provider"} />
          </SelectTrigger>
          <SelectContent>
            {providers.data?.data.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName} · {PROVIDER_TYPE_LABELS[p.providerType]}
                {!p.isActive && " (inactive)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {providerId && <ProviderAvailability providerId={providerId} canEdit={can("availability.manage_all")} />}
      <HolidaysCard canEdit={can("availability.manage_all")} />
    </div>
  );
}

function ProviderAvailability({ providerId, canEdit }: { providerId: string; canEdit: boolean }) {
  const { data: provider, isPending, error } = useProvider(providerId);
  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (error || !provider) return <p className="text-destructive">{error?.message ?? "Provider not found"}</p>;
  return <AvailabilityEditor providerId={provider.id} readOnly={!canEdit} />;
}

function HolidaysCard({ canEdit }: { canEdit: boolean }) {
  const holidays = useHolidays();
  const add = useAddHoliday();
  const remove = useRemoveHoliday();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [isRecurring, setRecurring] = useState(false);
  const paged = usePagedItems(holidays.data);

  function submit() {
    if (name.trim().length < 2 || !date) return toast.error("Enter a name and a date");
    add.mutate(
      { name: name.trim(), date, isRecurring },
      {
        onSuccess: () => {
          toast.success("Holiday added");
          setName("");
          setDate("");
          setRecurring(false);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not add"),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinic holidays</CardTitle>
        <CardDescription>The clinic is closed for every provider on these dates (e.g. Eid). Recurring dates repeat every year.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {holidays.isPending && <Skeleton className="h-16 w-full" />}
        {holidays.data?.length === 0 && <p className="text-sm text-muted-foreground">No holidays.</p>}
        <ul className="grid gap-2">
          {paged.pageItems.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <span>
                <span className="font-medium">{h.name}</span> · {weekdayLabel(h.date)} {h.date.slice(0, 4)}
                {h.isRecurring && <span className="text-muted-foreground"> · every year</span>}
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${h.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(h.id, { onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not remove") })}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Pagination meta={paged.meta} onPage={paged.setPage} noun="holidays" />
        {canEdit && (
          <div className="grid gap-3 rounded-md bg-muted/50 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="hol-name">Name</Label>
              <Input id="hol-name" placeholder="e.g. Eid ul-Fitr" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="hol-date">Date</Label>
              <Input id="hol-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="pb-2">
              <CheckField id="hol-recurring" label="Every year" checked={isRecurring} onCheckedChange={setRecurring} />
            </div>
            <Button onClick={submit} disabled={add.isPending}>
              Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
