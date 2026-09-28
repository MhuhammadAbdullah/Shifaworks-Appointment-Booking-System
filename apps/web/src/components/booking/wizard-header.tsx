export function WizardHeader({ step, total, label, title }: { step: number; total: number; label: string; title: string }) {
  const pct = Math.round(((step + 1) / total) * 100);
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Step {step + 1} of {total} - {label}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[#8535AA] transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
