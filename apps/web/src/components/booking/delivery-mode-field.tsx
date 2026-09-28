"use client";

import { Controller } from "react-hook-form";
import { DELIVERY_MODES, DELIVERY_MODE_LABELS } from "@booking/shared";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { BaseBookingValues, StepProps } from "./wizard-types";

/** "In person or online" — asked by every service but Hijama Therapy, and admin-hideable per service (Services -> admin). */
export function DeliveryModeField<TValues extends BaseBookingValues>({ form, service }: StepProps<TValues>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic nested error lookup
  const details = form.formState.errors.details as any;
  const modeErr = details?.deliveryMode as { message?: string } | undefined;

  if (service && !service.deliveryModeVisible) return null;

  return (
    <div className="grid gap-1.5">
      <Label id="mode-label">In person or online</Label>
      <Controller
        control={form.control}
        name={"details.deliveryMode" as never}
        render={({ field }) => (
          <RadioGroup aria-labelledby="mode-label" className="flex gap-4" value={field.value as string} onValueChange={field.onChange}>
            {DELIVERY_MODES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm font-normal">
                <RadioGroupItem value={m} /> {DELIVERY_MODE_LABELS[m]}
              </label>
            ))}
          </RadioGroup>
        )}
      />
      {modeErr?.message && <p className="text-sm text-destructive">{modeErr.message}</p>}
    </div>
  );
}
