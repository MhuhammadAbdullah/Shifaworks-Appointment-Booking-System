"use client";

/**
 * Single-hue horizontal bars with the value printed on every row, so the rows
 * double as the table view (no colour-only encoding). Negative values are
 * drawn from zero in a muted tone and labelled with their sign.
 */
export function BarList({
  rows,
  format,
  empty,
  labelWidth = "7rem",
}: {
  rows: { label: string; value: number; note?: string | undefined }[];
  format: (v: number) => string;
  empty: string;
  labelWidth?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <ul className="grid gap-2 text-sm">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="grid items-center gap-3" style={{ gridTemplateColumns: `${labelWidth} 1fr auto` }} title={`${r.label}: ${format(r.value)}`}>
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="h-4 rounded-r bg-muted">
            <span
              className={r.value < 0 ? "block h-full rounded-r bg-muted-foreground/40" : "block h-full rounded-r bg-primary"}
              style={{ width: `${Math.max((Math.abs(r.value) / max) * 100, r.value !== 0 ? 1 : 0)}%` }}
            />
          </span>
          <span className="text-right tabular-nums">
            {format(r.value)}
            {r.note && <span className="ml-2 text-xs text-muted-foreground">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Compact single-hue column chart for a time series (e.g. 30 days). Each
 * column has a hover title; the exact numbers are available as a table below
 * (collapsed by default) for screen readers and precise reading.
 */
export function ColumnChart({
  points,
  format,
  label,
  height = 120,
}: {
  points: { label: string; value: number }[];
  format: (v: number) => string;
  label: string;
  height?: number;
}) {
  const max = Math.max(...points.map((p) => Math.abs(p.value)), 1);
  const total = points.reduce((n, p) => n + p.value, 0);
  return (
    <figure className="grid gap-2">
      <div className="flex items-end gap-[2px]" style={{ height }} role="img" aria-label={`${label}: ${points.length} values, total ${format(total)}`}>
        {points.map((p) => (
          <div key={p.label} className="group relative flex h-full flex-1 items-end" title={`${p.label}: ${format(p.value)}`}>
            <div
              className={p.value < 0 ? "w-full rounded-t-sm bg-muted-foreground/40" : "w-full rounded-t-sm bg-primary group-hover:opacity-80"}
              style={{ height: `${p.value === 0 ? 0 : Math.max((Math.abs(p.value) / max) * 100, 2)}%` }}
            />
          </div>
        ))}
      </div>
      <figcaption className="flex justify-between text-xs text-muted-foreground">
        <span>{points[0]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </figcaption>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <tbody>
            {points.map((p) => (
              <tr key={p.label} className="border-b last:border-0">
                <td className="py-0.5">{p.label}</td>
                <td className="py-0.5 text-right tabular-nums">{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Headline number tile. */
export function StatTile({ label, value, hint, tone }: { label: string; value: string; hint?: string | undefined; tone?: "negative" | undefined }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={tone === "negative" ? "text-xl font-semibold tabular-nums text-destructive" : "text-xl font-semibold tabular-nums"}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
