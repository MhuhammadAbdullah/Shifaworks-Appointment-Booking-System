"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { USER_STATUSES, type ListUsersQuery, type UserKind, type UserStatus } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/dashboard/app-shell";
import { BulkActionBar } from "@/components/tables/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/tables/bulk-delete-dialog";
import { UserStatusBadge } from "@/components/dashboard/status-badge";
import { usePermissions } from "@/lib/auth/hooks";
import { useBulkDeleteUsers, useUsers } from "@/lib/api/admin";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ApiError } from "@/lib/api-client";
import { CreateUserDialog } from "./create-user-dialog";

const PAGE_SIZE = 20;
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function UsersPage() {
  const { me, can } = usePermissions();
  const [kind, setKind] = useState<UserKind>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<UserStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const debouncedSearch = useDebounced(search);
  const canDelete = can("staff.delete");
  const bulkDelete = useBulkDeleteUsers();

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [kind, debouncedSearch, status]);
  useEffect(() => setSelected(new Set()), [page]);

  const query: Partial<ListUsersQuery> = {
    kind,
    page,
    pageSize: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(status !== "all" ? { status } : {}),
  };
  const { data, isPending, isFetching, error } = useUsers(query);
  const users = data?.data ?? [];
  const meta = data?.meta;

  // Never offer to delete yourself, even in bulk.
  const rowIds = users.filter((u) => u.id !== me?.user.id).map((u) => u.id);
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
        if (result.failed.length === 0) toast.success(`${result.succeeded} account${result.succeeded === 1 ? "" : "s"} deleted`);
        else toast(`${result.succeeded} deleted, ${result.failed.length} could not be deleted (they have activity history)`);
      },
      onError: (e) => toast.error(errorText(e, "Could not delete the selected accounts")),
    });
  };

  return (
    <>
      <PageHeader
        title="Accounts & access"
        description="Everyone who can sign in: staff, therapists and counsellors. Customers never have accounts."
        actions={
          can("staff.create") && (
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus className="size-4" /> Invite staff
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={kind} onValueChange={(v) => setKind(v as UserKind)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="provider">Providers</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search users"
            placeholder="Search name, email, phone"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as UserStatus | "all")}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {USER_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {canDelete && (
        <BulkActionBar count={selected.size} noun="account" onDelete={() => setBulkDeleting(true)} onClear={() => setSelected(new Set())} />
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canDelete && (
                <TableHead className="w-10">
                  {rowIds.length > 0 && (
                    <Checkbox
                      aria-label="Select all accounts on this page"
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                  )}
                </TableHead>
              )}
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="hidden md:table-cell">Department</TableHead>
              <TableHead className="hidden lg:table-cell">Joined</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={isFetching && !isPending ? "opacity-60" : undefined}>
            {isPending &&
              Array.from({ length: 5 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={canDelete ? 7 : 6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {error && (
              <TableRow>
                <TableCell colSpan={canDelete ? 7 : 6} className="py-8 text-center text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {!isPending && !error && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={canDelete ? 7 : 6} className="py-8 text-center text-muted-foreground">
                  No users match these filters.
                </TableCell>
              </TableRow>
            )}
            {users.map((u) => (
              <TableRow key={u.id} data-state={selected.has(u.id) ? "selected" : undefined}>
                {canDelete && (
                  <TableCell>
                    {u.id !== me?.user.id && (
                      <Checkbox aria-label={`Select ${u.firstName}`} checked={selected.has(u.id)} onCheckedChange={() => toggleOne(u.id)} />
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                    {u.firstName} {u.lastName}
                  </Link>
                  <div className="text-xs text-muted-foreground">{u.email ?? u.phone ?? "No contact"}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.id} variant="secondary">
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{u.department ?? "-"}</TableCell>
                <TableCell className="hidden text-sm lg:table-cell">{u.joiningDate ?? "-"}</TableCell>
                <TableCell>
                  <UserStatusBadge status={u.status} />
                  {!u.hasLogin && <div className="mt-1 text-xs text-muted-foreground">No login</div>}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {meta.total} users · page {meta.page} of {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {createOpen && <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {bulkDeleting && (
        <BulkDeleteDialog
          count={selected.size}
          noun="account"
          description="This permanently removes each selected account - it only works while they have no activity history (bookings, payments and similar). Any that can't be deleted are reported afterward and left untouched."
          deleting={bulkDelete.isPending}
          onConfirm={runBulkDelete}
          onClose={() => setBulkDeleting(false)}
        />
      )}
    </>
  );
}
