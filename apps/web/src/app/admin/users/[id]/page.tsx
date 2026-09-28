"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PROVIDER_TYPE_LABELS, type UserDetail } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { UserStatusBadge } from "@/components/dashboard/status-badge";
import { usePermissions } from "@/lib/auth/hooks";
import { useDeleteUser, useRoles, useSendInvite, useSetUserRoles, useUser } from "@/lib/api/admin";
import { ApiError } from "@/lib/api-client";
import { UserDetailsForm } from "./user-details-form";
import { StatusActions } from "./status-actions";
import { PermissionOverrides } from "./permission-overrides";

const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me, can } = usePermissions();
  const { data: user, isPending, error } = useUser(id);
  const invite = useSendInvite(id);
  const remove = useDeleteUser();

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !user) {
    return <p className="text-destructive">{error?.message ?? "User not found"}</p>;
  }

  const isSelf = me?.user.id === user.id;
  const canUpdate = can("staff.update");
  const canDelete = can("staff.delete");

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/users" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Accounts &amp; access
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {user.firstName} {user.lastName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{user.email ?? "No email"}</span>
              <UserStatusBadge status={user.status} />
              {!user.hasLogin && <Badge variant="outline">No login yet</Badge>}
              {user.providerProfile && (
                <Badge variant="outline">
                  {PROVIDER_TYPE_LABELS[user.providerProfile.providerType]} · {user.providerProfile.displayName}
                </Badge>
              )}
            </div>
          </div>
          {!isSelf && canUpdate && (
            <div className="flex flex-wrap gap-2">
              {(user.status === "INVITED" || !user.hasLogin) && user.email && (
                <Button
                  variant="outline"
                  disabled={invite.isPending}
                  onClick={() =>
                    invite.mutate(undefined, {
                      onSuccess: () => toast.success(`Email sent to ${user.email}`),
                      onError: (err) => toast.error(errorMessage(err, "Could not send the email")),
                    })
                  }
                >
                  <Mail className="size-4" /> {user.hasLogin ? "Resend setup email" : "Send invitation"}
                </Button>
              )}
              <StatusActions user={user} canDeactivate={can("staff.delete")} />
              {canDelete && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(`Delete ${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}? This cannot be undone.`)) return;
                    remove.mutate(user.id, {
                      onSuccess: () => {
                        toast.success("Account deleted");
                        router.push("/admin/users");
                      },
                      onError: (err) => toast.error(errorMessage(err, "Could not delete this account")),
                    });
                  }}
                >
                  <Trash2 className="size-4" /> Delete
                </Button>
              )}
            </div>
          )}
        </div>
        {isSelf && (
          <p className="mt-2 text-sm text-muted-foreground">
            This is your own account. Roles, permissions and status must be changed by another administrator.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <UserDetailsForm user={user} readOnly={!canUpdate} />
        <RolesCard user={user} readOnly={isSelf || !can("staff.update")} />
      </div>

      {can("roles.manage") && <PermissionOverrides user={user} readOnly={isSelf} />}
    </div>
  );
}

function RolesCard({ user, readOnly }: { user: UserDetail; readOnly: boolean }) {
  const { me } = usePermissions();
  const roles = useRoles();
  const save = useSetUserRoles(user.id);
  const initial = user.roles.map((r) => r.id);
  const [selected, setSelected] = useState<string[]>(initial);
  useEffect(() => setSelected(user.roles.map((r) => r.id)), [user.roles]);

  const dirty = selected.length !== initial.length || selected.some((id) => !initial.includes(id));
  const visible = (roles.data ?? []).filter((r) => r.key !== "SUPER_ADMIN" || me?.isSuperAdmin || initial.includes(r.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
        <CardDescription>Permissions come from roles plus any individual overrides below.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {roles.isPending && <Skeleton className="h-24 w-full sm:col-span-2" />}
        {visible.map((role) => (
          <label key={role.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <Checkbox
              disabled={readOnly || (role.key === "SUPER_ADMIN" && !me?.isSuperAdmin)}
              checked={selected.includes(role.id)}
              onCheckedChange={(c) =>
                setSelected((s) => (c ? [...s, role.id] : s.filter((id) => id !== role.id)))
              }
            />
            {role.name}
          </label>
        ))}
      </CardContent>
      {!readOnly && (
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setSelected(initial)}>
            Reset
          </Button>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(selected, {
                onSuccess: () => toast.success("Roles updated"),
                onError: (err) => toast.error(errorMessage(err, "Could not update roles")),
              })
            }
          >
            {save.isPending ? "Saving…" : "Save roles"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
