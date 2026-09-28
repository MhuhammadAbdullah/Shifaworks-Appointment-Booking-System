"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** Checkbox with a label and optional helper text. */
export function CheckField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(c) => onCheckedChange(c === true)} className="mt-0.5" />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
