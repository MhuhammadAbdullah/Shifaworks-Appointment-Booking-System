"use client";

import { Controller } from "react-hook-form";
import { SPEECH_CONCERNS, SPEECH_CONCERN_LABELS, THERAPY_RECIPIENTS, THERAPY_RECIPIENT_LABELS, type SpeechTherapyBookingInput } from "@booking/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, fieldA11y } from "@/components/forms/field";
import { ChecklistField } from "../checklist-field";
import { DeliveryModeField } from "../delivery-mode-field";
import type { StepProps } from "../wizard-types";

export function SpeechTherapyDetailsStep({ form, service }: StepProps<SpeechTherapyBookingInput>) {
  const forWhom = form.watch("details.forWhom");
  const details = form.formState.errors.details;

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label id="fw-label">Who is the therapy for?</Label>
        <Controller
          control={form.control}
          name="details.forWhom"
          render={({ field }) => (
            <RadioGroup aria-labelledby="fw-label" className="flex flex-wrap gap-4" value={field.value} onValueChange={field.onChange}>
              {THERAPY_RECIPIENTS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm font-normal">
                  <RadioGroupItem value={r} /> {THERAPY_RECIPIENT_LABELS[r]}
                </label>
              ))}
            </RadioGroup>
          )}
        />
        {details?.forWhom?.message && <p className="text-sm text-destructive">{details.forWhom.message}</p>}
      </div>

      {forWhom && forWhom !== "SELF" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="d-name" label="Their name" error={details?.personName?.message}>
            <Input {...fieldA11y("d-name", details?.personName?.message)} {...form.register("details.personName")} />
          </Field>
          <Field id="d-age" label="Their age" error={details?.personAge?.message}>
            <Input
              type="number"
              min={0}
              max={120}
              {...fieldA11y("d-age", details?.personAge?.message)}
              {...form.register("details.personAge", { valueAsNumber: true })}
            />
          </Field>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label>Main concerns</Label>
        <ChecklistField form={form} name="details.concerns" options={SPEECH_CONCERNS} labels={SPEECH_CONCERN_LABELS} />
      </div>

      <DeliveryModeField form={form} service={service} />
    </div>
  );
}
