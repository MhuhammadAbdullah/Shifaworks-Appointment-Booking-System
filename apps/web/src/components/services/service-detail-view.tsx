"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { CONCERN_CHECKLIST_LABEL, SERVICE_DEFINITIONS, isServiceSlug, type ServiceDto } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CheckField } from "@/components/forms/check-field";
import { Field, fieldA11y } from "@/components/forms/field";
import { ServiceOpenBadge } from "@/components/services/service-open-badge";
import { PackagesCard } from "@/components/services/packages-card";
import { ConcernOptionsCard } from "@/components/services/concern-options-card";
import { usePermissions } from "@/lib/auth/hooks";
import { useProviders, useService, useSetServiceProviders, useUpdateService } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api-client";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Opened as a popup from the Services list — every service links here, nothing else does. */
export function ServiceDetailView({ slug }: { slug: string }) {
  const { can } = usePermissions();
  const { data: service, isPending, error } = useService(slug);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !service) return <p className="text-destructive">{error?.message ?? "Service not found"}</p>;

  const def = isServiceSlug(service.slug) ? SERVICE_DEFINITIONS[service.slug] : null;
  const concernLabel = isServiceSlug(service.slug) ? CONCERN_CHECKLIST_LABEL[service.slug] : undefined;
  const canEdit = can("services.update");

  return (
    <div className="grid gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{service.name}</h1>
          <ServiceOpenBadge service={service} />
        </div>
        <a
          href={`/${service.slug}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Booking form: /{service.slug} <ExternalLink className="size-3" />
        </a>
      </div>

      <StatusCard service={service} readOnly={!canEdit} />
      <PackagesCard service={service} packageNoun={def?.packageNoun ?? "option"} readOnly={!can("services.manage_packages")} />
      {concernLabel && (
        <ConcernOptionsCard service={service} fieldLabel={concernLabel} readOnly={!can("services.manage_concern_options")} />
      )}
      <ProvidersCard service={service} readOnly={!canEdit} />
      <TimingCard service={service} readOnly={!canEdit} />
    </div>
  );
}

function StatusCard({ service, readOnly }: { service: ServiceDto; readOnly: boolean }) {
  const update = useUpdateService(service.id);
  const toggle = (body: { isActive?: boolean; bookingEnabled?: boolean; deliveryModeVisible?: boolean }, message: string) =>
    update.mutate(body, { onSuccess: () => toast.success(message), onError: (e) => toast.error(errorText(e, "Could not save")) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registration</CardTitle>
        <CardDescription>
          The form accepts bookings only when the service is active and bookings are enabled. Otherwise customers see
          “Registration Closed” with the support contacts, and the server refuses submissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <CheckField
          id="svc-active"
          label="Service active"
          description="Switch off when the service is not offered at all"
          checked={service.isActive}
          disabled={readOnly || update.isPending}
          onCheckedChange={(v) => toggle({ isActive: v }, v ? "Service activated" : "Service deactivated")}
        />
        <CheckField
          id="svc-booking"
          label="Accepting bookings"
          description="Switch off to pause new bookings temporarily"
          checked={service.bookingEnabled}
          disabled={readOnly || update.isPending}
          onCheckedChange={(v) => toggle({ bookingEnabled: v }, v ? "Bookings enabled" : "Bookings paused")}
        />
        {service.slug !== "hijama-therapy" && (
          <CheckField
            id="svc-delivery-mode"
            label={`"In person or online" question`}
            description="Switch off to hide it from this service's form entirely"
            checked={service.deliveryModeVisible}
            disabled={readOnly || update.isPending}
            onCheckedChange={(v) => toggle({ deliveryModeVisible: v }, v ? "Question shown" : "Question hidden")}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ProvidersCard({ service, readOnly }: { service: ServiceDto; readOnly: boolean }) {
  // Not filtered by type: a provider may do both disciplines, so any provider can be offered here.
  const providers = useProviders({ pageSize: 100 });
  const save = useSetServiceProviders(service.id);
  const initial = new Map(service.providers.map((p) => [p.id, p.linkActive]));
  const [selected, setSelected] = useState(initial);
  useEffect(() => setSelected(new Map(service.providers.map((p) => [p.id, p.linkActive]))), [service.providers]);

  const dirty =
    selected.size !== initial.size || [...selected].some(([id, active]) => !initial.has(id) || initial.get(id) !== active);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Providers</CardTitle>
        <CardDescription>
          Who customers can choose on this form. Gender matching comes from each provider&apos;s profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {providers.isPending && <Skeleton className="h-20 w-full sm:col-span-2" />}
        {providers.data?.data.length === 0 && (
          <p className="text-sm text-muted-foreground sm:col-span-2">
            No providers yet. <Link href="/admin/providers" className="underline">Add one</Link>.
          </p>
        )}
        {providers.data?.data.map((p) => (
          <label key={p.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
            <Checkbox
              disabled={readOnly}
              checked={selected.has(p.id)}
              onCheckedChange={(c) =>
                setSelected((s) => {
                  const next = new Map(s);
                  if (c) next.set(p.id, true);
                  else next.delete(p.id);
                  return next;
                })
              }
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{p.displayName}</span>
              <span className="block text-xs text-muted-foreground">
                {p.designation ?? p.providerType.toLowerCase()} · accepts{" "}
                {[p.acceptsMale && "male", p.acceptsFemale && "female"].filter(Boolean).join(" & ")}
                {!p.isActive && " · inactive"}
              </span>
            </span>
          </label>
        ))}
      </CardContent>
      {!readOnly && (
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setSelected(initial)}>
            Reset
          </Button>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(
                { providers: [...selected].map(([providerId, isActive]) => ({ providerId, isActive })) },
                { onSuccess: () => toast.success("Providers saved"), onError: (e) => toast.error(errorText(e, "Could not save")) },
              )
            }
          >
            Save providers
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

const timingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000),
  defaultDurationMinutes: z.coerce.number().int().min(5).max(480),
  bufferBeforeMinutes: z.coerce.number().int().min(0).max(240),
  bufferAfterMinutes: z.coerce.number().int().min(0).max(240),
  slotIntervalMinutes: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().min(5).max(480).nullable()),
  minNoticeHours: z.coerce.number().min(0).max(720),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
});
type TimingValues = z.input<typeof timingSchema>;

const toTiming = (s: ServiceDto): TimingValues => ({
  name: s.name,
  description: s.description ?? "",
  defaultDurationMinutes: s.defaultDurationMinutes,
  bufferBeforeMinutes: s.bufferBeforeMinutes,
  bufferAfterMinutes: s.bufferAfterMinutes,
  slotIntervalMinutes: s.slotIntervalMinutes ?? "",
  minNoticeHours: s.minNoticeMinutes / 60,
  maxAdvanceDays: s.maxAdvanceDays,
});

function TimingCard({ service, readOnly }: { service: ServiceDto; readOnly: boolean }) {
  const update = useUpdateService(service.id);
  const form = useForm<TimingValues, unknown, z.output<typeof timingSchema>>({
    resolver: zodResolver(timingSchema),
    defaultValues: toTiming(service),
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  useEffect(() => form.reset(toTiming(service)), [service, form]);

  const onSubmit = form.handleSubmit(async ({ minNoticeHours, description, ...v }) => {
    try {
      await update.mutateAsync({ ...v, description: description || null, minNoticeMinutes: Math.round(minNoticeHours * 60) });
      toast.success("Saved");
    } catch (e) {
      toast.error(errorText(e, "Could not save"));
    }
  });

  const num = (name: keyof TimingValues, label: string, info?: string, optional?: boolean) => (
    <Field id={`t-${name}`} label={label} error={errors[name]?.message} required={!optional} optional={optional} {...(info ? { info } : {})}>
      <Input type="number" min={0} {...fieldA11y(`t-${name}`, errors[name]?.message)} {...form.register(name)} />
    </Field>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details &amp; timing</CardTitle>
        <CardDescription>Slots are generated from these values; packages may set their own duration.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly}>
          <CardContent className="grid gap-4">
            <Field id="t-name" label="Name" error={errors.name?.message} required>
              <Input {...fieldA11y("t-name", errors.name?.message)} {...form.register("name")} />
            </Field>
            <Field
              id="t-description"
              label="Description"
              error={errors.description?.message}
              optional
              info="Shown at the top of the public booking form"
            >
              <Textarea rows={3} {...fieldA11y("t-description", errors.description?.message)} {...form.register("description")} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              {num("defaultDurationMinutes", "Default duration (min)")}
              {num("bufferBeforeMinutes", "Buffer before (min)", "Preparation time added before each appointment")}
              {num("bufferAfterMinutes", "Buffer after (min)", "Cleaning / notes time added after each appointment")}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {num("slotIntervalMinutes", "Start every (min)", "Leave empty to space slots by duration + buffer after", true)}
              {num("minNoticeHours", "Minimum notice (hours)", "How far ahead a booking must be made")}
              {num("maxAdvanceDays", "Book up to (days ahead)", "Furthest date a customer can book")}
            </div>
          </CardContent>
        </fieldset>
        {!readOnly && (
          <CardFooter className="mt-4 justify-end">
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}
