"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useForm, type DefaultValues, type FieldPath, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { CONCERN_CHECKLIST_FIELD, SERVICE_DEFINITIONS, type PublicPackageDto, type PublicProviderDto, type ServiceSlug } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api-client";
import { publicEnv } from "@/lib/env";
import { formatDate, formatTime12 } from "@/lib/format";
import { useServiceBootstrap, useSubmitBooking } from "@/lib/api/public";
import { HoneypotField, ReviewStep } from "./steps";
import { YourDetailsStep } from "./your-details-step";
import { DateTimeStep } from "./datetime-step";
import { RegistrationClosed } from "./registration-closed";
import { BookingSuccess } from "./booking-success";
import { WizardHeader } from "./wizard-header";
import { parseBookingPrefill } from "./prefill";
import type { BaseBookingValues, DetailsStepComponent } from "./wizard-types";

export interface BookingWizardProps<TValues extends BaseBookingValues> {
  slug: ServiceSlug;
  title: string;
  /** The full per-service Zod schema (hijamaBookingSchema, …) from @booking/shared. */
  schema: z.ZodType<TValues, TValues>;
  /** RHF's own (deep-partial) shape: required fields like `personal.gender` legitimately start unset. */
  defaultValues: DefaultValues<TValues>;
  DetailsStep: DetailsStepComponent<TValues>;
  detailsLabel: string;
}

/**
 * Your details (personal + provider + package + service-specific details,
 * all one screen) → Date & time → Review & payment → success. Collapsed from
 * the original 7 steps (personal/location/provider/package/date-time/
 * details/review) to the fewest reasonable — package still has to be picked
 * before date & time, since its duration decides which slots can even be
 * offered.
 */
export function BookingWizard<TValues extends BaseBookingValues>({
  slug,
  title,
  schema,
  defaultValues,
  DetailsStep,
  detailsLabel,
}: BookingWizardProps<TValues>) {
  const bootstrap = useServiceBootstrap(slug);
  const definition = SERVICE_DEFINITIONS[slug];
  const submit = useSubmitBooking();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<Awaited<ReturnType<typeof submit.mutateAsync>> | null>(null);
  const [provider, setProvider] = useState<PublicProviderDto | null>(null);
  const [pkg, setPkg] = useState<PublicPackageDto | null>(null);
  const [timezone, setTimezone] = useState(publicEnv.NEXT_PUBLIC_DEFAULT_TIMEZONE);
  // Stable for the lifetime of this attempt: a network retry of the same
  // click must not create a second booking. A fresh page load gets a new one.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const form = useForm<TValues>({
    // zodResolver's generics don't pin the schema's input type when the schema
    // itself is a type parameter; the runtime validation is correct regardless.
    resolver: zodResolver(schema) as Resolver<TValues>,
    defaultValues,
    mode: "onTouched",
  });

  // A link from a WordPress team page can arrive with package + time already chosen (the provider is
  // matched by ProviderStep, since the provider list only loads once the visitor has picked a gender).
  const searchParams = useSearchParams();
  const prefill = useMemo(() => parseBookingPrefill(searchParams), [searchParams]);
  const prefillApplied = useRef(false);
  const chosenStart = form.watch("startsAt" as FieldPath<TValues>) as unknown as string | undefined;
  const bootstrapData = bootstrap.data;
  useEffect(() => {
    if (prefillApplied.current || !bootstrapData) return;
    prefillApplied.current = true;
    const chosen = prefill.packageId ? bootstrapData.packages.find((p) => p.id === prefill.packageId) : undefined;
    if (chosen) {
      form.setValue("packageId" as FieldPath<TValues>, chosen.id as never, { shouldDirty: true });
      setPkg(chosen);
      // A time only makes sense together with the package it was picked for (the duration decides the slots).
      if (prefill.startsAt) form.setValue("startsAt" as FieldPath<TValues>, prefill.startsAt as never, { shouldDirty: true });
    }
  }, [bootstrapData, prefill, form]);

  if (bootstrap.isPending) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (bootstrap.error || !bootstrap.data) {
    return <p className="mx-auto max-w-2xl text-center text-sm text-destructive">{bootstrap.error?.message ?? "This form is unavailable."}</p>;
  }
  const service = bootstrap.data;
  // "Areas of concern" is the provider's own list: the details step shows the chosen provider's options.
  const serviceForDetails = { ...service, concernOptions: provider?.concernOptions ?? [] };

  function selectProvider(next: PublicProviderDto) {
    const field = CONCERN_CHECKLIST_FIELD[slug];
    // A different provider covers different areas: drop ticks that may not exist on the new list.
    if (field && provider && provider.id !== next.id) {
      form.setValue(`details.${field}` as FieldPath<TValues>, { selected: [], otherDetail: "" } as never, { shouldDirty: true });
    }
    setProvider(next);
  }

  if (result) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <BookingSuccess result={result} />
      </div>
    );
  }
  if (!service.open) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <RegistrationClosed service={service} />
      </div>
    );
  }

  const STEPS: { label: string; field: FieldPath<TValues>[]; node: ReactNode }[] = [
    {
      label: "Your details",
      field: ["personal", "location", "providerId", "packageId", "details"] as FieldPath<TValues>[],
      node: (
        <YourDetailsStep
          form={form}
          slug={slug}
          service={serviceForDetails}
          providerNoun={definition.providerNoun}
          packageNoun={definition.packageNoun}
          detailsLabel={detailsLabel}
          DetailsStep={DetailsStep}
          preselectProviderSlug={prefill.providerSlug}
          onProviderSelect={selectProvider}
          onPackageSelect={setPkg}
        />
      ),
    },
    {
      label: "Date & time",
      field: ["startsAt"] as FieldPath<TValues>[],
      node: <DateTimeStep form={form} slug={slug} onTimezone={setTimezone} />,
    },
    {
      label: "Review & payment",
      field: ["termsAccepted"] as FieldPath<TValues>[],
      node: <ReviewStep form={form} provider={provider} pkg={pkg} service={service} termsUrl={service.termsUrl} timezone={timezone} />,
    },
  ];
  const last = STEPS.length - 1;
  const current = STEPS[step]!;

  async function goNext() {
    const ok = await form.trigger(current.field);
    if (!ok) {
      // The first step is a long page: take the visitor to the first problem instead of leaving it off-screen.
      toast.error("Please check the highlighted fields.");
      window.requestAnimationFrame(() => {
        const bad = document.querySelector<HTMLElement>('[aria-invalid="true"], p.text-destructive');
        bad?.scrollIntoView({ block: "center", behavior: "smooth" });
        if (bad && bad.getAttribute("aria-invalid") === "true") bad.focus({ preventScroll: true });
      });
      return;
    }
    if (step < last) {
      setStep((s) => s + 1);
      return;
    }
    const values = form.getValues();
    try {
      const res = await submit.mutateAsync({ body: values, idempotencyKey });
      setResult(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <WizardHeader step={step} labels={STEPS.map((s) => s.label)} title={title} />
      {step === 0 && prefill.startsAt && pkg && chosenStart === prefill.startsAt && (
        <p className="mb-3 rounded-md border bg-muted/40 p-3 text-sm">
          You chose {formatDate(prefill.startsAt, timezone)} at {formatTime12(prefill.startsAt, timezone)}. Fill in your details and we&apos;ll
          keep it, if it&apos;s still free.
        </p>
      )}
      <Card>
        <CardContent className="relative pt-6">
          {current.node}
          <HoneypotField form={form} />
        </CardContent>
        {/* Stays visible at the bottom of the card while a long step is scrolled, so Next is always reachable. */}
        <CardFooter className="sticky bottom-0 z-10 -mb-6 justify-between rounded-b-xl border-t bg-card/95 pb-4 pt-4 backdrop-blur">
          <Button type="button" variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || submit.isPending}>
            Back
          </Button>
          <Button type="button" onClick={() => void goNext()} disabled={submit.isPending}>
            {step === last ? (submit.isPending ? "Submitting…" : "Submit booking") : "Next"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
