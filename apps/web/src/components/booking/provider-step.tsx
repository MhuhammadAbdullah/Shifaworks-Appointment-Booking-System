"use client";

import type { PublicProviderDto, PublicServiceDto, ServiceSlug } from "@booking/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/forms/field";
import { usePublicProviders } from "@/lib/api/public";
import type { BaseBookingValues, StepProps } from "./wizard-types";
import { SupportInline } from "./support-inline";

export function ProviderStep<TValues extends BaseBookingValues>({
  form,
  slug,
  service,
  providerNoun,
  onSelect,
}: StepProps<TValues> & { slug: ServiceSlug; service: PublicServiceDto; providerNoun: string; onSelect: (provider: PublicProviderDto) => void }) {
  const values = form.watch();
  const gender = values.personal.gender;
  const providers = usePublicProviders(slug, gender, Boolean(gender));
  const selectedId = values.providerId;
  const error = (form.formState.errors as Record<string, { message?: string } | undefined>).providerId?.message;

  function choose(id: string) {
    const p = providers.data?.find((x) => x.id === id);
    if (!p) return;
    form.setValue("providerId" as never, id as never, { shouldDirty: true, shouldValidate: true });
    onSelect(p);
  }

  if (!gender) {
    return <p className="text-sm text-muted-foreground">Choose your gender above to see available {providerNoun}s.</p>;
  }
  if (providers.isPending) return <Skeleton className="h-9 w-full" />;
  if (providers.error) return <p className="text-sm text-destructive">{providers.error.message}</p>;
  if (providers.data?.length === 0) {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm">
        <p className="mb-2">No {providerNoun}s are available for this right now.</p>
        <SupportInline support={service.support} />
      </div>
    );
  }

  return (
    <Field id="f-provider" label={providerNoun.charAt(0).toUpperCase() + providerNoun.slice(1)} required error={error}>
      <Select value={selectedId || undefined} onValueChange={choose}>
        <SelectTrigger id="f-provider" className="w-full" aria-invalid={Boolean(error)}>
          <SelectValue placeholder={`Choose a ${providerNoun}`} />
        </SelectTrigger>
        <SelectContent>
          {providers.data?.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.displayName}
              {p.designation ? ` - ${p.designation}` : ""}
              {p.rating ? ` (★ ${p.rating})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
