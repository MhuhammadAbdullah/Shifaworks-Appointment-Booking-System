"use client";

import { useId, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const identity = (v: number) => String(v);
const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// ---------------------------------------------------------------------------
// KPI card with a trend pill (vs. the previous period)
// ---------------------------------------------------------------------------

interface DeltaProps {
  /** Percent change vs. the previous period; can be negative. */
  value: number;
  /** True when a DECREASE is the good outcome (e.g. cancellation rate, expenses). */
  invert?: boolean;
}

function DeltaPill({ value, invert }: DeltaProps) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  const isFlat = rounded === 0;
  const isUp = rounded > 0;
  const good = isFlat ? null : invert ? !isUp : isUp;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
        isFlat && "bg-muted text-muted-foreground",
        good === true && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
        good === false && "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400",
      )}
    >
      {!isFlat && (isUp ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />)}
      {isFlat ? "±0%" : `${isUp ? "+" : ""}${rounded}%`}
    </span>
  );
}

export function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: DeltaProps;
  hint?: string;
}) {
  return (
    <Card className="gap-3 py-5">
      <CardContent className="px-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex size-10 items-center justify-center rounded-xl border bg-muted/50 text-muted-foreground">
            <Icon className="size-5" />
          </div>
          {delta && <DeltaPill {...delta} />}
        </div>
        <p className="mt-3.5 text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Percent change of `curr` vs `prev`, safe for a zero baseline. */
export function pctDelta(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / prev) * 100;
}

// ---------------------------------------------------------------------------
// Trend chart — smoothed area/line with a hover crosshair + tooltip
// ---------------------------------------------------------------------------

interface TrendPoint {
  date: string;
  value: number;
}

interface TrendChartProps {
  data: TrendPoint[];
  color?: string;
  seriesLabel?: string;
  formatValue?: (value: number) => string;
  formatDate?: (date: string) => string;
  height?: number;
}

/** Catmull-Rom -> cubic Bezier smoothing, so the trend reads as a curve rather than jagged daily segments. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 3) return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  let d = `M${points[0]!.x.toFixed(2)},${points[0]!.y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/** A single-series area/line chart with a hover crosshair + tooltip, built on plain SVG (no charting library in this app). */
export function TrendChart({ data, color = "var(--primary)", seriesLabel, formatValue = identity, formatDate = shortDate, height = 180 }: TrendChartProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const padY = 10;

  const points = useMemo(() => {
    const values = data.map((d) => d.value);
    const max = Math.max(1, ...values);
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : 0;
    return data.map((d, i) => ({
      x: data.length > 1 ? i * stepX : width / 2,
      y: padY + (1 - (d.value - min) / span) * (height - padY * 2),
      date: d.date,
      value: d.value,
    }));
  }, [data, height]);

  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No activity in this range.
      </div>
    );
  }

  const firstPoint = points[0]!;
  const lastPoint = points[points.length - 1]!;
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L${lastPoint.x.toFixed(2)},${height - padY} L${firstPoint.x.toFixed(2)},${height - padY} Z`;
  const active = hover !== null ? points[hover] : null;

  return (
    <div>
      {seriesLabel && (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
          {seriesLabel}
        </div>
      )}
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="w-full touch-none"
          style={{ height }}
          role="img"
          aria-label="Trend chart"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            const idx = Math.round(ratio * (points.length - 1));
            setHover(Math.min(points.length - 1, Math.max(0, idx)));
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
          <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {active && (
            <>
              <line x1={active.x} x2={active.x} y1={padY} y2={height - padY} stroke="var(--border)" strokeWidth={1} />
              <circle cx={active.x} cy={active.y} r={4.5} fill={color} stroke="var(--card)" strokeWidth={2} />
            </>
          )}
        </svg>
        {active && (
          <div
            className="animate-in fade-in-0 zoom-in-95 pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md duration-150"
            style={{ left: `${(active.x / width) * 100}%`, top: `${(active.y / height) * 100}%` }}
          >
            <p className="font-medium text-popover-foreground">{formatValue(active.value)}</p>
            <p className="text-muted-foreground">{formatDate(active.date)}</p>
          </div>
        )}
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{formatDate(firstPoint.date)}</span>
          <span>{formatDate(lastPoint.date)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar breakdown (e.g. top services)
// ---------------------------------------------------------------------------

interface BarItem {
  key: string;
  label: string;
  value: number;
  colorClass?: string;
}

interface BarBreakdownProps {
  items: BarItem[];
  formatValue?: (value: number) => string;
  total?: number;
  emptyText?: string;
}

/** A proportional horizontal-bar breakdown — direct labels carry identity/value, so color alone is never load-bearing. */
export function BarBreakdown({ items, formatValue = identity, total, emptyText = "Nothing in this range." }: BarBreakdownProps) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  const sum = total ?? items.reduce((s, i) => s + i.value, 0);

  return (
    <div className="grid gap-3.5">
      {items.map((item) => (
        <div key={item.key} className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="flex shrink-0 items-baseline gap-1.5">
              <span className="font-medium tabular-nums">{formatValue(item.value)}</span>
              {sum > 0 && <span className="text-xs text-muted-foreground tabular-nums">{Math.round((item.value / sum) * 100)}%</span>}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", item.colorClass ?? "bg-[#8535AA]")}
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut chart (e.g. bookings by status)
// ---------------------------------------------------------------------------

interface DonutItem {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  items,
  size = 160,
  strokeWidth = 18,
  centerLabel = "Total",
  formatValue = identity,
  emptyText = "Nothing in this range.",
}: {
  items: DonutItem[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  formatValue?: (value: number) => string;
  emptyText?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = items.reduce((s, i) => s + i.value, 0);
  if (items.length === 0 || total === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;

  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  let cumulative = 0;
  const hoveredItem = items.find((i) => i.key === hovered) ?? null;
  const midpoints = new Map<string, { x: number; y: number }>();

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={strokeWidth} />
          {items.map((item) => {
            const frac = item.value / total;
            const dash = Math.max(0, frac * c - (items.length > 1 ? 2 : 0));
            const offset = -(cumulative * c);
            const mid = (cumulative + frac / 2) * 2 * Math.PI;
            midpoints.set(item.key, { x: size / 2 + r * Math.sin(mid), y: size / 2 - r * Math.cos(mid) });
            cumulative += frac;
            return (
              <circle
                key={item.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={item.color}
                strokeWidth={hovered === item.key ? strokeWidth + 3 : strokeWidth}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="cursor-pointer transition-[stroke-width]"
                onMouseEnter={() => setHovered(item.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${item.label}: ${formatValue(item.value)} (${Math.round(frac * 100)}%)`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <p className="text-xs text-muted-foreground">{centerLabel}</p>
          <p className="text-xl font-semibold tabular-nums">{formatValue(total)}</p>
        </div>
        {hoveredItem &&
          (() => {
            const p = midpoints.get(hoveredItem.key);
            if (!p) return null;
            return (
              <div
                className="animate-in fade-in-0 zoom-in-95 pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md duration-150"
                style={{ left: `${(p.x / size) * 100}%`, top: `${(p.y / size) * 100}%` }}
              >
                <p className="font-medium text-popover-foreground">
                  {formatValue(hoveredItem.value)} · {Math.round((hoveredItem.value / total) * 100)}%
                </p>
                <p className="text-muted-foreground">{hoveredItem.label}</p>
              </div>
            );
          })()}
      </div>
      <div className="grid w-full min-w-0 gap-2">
        {items.map((item) => (
          <div
            key={item.key}
            className={cn("flex items-center justify-between gap-2 rounded px-1 py-0.5 text-sm transition-colors", hovered === item.key && "bg-accent/50")}
            onMouseEnter={() => setHovered(item.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatValue(item.value)} · {Math.round((item.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces reused across the dashboard's list cards
// ---------------------------------------------------------------------------

export function InitialsAvatar({ name, className }: { name: string; className?: string }) {
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary", className)}>
      {initials}
    </span>
  );
}
