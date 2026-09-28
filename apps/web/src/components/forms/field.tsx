import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { InfoTooltip } from "@/components/forms/info-tooltip";
import { cn } from "@/lib/utils";

interface FieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  /** Shows a red asterisk next to the label. */
  required?: boolean;
  /** Shows an explicit "Optional" badge next to the label — mutually exclusive with `required`. */
  optional?: boolean;
  /** Shows a small (ⓘ) icon next to the label; hover on desktop, tap on touch. */
  info?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error, wired for screen readers via aria-describedby ids. */
export function Field({ id, label, error, hint, required, optional, info, className, children }: FieldProps) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>
          {label}
          {required && (
            <span className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </Label>
        {optional && <span className="text-xs text-muted-foreground">Optional</span>}
        {info && <InfoTooltip text={info} />}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Props to spread on an input rendered inside <Field>. */
export function fieldA11y(id: string, error?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  } as const;
}
