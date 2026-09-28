"use client";

import { Suspense, useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import type { AuditLogDto } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { downloadAuditLogsCsv, useAuditLogs } from "@/lib/api/audit";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePermissions } from "@/lib/auth/hooks";
import { ApiError } from "@/lib/api-client";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function AuditLogsPage() {
  return (
    <Suspense>
      <AuditLogs />
    </Suspense>
  );
}

function AuditLogs() {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditLogDto | null>(null);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [debounced, from, to]);

  const query = { page, pageSize: 25, ...(debounced ? { search: debounced } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const { data, isPending, error } = useAuditLogs(query);
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadAuditLogsCsv(query);
    } catch (e) {
      toast.error(errorText(e, "Could not export the audit log"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every change made in the app: who did what, and when."
        actions={
          can("audit.view") && (
            <Button variant="outline" onClick={() => void onExport()} disabled={exporting}>
              <Download className="size-4" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search the audit log" placeholder="Action, entity, staff name" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="a-from">From</Label>
          <Input id="a-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="a-to">To</Label>
          <Input id="a-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden sm:table-cell">Entity</TableHead>
              <TableHead className="hidden md:table-cell">By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={4} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No entries match these filters.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((l) => (
              <TableRow key={l.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setDetail(l)}>
                <TableCell className="text-sm text-muted-foreground">{new Date(l.createdAt).toLocaleString("en-GB")}</TableCell>
                <TableCell className="font-mono text-sm">{l.action}</TableCell>
                <TableCell className="hidden text-sm sm:table-cell">
                  {l.entityType}
                  {l.entityId && <span className="text-muted-foreground"> · {l.entityId.slice(0, 8)}</span>}
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{l.user?.name ?? "System"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="entries" />

      {detail && (
        <Dialog open onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle className="font-mono">{detail.action}</DialogTitle>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">When</dt>
              <dd>{new Date(detail.createdAt).toLocaleString("en-GB")}</dd>
              <dt className="text-muted-foreground">By</dt>
              <dd>{detail.user?.name ?? "System"}</dd>
              <dt className="text-muted-foreground">Entity</dt>
              <dd>
                {detail.entityType} {detail.entityId && <span className="font-mono text-xs">{detail.entityId}</span>}
              </dd>
              {detail.ipAddress && (
                <>
                  <dt className="text-muted-foreground">IP address</dt>
                  <dd>{detail.ipAddress}</dd>
                </>
              )}
            </dl>
            {detail.oldValues != null && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Before</p>
                <pre className="overflow-x-auto rounded-md border bg-muted p-2 text-xs">{JSON.stringify(detail.oldValues, null, 2)}</pre>
              </div>
            )}
            {detail.newValues != null && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">After</p>
                <pre className="overflow-x-auto rounded-md border bg-muted p-2 text-xs">{JSON.stringify(detail.newValues, null, 2)}</pre>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
