import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Title plus a numbered stepper: done steps get a tick, the current one is highlighted, the rest are muted. */
export function WizardHeader({ step, labels, title }: { step: number; labels: string[]; title: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="sr-only" aria-live="polite">
        Step {step + 1} of {labels.length}: {labels[step]}
      </p>
      <ol className="mt-4 flex items-start" aria-label="Progress">
        {labels.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-1.5 text-center" aria-current={current ? "step" : undefined}>
              <div className="flex w-full items-center">
                <span className={cn("h-0.5 flex-1", i === 0 ? "bg-transparent" : i <= step ? "bg-[#8535AA]" : "bg-muted")} />
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                    done && "border-[#8535AA] bg-[#8535AA] text-white",
                    current && "border-[#8535AA] bg-background text-[#8535AA]",
                    !done && !current && "border-muted bg-background text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
                </span>
                <span className={cn("h-0.5 flex-1", i === labels.length - 1 ? "bg-transparent" : i < step ? "bg-[#8535AA]" : "bg-muted")} />
              </div>
              <span className={cn("text-xs leading-tight", current ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
