"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Star, UserPlus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { PROVIDER_TYPES, PROVIDER_TYPE_LABELS, type ProviderType } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/dashboard/app-shell";
import { Pagination } from "@/components/tables/pagination";
import { BulkActionBar } from "@/components/tables/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/tables/bulk-delete-dialog";
import { CreateProviderDialog } from "@/components/providers/create-provider-dialog";
import { ProviderDetailDialog } from "@/components/providers/provider-detail-dialog";
import { usePermissions } from "@/lib/auth/hooks";
import { useBulkDeleteProviders, useProviders } from "@/lib/api/catalog";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function ProvidersPage() {
  return (
    <Suspense>
      <Providers />
    </Suspense>
  );
}

function Providers() {
  const { can } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const typeParam = params.get("type");
  const type = (PROVIDER_TYPES as readonly string[]).includes(typeParam ?? "") ? (typeParam as ProviderType) : null;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const debounced = useDebounced(search);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debounced, type]);
  useEffect(() => setSelected(new Set()), [page]);
  const canDelete = can("providers.delete");
  const bulkDelete = useBulkDeleteProviders();

  const { data, isPending, error } = useProviders({
    page,
    pageSize: 25,
    ...(type ? { type } : {}),
    ...(debounced ? { search: debounced } : {}),
  });

  const rowIds = data?.data.map((p) => p.id) ?? [];
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id));
  const someSelected = rowIds.some((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rowIds));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulkDelete = () => {
    bulkDelete.mutate(Array.from(selected), {
      onSuccess: (result) => {
        setBulkDeleting(false);
        setSelected(new Set());
        if (result.failed.length === 0) toast.success(`${result.succeeded} provider${result.succeeded === 1 ? "" : "s"} deleted`);
        else toast(`${result.succeeded} deleted, ${result.failed.length} could not be deleted (they have a dashboard login)`);
      },
      onError: (e) => toast.error(errorText(e, "Could not delete the selected providers")),
    });
  };

  const title = type ? `${PROVIDER_TYPE_LABELS[type]}s` : "Providers";

  return (
    <div>
      <PageHeader
        title={title}
        description="Therapists and counsellors customers can book. Gender matching, services and availability are set per provider."
        actions={
          can("providers.create") && (
            <Button onClick={() => setCreating(true)}>
              <UserPlus className="size-4" /> Add provider
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={type ?? "all"} onValueChange={(v) => router.replace(v === "all" ? pathname : `${pathname}?type=${v}`)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="THERAPIST">Therapists</TabsTrigger>
            <TabsTrigger value="COUNSELLOR">Counsellors</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search providers" placeholder="Name, designation or email" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {canDelete && (
        <BulkActionBar count={selected.size} noun="provider" onDelete={() => setBulkDeleting(true)} onClear={() => setSelected(new Set())} />
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canDelete && (
                <TableHead className="w-10">
                  {rowIds.length > 0 && (
                    <Checkbox
                      aria-label="Select all providers on this page"
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                  )}
                </TableHead>
              )}
              <TableHead>Provider</TableHead>
              <TableHead className="hidden md:table-cell">Services</TableHead>
              <TableHead className="hidden sm:table-cell">Accepts</TableHead>
              <TableHead className="hidden lg:table-cell">Login</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={canDelete ? 6 : 5}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={canDelete ? 6 : 5} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={canDelete ? 6 : 5} className="py-8 text-center text-muted-foreground">
                  No providers yet.
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((p) => (
              <TableRow
                key={p.id}
                className={cn("cursor-pointer hover:bg-accent/50", !p.isActive && "opacity-60")}
                data-state={selected.has(p.id) ? "selected" : undefined}
                onClick={() => setViewingId(p.id)}
              >
                {canDelete && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={`Select ${p.displayName}`} checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                      {p.profileImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                        <img src={p.profileImageUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <UserRound className="size-5 text-muted-foreground" />
                      )}
                    </span>
                    <span>
                      <span className="font-medium hover:underline">{p.displayName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.designation ?? PROVIDER_TYPE_LABELS[p.providerType]} · {p.experienceYears} yrs
                        {p.rating && (
                          <span className="ml-1 inline-flex items-center gap-0.5">
                            · <Star className="size-3 fill-current" aria-hidden /> {p.rating}
                          </span>
                        )}
                      </span>
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {p.services.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
                    {p.services.map((s) => (
                      <Badge key={s.id} variant={s.linkActive ? "secondary" : "outline"}>
                        {s.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm sm:table-cell">
                  {p.acceptsMale && p.acceptsFemale ? "Male & female" : p.acceptsMale ? "Male only" : "Female only"}
                </TableCell>
                <TableCell className="hidden text-sm lg:table-cell">
                  {p.account ? (
                    p.account.status === "ACTIVE" ? "Active" : p.account.hasLogin ? "Invited" : "Not sent"
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell>{p.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="providers" />
      {creating && (
        <CreateProviderDialog
          defaultType={type ?? "THERAPIST"}
          onClose={() => setCreating(false)}
          onCreated={(id) => setViewingId(id)}
        />
      )}
      {viewingId && <ProviderDetailDialog id={viewingId} onClose={() => setViewingId(null)} />}
      {bulkDeleting && (
        <BulkDeleteDialog
          count={selected.size}
          noun="provider"
          description="Removes each selected provider from the booking form, availability and admin lists. Their past bookings and payments are kept for records. It only works while they have no dashboard login (deactivate first); any that can't be removed are reported afterward and left untouched."
          deleting={bulkDelete.isPending}
          onConfirm={runBulkDelete}
          onClose={() => setBulkDeleting(false)}
        />
      )}
    </div>
  );
}
