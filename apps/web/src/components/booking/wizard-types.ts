import type { ComponentType } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { PublicServiceDto } from "@booking/shared";

/**
 * Every per-service booking schema (packages/shared/src/service-forms/*)
 * shares exactly this top-level shape — only `details` differs.
 */
export interface BaseBookingValues {
  service: string;
  providerId: string;
  packageId: string;
  startsAt: string;
  personal: {
    firstName: string;
    lastName?: string | null | undefined;
    phone: string;
    email: string;
    dateOfBirth?: string | null | undefined;
    gender: "MALE" | "FEMALE";
  };
  location: {
    city: string;
    province?: string | null | undefined;
  };
  details: unknown;
  receiptFileId?: string | undefined;
  termsAccepted: boolean;
  website?: string | undefined;
}

export interface StepProps<TValues extends BaseBookingValues> {
  form: UseFormReturn<TValues>;
  /** Only passed to the "Your details" merged step's DetailsStep slot — steps that don't need it can ignore it. */
  service?: PublicServiceDto;
}

export type DetailsStepComponent<TValues extends BaseBookingValues> = ComponentType<StepProps<TValues>>;

/** RHF's `setValueAs`: turns an empty text input into `undefined` instead of `""`. */
export const blankToUndefined = (v: string) => (v?.trim() ? v : undefined);
