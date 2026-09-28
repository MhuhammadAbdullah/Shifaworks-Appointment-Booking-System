"use client";

import type { PublicConcernOptionDto } from "@booking/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { BaseBookingValues, StepProps } from "./wizard-types";

/** Admin-managed checklist options (from the service bootstrap) plus the always-present "Other", ready for ChecklistField. */
export function concernChecklistProps(options: PublicConcernOptionDto[]) {
  return {
    options: [...options.map((o) => o.code), "OTHER"],
    labels: Object.fromEntries([...options.map((o) => [o.code, o.label] as const), ["OTHER", "Other"] as const]),
  };
}

interface ChecklistErrors {
  selected?: { message?: string };
  otherDetail?: { message?: string };
}

/** Multi-select checkboxes bound to `${name}.selected` + a conditional "Other" text at `${name}.otherDetail`. */
export function ChecklistField<TValues extends BaseBookingValues>({
  form,
  name,
  options,
  labels,
}: StepProps<TValues> & { name: string; options: readonly string[]; labels: Record<string, string> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic dotted-path lookup into a form-values/error tree
  const at = (obj: any, dotted: string) => dotted.split(".").reduce<any>((o, k) => o?.[k], obj);
  const selected = (at(form.watch(), `${name}.selected`) as string[] | undefined) ?? [];
  const err = at(form.formState.errors, name) as ChecklistErrors | undefined;

  function toggle(option: string, checked: boolean) {
    const next = checked ? [...selected, option] : selected.filter((o) => o !== option);
    form.setValue(`${name}.selected` as never, next as never, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <Checkbox checked={selected.includes(opt)} onCheckedChange={(c) => toggle(opt, c === true)} />
            {labels[opt] ?? opt}
          </label>
        ))}
      </div>
      {err?.selected?.message && <p className="text-sm text-destructive">{err.selected.message}</p>}
      {selected.includes("OTHER") && (
        <Input placeholder="Please describe" {...form.register(`${name}.otherDetail` as never)} />
      )}
      {err?.otherDetail?.message && <p className="text-sm text-destructive">{err.otherDetail.message}</p>}
    </div>
  );
}
