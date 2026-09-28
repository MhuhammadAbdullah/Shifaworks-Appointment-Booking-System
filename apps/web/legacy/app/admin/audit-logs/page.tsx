"use client";

import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import type { AuditLogDto } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { usePermissions } from "@/lib/auth/hooks";
import { downloadAuthed } from "@/lib/api/finance";
import { reportQueryString, useAuditFacets, useAuditLogs } from "@/lib/api/reports";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { formatDateTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "appointment.status.update" → "Appointment · status update" */
const actionLabel = (a: string) => {
  const [entity, ...rest] = a.split(".");
  return `${titleCase(entity ?? a)}${rest.length ? ` · ${rest.join(" ").replace(/_/g, " ")}` : ""}`;
};

export default function AuditLogPage() {
  const { me } = usePermissions();
  const tz = me?.organization.timezone ?? "Asia/Karachi";
  const facets = useAuditFacets();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [action, setAction] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditLogDto | null>(null);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [from, to, entityType, action, debounced]);

  const filters = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(entityType !== "all" ? { entityType } : {}),
    ...(action !== "all" ? { action } : {}),
    ...(debounced ? { search: debounced } : {}),
  };
  const { data, isPending, error } = useAuditLogs({ page, pageSize: 50, ...filters });
  const actions = (facets.data?.actions ?? []).filter((a) => entityType === "all" || a.startsWith(`${entityType}.`) || a.split(".")[0] === entityType);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who changed what, and when. Entries cannot be edited or deleted from the app."
        actions={
          <Button
            variant="outline"
            onClick={() => downloadAuthed(`/audit-logs/export?${reportQueryString(filters)}`, "audit-log.csv", false).catch(() => toast.error("Export failed"))}
          >
            <Download className="size-4" /> Export CSV
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="al-from">From</Label>
          <Input id="al-from" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="al-to">To</Label>
          <Input id="al-to" type="date" className="w-40" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Record type</Label>
          <Select
            value={entityType}
            onValueChange={(v) => {
              setEntityType(v);
              setAction("all");
            }}
          >
            <SelectTrigger className="w-44" aria-label="Record type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              {facets.data?.entityTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {titleCase(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Action</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-60" aria-label="Action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>
                  {actionLabel(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search" placeholder="Person, email or record id" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>IP address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-16 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={5} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No entries match these filters.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((a) => (
              <TableRow key={a.id} className="cursor-pointer" onClick={() => setOpen(a)}>
                <TableCell className="whitespace-nowrap">{formatDateTime(a.createdAt, tz)}</TableCell>
                <TableCell>
                  {a.user ? (
                    <>
                      <div>{a.user.name}</div>
                      <div className="text-xs text-muted-foreground">{a.user.email}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">System</span>
                  )}
                </TableCell>
                <TableCell>
                  <button type="button" className="text-left hover:underline" onClick={() => setOpen(a)}>
                    {actionLabel(a.action)}
                  </button>
                </TableCell>
                <TableCell className="text-sm">
                  {titleCase(a.entityType)}
                  {a.entityId && <div className="max-w-40 truncate font-mono text-xs text-muted-foreground">{a.entityId}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{a.ipAddress ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="entries" />
      {open && <AuditDialog entry={open} tz={tz} onClose={() => setOpen(null)} />}
    </>
  );
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v: unknown) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 1));

function AuditDialog({ entry, tz, onClose }: { entry: AuditLogDto; tz: string; onClose: () => void }) {
  const oldV = entry.oldValues;
  const newV = entry.newValues;
  const keys = [...new Set([...(isObj(oldV) ? Object.keys(oldV) : []), ...(isObj(newV) ? Object.keys(newV) : [])])];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{actionLabel(entry.action)}</DialogTitle>
          <DialogDescription>
            {formatDateTime(entry.createdAt, tz)} · {entry.user ? `${entry.user.name}${entry.user.email ? ` (${entry.user.email})` : ""}` : "System"}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Record</dt>
          <dd>
            {titleCase(entry.entityType)} <span className="font-mono text-xs">{entry.entityId}</span>
          </dd>
          <dt className="text-muted-foreground">IP address</dt>
          <dd className="font-mono text-xs">{entry.ipAddress ?? "—"}</dd>
          <dt className="text-muted-foreground">Device</dt>
          <dd className="truncate text-xs" title={entry.userAgent ?? ""}>
            {entry.userAgent ?? "—"}
          </dd>
          <dt className="text-muted-foreground">Request</dt>
          <dd className="font-mono text-xs">{entry.requestId ?? "—"}</dd>
        </dl>
        {keys.length > 0 ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="p-2 font-medium">Field</th>
                  <th className="p-2 font-medium">Before</th>
                  <th className="p-2 font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const before = isObj(oldV) ? oldV[k] : undefined;
                  const after = isObj(newV) ? newV[k] : undefined;
                  const changed = JSON.stringify(before) !== JSON.stringify(after) && isObj(oldV) && isObj(newV);
                  return (
                    <tr key={k} className={cn("border-b align-top last:border-0", changed && "bg-amber-50 dark:bg-amber-950/40")}>
                      <td className="p-2 font-mono text-xs">{k}</td>
                      <td className="p-2 text-xs break-all whitespace-pre-wrap text-muted-foreground">{show(before) || "—"}</td>
                      <td className="p-2 text-xs break-all whitespace-pre-wrap">{show(after) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          (oldV !== null || newV !== null) && (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify({ before: oldV, after: newV }, null, 2)}</pre>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
