"use client";

import { Separator } from "@/components/ui/separator";
import type { PublicPackageDto, PublicProviderDto, PublicServiceDto, ServiceSlug } from "@booking/shared";
import { PersonalStep } from "./steps";
import { ProviderStep } from "./provider-step";
import { PackageStep } from "./package-step";
import type { BaseBookingValues, DetailsStepComponent, StepProps } from "./wizard-types";

/**
 * The merged first step: personal details, provider, package and the
 * service's own "Health information" answers, all on one screen — the
 * booking form collapsed from 7 steps to 3 (personal/provider/package/
 * location/service-details used to each be their own step).
 */
export function YourDetailsStep<TValues extends BaseBookingValues>({
  form,
  slug,
  service,
  providerNoun,
  packageNoun,
  detailsLabel,
  DetailsStep,
  onProviderSelect,
  onPackageSelect,
}: StepProps<TValues> & {
  slug: ServiceSlug;
  service: PublicServiceDto;
  providerNoun: string;
  packageNoun: string;
  detailsLabel: string;
  DetailsStep: DetailsStepComponent<TValues>;
  onProviderSelect: (provider: PublicProviderDto) => void;
  onPackageSelect: (pkg: PublicPackageDto) => void;
}) {
  return (
    <div className="grid gap-5">
      <PersonalStep form={form} />
      <Separator />
      {/* With no packages at all, the service is unbookable regardless of providers — show just the
          one "nothing available" card from PackageStep instead of duplicating it with ProviderStep's own. */}
      {service.packages.length > 0 && (
        <ProviderStep form={form} slug={slug} service={service} providerNoun={providerNoun} onSelect={onProviderSelect} />
      )}
      <PackageStep form={form} service={service} packageNoun={packageNoun} onSelect={onPackageSelect} />
      <Separator />
      <div className="grid gap-3">
        <p className="text-sm font-medium">{detailsLabel}</p>
        <DetailsStep form={form} service={service} />
      </div>
    </div>
  );
}
