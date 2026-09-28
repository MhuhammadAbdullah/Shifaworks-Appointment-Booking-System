"use client";

import type { HijamaBookingInput } from "@booking/shared";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldA11y } from "@/components/forms/field";
import type { StepProps } from "../wizard-types";

/** In-clinic only: no delivery mode or language questions. */
export function HijamaTherapyDetailsStep({ form }: StepProps<HijamaBookingInput>) {
  const error = form.formState.errors.details?.medicalNotes?.message;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Anything our therapist should know before your session?</p>
      <Field id="d-notes" label="Medical conditions, medications or pregnancy" error={error} hint="Optional">
        <Textarea rows={4} {...fieldA11y("d-notes", error)} {...form.register("details.medicalNotes")} />
      </Field>
    </div>
  );
}
