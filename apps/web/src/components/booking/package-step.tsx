"use client";

import type { PublicPackageDto, PublicServiceDto } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/forms/field";
import { formatDuration, formatMoney } from "@/lib/format";
import { SupportInline } from "./support-inline";
import type { BaseBookingValues, StepProps } from "./wizard-types";

export function PackageStep<TValues extends BaseBookingValues>({
  form,
  service,
  packageNoun,
  onSelect,
}: StepProps<TValues> & { service: PublicServiceDto; packageNoun: string; onSelect: (pkg: PublicPackageDto) => void }) {
  const selectedId = form.watch().packageId;
  const error = (form.formState.errors as Record<string, { message?: string } | undefined>).packageId?.message;
  const selected = service.packages.find((p) => p.id === selectedId);

  function choose(id: string) {
    const p = service.packages.find((x) => x.id === id);
    if (!p) return;
    form.setValue("packageId" as never, id as never, { shouldDirty: true, shouldValidate: true });
    onSelect(p);
  }

  if (service.packages.length === 0) {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm">
        <p className="mb-2">Nothing is available to book right now.</p>
        <SupportInline support={service.support} />
      </div>
    );
  }

  const label = packageNoun.charAt(0).toUpperCase() + packageNoun.slice(1);
  return (
    <Field id="f-package" label={label} required error={error}>
      <Select value={selectedId || undefined} onValueChange={choose}>
        <SelectTrigger id="f-package" className="w-full" aria-invalid={Boolean(error)}>
          <SelectValue placeholder={`Choose a ${packageNoun}`} />
        </SelectTrigger>
        <SelectContent>
          {service.packages.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              {p.points !== null ? ` (${p.points}-point)` : ""} - {formatMoney(p.price, service.currency)}
              {p.discountPercent ? ` (${p.discountPercent}% off)` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-sm">
          {selected.originalPrice && (
            <span className="text-muted-foreground line-through">{formatMoney(selected.originalPrice, service.currency)}</span>
          )}
          <span className="font-semibold">{formatMoney(selected.price, service.currency)}</span>
          {selected.discountPercent && (
            <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {selected.discountPercent}% OFF
            </Badge>
          )}
          <span className="text-muted-foreground">· {formatDuration(selected.durationMinutes)}</span>
        </div>
      )}
    </Field>
  );
}
