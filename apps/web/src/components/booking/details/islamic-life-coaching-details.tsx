"use client";

import type { IslamicLifeCoachingBookingInput } from "@booking/shared";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Field, fieldA11y } from "@/components/forms/field";
import { ChecklistField, concernChecklistProps } from "../checklist-field";
import { DeliveryModeField } from "../delivery-mode-field";
import type { StepProps } from "../wizard-types";

export function IslamicLifeCoachingDetailsStep({ form, service }: StepProps<IslamicLifeCoachingBookingInput>) {
  const error = form.formState.errors.details?.goals?.message;
  const { options, labels } = concernChecklistProps(service?.concernOptions ?? []);
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label>What would you like coaching on?</Label>
        <ChecklistField form={form} name="details.coachingAreas" options={options} labels={labels} />
      </div>
      <Field id="d-goals" label="What are you hoping to achieve?" error={error}>
        <Textarea rows={4} {...fieldA11y("d-goals", error)} {...form.register("details.goals")} />
      </Field>
      <DeliveryModeField form={form} service={service} />
    </div>
  );
}
