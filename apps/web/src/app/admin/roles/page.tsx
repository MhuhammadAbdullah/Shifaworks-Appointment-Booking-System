"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { RoleSummary } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { usePermissions } from "@/lib/auth/hooks";
import {
  groupPermissions,
  permissionLabel,
  useDeleteRole,
  usePermissionCatalog,
  useRoles,
  useUpdateRole,
} from "@/lib/api/admin";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { CreateRoleDialog } from "./create-role-dialog";

export default function RolesPage() {
  const { can } = usePermissions();
  const roles = useRoles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!selectedId && roles.data?.[0]) setSelectedId(roles.data[0].id);
  }, [roles.data, selectedId]);
  const selected = roles.data?.find((r) => r.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="What each role can see and do. Changes apply to every user with the role within 30 seconds."
        actions={
          can("roles.manage") && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New role
            </Button>
          )
        }
      />
      {roles.error && <p className="text-destructive">{roles.error.message}</p>}
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Roles" className="grid content-start gap-1">
          {roles.isPending && <Skeleton className="h-64 w-full" />}
          {roles.data?.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedId(role.id)}
              aria-current={role.id === selectedId ? "true" : undefined}
              className={cn(
                "flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                role.id === selectedId && "bg-accent font-medium",
              )}
            >
              <span className="truncate">{role.name}</span>
              <span className="text-xs text-muted-foreground">{role.userCount}</span>
            </button>
          ))}
        </nav>
        {selected && <RoleEditor key={selected.id} role={selected} canManage={can("roles.manage")} onDeleted={() => setSelectedId(null)} />}
      </div>
      {createOpen && (
        <CreateRoleDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          roles={roles.data ?? []}
          onCreated={(role) => setSelectedId(role.id)}
        />
      )}
    </>
  );
}

function RoleEditor({ role, canManage, onDeleted }: { role: RoleSummary; canManage: boolean; onDeleted: () => void }) {
  const { me } = usePermissions();
  const catalog = usePermissionCatalog();
  const update = useUpdateRole();
  const remove = useDeleteRole();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role.permissions));
  useEffect(() => setSelected(new Set(role.permissions)), [role.permissions]);

  const locked = role.key === "SUPER_ADMIN";
  const readOnly = !canManage || locked;
  const dirty = useMemo(
    () => selected.size !== role.permissions.length || role.permissions.some((p) => !selected.has(p)),
    [selected, role.permissions],
  );
  // The API rejects granting permissions you don't hold; mirror that in the UI.
  const canGrant = (key: string) => Boolean(me?.isSuperAdmin || me?.permissions.includes(key as never));

  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleModule(keys: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on && canGrant(k)) next.add(k);
        if (!on) next.delete(k);
      }
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {role.name}
              {role.isSystem && <Badge variant="secondary">System</Badge>}
              {locked && <Lock className="size-4 text-muted-foreground" aria-label="Locked" />}
            </CardTitle>
            <CardDescription>
              <code className="text-xs">{role.key}</code> · {role.userCount} user{role.userCount === 1 ? "" : "s"}
              {role.description ? ` · ${role.description}` : ""}
            </CardDescription>
          </div>
          {canManage && !role.isSystem && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!window.confirm(`Delete the role "${role.name}"?`)) return;
                remove.mutate(role.id, {
                  onSuccess: () => {
                    toast.success("Role deleted");
                    onDeleted();
                  },
                  onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not delete role"),
                });
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
        </div>
        {locked && (
          <p className="text-sm text-muted-foreground">Super Admin always has every permission and cannot be edited.</p>
        )}
        {(role.key === "THERAPIST" || role.key === "COUNSELLOR") && (
          <p className="text-sm text-muted-foreground">
            Providers only ever see their own appointments and availability, whatever is ticked here.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {catalog.isPending && <Skeleton className="h-64 w-full" />}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {groupPermissions(catalog.data ?? []).map(([module, perms]) => {
            const keys = perms.map((p) => p.key);
            const all = keys.every((k) => selected.has(k));
            return (
              <section key={module} className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-semibold capitalize">
                  <Checkbox
                    disabled={readOnly}
                    checked={all ? true : keys.some((k) => selected.has(k)) ? "indeterminate" : false}
                    onCheckedChange={(c) => toggleModule(keys, c === true)}
                  />
                  {module.replace(/_/g, " ")}
                </label>
                <div className="grid gap-1.5 pl-6">
                  {perms.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-sm capitalize" title={p.key}>
                      <Checkbox
                        disabled={readOnly || (!selected.has(p.key) && !canGrant(p.key))}
                        checked={selected.has(p.key)}
                        onCheckedChange={(c) => toggle(p.key, c === true)}
                      />
                      {permissionLabel(p.key)}
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </CardContent>
      {!readOnly && (
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setSelected(new Set(role.permissions))}>
            Reset
          </Button>
          <Button
            disabled={!dirty || update.isPending}
            onClick={() =>
              update.mutate(
                { id: role.id, body: { permissions: [...selected] } },
                {
                  onSuccess: () => toast.success("Permissions saved"),
                  onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save"),
                },
              )
            }
          >
            {update.isPending ? "Saving…" : "Save permissions"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
