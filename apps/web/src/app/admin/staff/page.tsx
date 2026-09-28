"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import type { StaffListItem } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/app-shell";
import { UserStatusBadge } from "@/components/dashboard/status-badge";
import { Field, fieldA11y } from "@/components/forms/field";
import { Pagination } from "@/components/tables/pagination";
import { usePermissions } from "@/lib/auth/hooks";
import { useStaff, useUpdateStaffProfile } from "@/lib/api/admin";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ApiError } from "@/lib/api-client";

export default function StaffPage() {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<StaffListItem | null>(null);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [debounced]);
  const { data, isPending, error } = useStaff({ page, pageSize: 25, ...(debounced ? { search: debounced } : {}) });

  return (
    <>
      <PageHeader
        title="Staff"
        description="Employment details. Invite people and manage their roles under Accounts & access."
        actions={
          can("staff.create") && (
            <Button variant="outline" asChild>
              <Link href="/admin/users">Invite staff</Link>
            </Button>
          )
        }
      />
      <div className="relative mb-4 w-full max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search staff" placeholder="Name, email or employee code" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Department</TableHead>
              <TableHead className="hidden md:table-cell">Joined</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-20 w-full" />
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
            {data?.data.map((s) => (
              <TableRow key={s.userId}>
                <TableCell>
                  <Link href={`/admin/users/${s.userId}`} className="font-medium hover:underline">
                    {s.firstName} {s.lastName}
                  </Link>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {s.roles.map((r) => (
                      <Badge key={r.key} variant="secondary" className="text-xs">
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">
                  {s.department ?? "-"}
                  {s.jobTitle && <div className="text-xs text-muted-foreground">{s.jobTitle}</div>}
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{s.joiningDate ?? "-"}</TableCell>
                <TableCell>
                  <UserStatusBadge status={s.userStatus} />
                </TableCell>
                <TableCell>
                  {can("staff.update") && (
                    <Button variant="ghost" size="icon" aria-label={`Edit ${s.firstName}`} onClick={() => setEditing(s)}>
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={data?.meta} onPage={setPage} noun="staff" />
      {editing && <EmploymentDialog staff={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const nul = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const schema = z.object({
  employeeCode: z.preprocess(nul, z.string().trim().max(40).nullable()),
  department: z.preprocess(nul, z.string().trim().max(80).nullable()),
  jobTitle: z.preprocess(nul, z.string().trim().max(80).nullable()),
  joiningDate: z.preprocess(nul, z.iso.date().nullable()),
});

function EmploymentDialog({ staff, onClose }: { staff: StaffListItem; onClose: () => void }) {
  const save = useUpdateStaffProfile(staff.userId);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      employeeCode: staff.employeeCode ?? "",
      department: staff.department ?? "",
      jobTitle: staff.jobTitle ?? "",
      joiningDate: staff.joiningDate ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync(v);
      toast.success("Employment details saved");
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        for (const e of err.errors) form.setError(e.path as "employeeCode", { message: e.message });
        toast.error(err.message);
      } else toast.error("Could not save");
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {staff.firstName} {staff.lastName}
          </DialogTitle>
          <DialogDescription>Employment details</DialogDescription>
        </DialogHeader>
        <form id="employment" onSubmit={onSubmit} noValidate className="grid gap-3 sm:grid-cols-2">
          <Field id="em-code" label="Employee code" error={errors.employeeCode?.message} optional info="Internal reference code, e.g. from your HR system">
            <Input {...fieldA11y("em-code", errors.employeeCode?.message)} {...form.register("employeeCode")} />
          </Field>
          <Field id="em-joined" label="Joining date" error={errors.joiningDate?.message} optional>
            <Input type="date" {...fieldA11y("em-joined", errors.joiningDate?.message)} {...form.register("joiningDate")} />
          </Field>
          <Field id="em-dept" label="Department" error={errors.department?.message} optional>
            <Input {...fieldA11y("em-dept", errors.department?.message)} {...form.register("department")} />
          </Field>
          <Field id="em-title" label="Job title" error={errors.jobTitle?.message} optional>
            <Input {...fieldA11y("em-title", errors.jobTitle?.message)} {...form.register("jobTitle")} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="employment" disabled={isSubmitting}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
