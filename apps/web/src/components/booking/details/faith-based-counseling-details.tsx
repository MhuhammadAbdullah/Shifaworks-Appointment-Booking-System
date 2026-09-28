"use client";

import { Controller } from "react-hook-form";
import type { FaithBasedCounselingBookingInput } from "@booking/shared";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, fieldA11y } from "@/components/forms/field";
import { ChecklistField, concernChecklistProps } from "../checklist-field";
import { DeliveryModeField } from "../delivery-mode-field";
import type { StepProps } from "../wizard-types";

export function FaithBasedCounselingDetailsStep({ form, service }: StepProps<FaithBasedCounselingBookingInput>) {
  const details = form.formState.errors.details;
  const anythingElseError = details?.anythingElse?.message;
  const { options, labels } = concernChecklistProps(service?.concernOptions ?? []);
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label>Areas of concern</Label>
        <ChecklistField form={form} name="details.areasOfConcern" options={options} labels={labels} />
      </div>

      <div className="grid gap-1.5">
        <Label id="pc-label">Have you had counselling before?</Label>
        <Controller
          control={form.control}
          name="details.previousCounselling"
          render={({ field }) => (
            <RadioGroup
              aria-labelledby="pc-label"
              className="flex gap-4"
              value={field.value === true ? "yes" : field.value === false ? "no" : undefined}
              onValueChange={(v) => field.onChange(v === "yes")}
            >
              <label className="flex items-center gap-2 text-sm font-normal">
                <RadioGroupItem value="yes" /> Yes
              </label>
              <label className="flex items-center gap-2 text-sm font-normal">
                <RadioGroupItem value="no" /> No
              </label>
            </RadioGroup>
          )}
        />
        {details?.previousCounselling?.message && <p className="text-sm text-destructive">{details.previousCounselling.message}</p>}
      </div>

      <Field id="d-else" label="Anything else you'd like to share" error={anythingElseError} hint="Optional">
        <Textarea rows={3} {...fieldA11y("d-else", anythingElseError)} {...form.register("details.anythingElse")} />
      </Field>

      <DeliveryModeField form={form} service={service} />
    </div>
  );
}
