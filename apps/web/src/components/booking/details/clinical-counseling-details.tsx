"use client";

import { Controller } from "react-hook-form";
import type { ClinicalCounselingBookingInput } from "@booking/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, fieldA11y } from "@/components/forms/field";
import { ChecklistField, concernChecklistProps } from "../checklist-field";
import { DeliveryModeField } from "../delivery-mode-field";
import type { StepProps } from "../wizard-types";

export function ClinicalCounselingDetailsStep({ form, service }: StepProps<ClinicalCounselingBookingInput>) {
  const previousDiagnosis = form.watch("details.previousDiagnosis");
  const details = form.formState.errors.details;
  const { options, labels } = concernChecklistProps(service?.concernOptions ?? []);

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label>Areas of concern</Label>
        <ChecklistField form={form} name="details.areasOfConcern" options={options} labels={labels} />
      </div>

      <div className="grid gap-1.5">
        <Label id="pd-label">Previous diagnosis or treatment?</Label>
        <Controller
          control={form.control}
          name="details.previousDiagnosis"
          render={({ field }) => (
            <RadioGroup
              aria-labelledby="pd-label"
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
        {details?.previousDiagnosis?.message && <p className="text-sm text-destructive">{details.previousDiagnosis.message}</p>}
      </div>
      {previousDiagnosis && (
        <Field id="d-diag" label="Please give a few details" error={details?.previousDiagnosisDetails?.message}>
          <Textarea rows={3} {...fieldA11y("d-diag", details?.previousDiagnosisDetails?.message)} {...form.register("details.previousDiagnosisDetails")} />
        </Field>
      )}

      <Field id="d-med" label="Current medication" error={details?.currentMedication?.message} hint="Optional">
        <Input {...fieldA11y("d-med", details?.currentMedication?.message)} {...form.register("details.currentMedication")} />
      </Field>

      <DeliveryModeField form={form} service={service} />
    </div>
  );
}
