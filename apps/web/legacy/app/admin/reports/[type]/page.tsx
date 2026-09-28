"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { notFound, useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";
import {
  BOOKING_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  REPORTS,
  REPORT_TYPES,
  type ReportColumn,
  type ReportDto,
  type ReportFilterKey,
  type ReportType,
} from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { BarList, ColumnChart, StatTile } from "@/components/charts/bar-list";
import { Pagination } from "@/components/tables/pagination";
import { usePermissions } from "@/lib/auth/hooks";
import { useCategories, useLocations, useProviders, useServices } from "@/lib/api/catalog";
import { useEvents } from "@/lib/api/events";
import { downloadAuthed, useExpenseCategories } from "@/lib/api/finance";
import { reportQueryString, useReport } from "@/lib/api/reports";
import { addDays, formatDate, formatDateTime, formatMoney, localDate, titleCase } from "@/lib/format";

export default function ReportPage() {
  const { type } = useParams<{ type: string }>();
  if (!(REPORT_TYPES as readonly string[]).includes(type)) notFound();
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Report type={type as ReportType} />
    </Suspense>
  );
}

const FILTER_LABELS: Record<ReportFilterKey, string> = {
  providerId: "Provider",
  serviceId: "Service",
  categoryId: "Category",
  locationId: "Location",
  eventId: "Event",
  paymentStatus: "Payment status",
  bookingStatus: "Booking status",
  status: "Status",
  method: "Method",
  groupBy: "Group by",
};
const GROUP_LABELS: Record<string, string> = { day: "Day", week: "Week", month: "Month", service: "Service / event", provider: "Provider", category: "Category", method: "Payment method" };

function Report({ type }: { type: ReportType }) {
  const def = REPORTS[type];
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { me, can } = usePermissions();
  const tz = me?.organization.timezone ?? "Asia/Karachi";
  const currency = me?.organization.currency ?? "PKR";
  const today = localDate(new Date(), tz);
  const monthStart = `${today.slice(0, 8)}01`;

  const q = useMemo(() => {
    const out: Record<string, string | number | undefined> = {
      from: params.get("from") ?? monthStart,
      to: params.get("to") ?? today,
      page: Number(params.get("page") ?? 1),
      pageSize: 50,
    };
    for (const k of def.filters) {
      const v = params.get(k);
      if (v) out[k] = v;
    }
    return out;
  }, [params, def.filters, monthStart, today]);

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const validRange = String(q.from) <= String(q.to);
  const { data: r, isPending, error, isFetching } = useReport(type, q, validRange);

  const lastMonthEnd = addDays(monthStart, -1);
  const presets = [
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { label: "Last 30 days", from: addDays(today, -29), to: today },
    { label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
    { label: "Next 30 days", from: today, to: addDays(today, 30) },
  ];

  return (
    <>
      <Link href="/admin/reports" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Reports
      </Link>
      <PageHeader
        title={def.title}
        description={`${def.description} Dates: ${def.dateBasis.toLowerCase()}.`}
        actions={
          can("reports.export") && (
            <Button
              variant="outline"
              disabled={!validRange || !r?.meta.total}
              onClick={() =>
                downloadAuthed(`/reports/${type}/export?${reportQueryString(q)}`, `${type}-${q.from}-to-${q.to}.csv`, false).catch(() => toast.error("Export failed"))
              }
            >
              <Download className="size-4" /> Export CSV
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <Button key={p.label} size="sm" variant={q.from === p.from && q.to === p.to ? "secondary" : "ghost"} onClick={() => set({ from: p.from, to: p.to })}>
            {p.label}
          </Button>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="r-from">From</Label>
          <Input id="r-from" type="date" className="w-40" value={String(q.from)} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="r-to">To</Label>
          <Input id="r-to" type="date" className="w-40" min={String(q.from)} value={String(q.to)} onChange={(e) => set({ to: e.target.value })} />
        </div>
        {def.filters.map((k) => (
          <FilterSelect key={k} filter={k} type={type} value={(q[k] as string | undefined) ?? "all"} onChange={(v) => set({ [k]: v })} />
        ))}
        {def.filters.some((k) => q[k]) && (
          <Button variant="ghost" size="sm" onClick={() => set(Object.fromEntries(def.filters.map((k) => [k, undefined])))}>
            Clear filters
          </Button>
        )}
      </div>

      {!validRange && <p className="text-destructive">&apos;To&apos; must be on or after &apos;From&apos;.</p>}
      {error && <p className="text-destructive">{error.message}</p>}
      {isPending && validRange && <Skeleton className="h-96 w-full" />}
      {r && <ReportView r={r} tz={tz} currency={currency} stale={isFetching} onPage={(page) => set({ page: String(page) })} />}
    </>
  );
}

function FilterSelect({ filter, type, value, onChange }: { filter: ReportFilterKey; type: ReportType; value: string; onChange: (v: string) => void }) {
  const def = REPORTS[type];
  const expenses = type === "expenses";
  const providers = useProviders({ pageSize: 100 });
  const services = useServices({ pageSize: 100 });
  const categories = useCategories();
  const expenseCats = useExpenseCategories();
  const locations = useLocations();
  const events = useEvents({ pageSize: 100 });

  let options: { value: string; label: string }[] = [];
  switch (filter) {
    case "providerId":
      options = providers.data?.data.map((p) => ({ value: p.id, label: p.displayName })) ?? [];
      break;
    case "serviceId":
      options = services.data?.data.map((s) => ({ value: s.id, label: s.name })) ?? [];
      break;
    case "categoryId":
      options = expenses ? (expenseCats.data ?? []).map((c) => ({ value: c.id, label: c.name })) : (categories.data ?? []).map((c) => ({ value: c.id, label: c.name }));
      break;
    case "locationId":
      options = (locations.data ?? []).map((l) => ({ value: l.id, label: l.name }));
      break;
    case "eventId":
      options = events.data?.data.map((e) => ({ value: e.id, label: e.name })) ?? [];
      break;
    case "paymentStatus":
      options = PAYMENT_STATUSES.map((s) => ({ value: s, label: titleCase(s) }));
      break;
    case "bookingStatus":
      options = BOOKING_STATUSES.map((s) => ({ value: s, label: titleCase(s) }));
      break;
    case "status":
      options = (def.statuses ?? []).map((s) => ({ value: s, label: titleCase(s) }));
      break;
    case "method":
      options = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));
      break;
    case "groupBy":
      options = Object.entries(GROUP_LABELS).map(([v, label]) => ({ value: v, label }));
      break;
  }
  return (
    <div className="grid gap-1.5">
      <Label>{FILTER_LABELS[filter]}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-44" aria-label={FILTER_LABELS[filter]}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{filter === "groupBy" ? "Automatic" : "All"}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ReportView({ r, tz, currency, stale, onPage }: { r: ReportDto; tz: string; currency: string; stale: boolean; onPage: (p: number) => void }) {
  const money = (v: number) => formatMoney(v, currency);
  const cell = (c: ReportColumn, v: string | number | null | undefined) => {
    if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
    switch (c.type) {
      case "money":
        return money(Number(v));
      case "percent":
        return `${v}%`;
      case "number":
        return Number(v).toLocaleString();
      case "datetime":
        return formatDateTime(String(v), tz);
      case "date":
        return formatDate(`${v}T12:00:00`, tz);
      case "status":
        return titleCase(String(v));
      default:
        return String(v);
    }
  };
  const numeric = (c: ReportColumn) => c.type === "money" || c.type === "number" || c.type === "percent";
  const isTime = r.chart && r.columns[0]?.key === "group" && /^(Day|Week|Month)$/.test(r.columns[0].label);
  const chartFormat = (v: number) => (r.chart?.valueKey === "net" || r.chart?.valueKey === "revenue" || r.chart?.valueKey === "amount" || r.chart?.valueKey === "spent" ? money(v) : v.toLocaleString());

  return (
    <div className={stale ? "grid gap-6 opacity-70 transition-opacity" : "grid gap-6"}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
        {r.summary.map((s) => (
          <StatTile
            key={s.label}
            label={s.label}
            value={s.value === null ? "—" : s.type === "money" ? money(Number(s.value)) : s.type === "percent" ? `${s.value}%` : typeof s.value === "number" ? s.value.toLocaleString() : s.value}
            hint={s.hint}
          />
        ))}
      </div>

      {r.chart && r.chart.points.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{r.chart.label}</CardTitle>
          </CardHeader>
          <CardContent>
            {isTime && r.chart.points.length > 12 ? (
              <ColumnChart label={r.chart.label} points={r.chart.points} format={chartFormat} height={160} />
            ) : (
              <BarList rows={r.chart.points.slice(0, 15)} format={chartFormat} empty="No data." labelWidth="10rem" />
            )}
            {!isTime && r.chart.points.length > 15 && <p className="mt-2 text-xs text-muted-foreground">Top 15 of {r.chart.points.length}; see the table for all.</p>}
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {r.columns.map((c) => (
                <TableHead key={c.key} className={numeric(c) ? "text-right" : undefined}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={r.columns.length} className="py-8 text-center text-muted-foreground">
                  Nothing in this period with these filters.
                </TableCell>
              </TableRow>
            )}
            {r.rows.map((row, i) => (
              <TableRow key={i}>
                {r.columns.map((c) => (
                  <TableCell key={c.key} className={numeric(c) ? "text-right tabular-nums whitespace-nowrap" : c.type === "datetime" ? "whitespace-nowrap" : "max-w-72 truncate"}>
                    {cell(c, row[c.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={r.meta} onPage={onPage} noun="rows" />
    </div>
  );
}
