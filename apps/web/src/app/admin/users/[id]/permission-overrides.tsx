"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { PermissionKey, UserDetail } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { groupPermissions, permissionLabel, usePermissionCatalog, useSetUserPermissions } from "@/lib/api/admin";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Mode = "inherit" | "grant" | "deny";

function toMap(user: UserDetail): Map<string, Mode> {
  return new Map(user.permissionOverrides.map((o) => [o.key, o.granted ? "grant" : "deny"]));
}

/** Per-user exceptions on top of roles: explicit grants, or denies that always win. */
export function PermissionOverrides({ user, readOnly }: { user: UserDetail; readOnly: boolean }) {
  const catalog = usePermissionCatalog();
  const save = useSetUserPermissions(user.id);
  const [modes, setModes] = useState(() => toMap(user));
  useEffect(() => setModes(toMap(user)), [user]);

  const effective = useMemo(() => new Set<string>(user.effectivePermissions), [user.effectivePermissions]);
  const initial = toMap(user);
  const dirty =
    modes.size !== initial.size || [...modes].some(([k, v]) => initial.get(k) !== v);

  function setMode(key: string, mode: Mode) {
    setModes((prev) => {
      const next = new Map(prev);
      if (mode === "inherit") next.delete(key);
      else next.set(key, mode);
      return next;
    });
  }

  function submit() {
    const overrides = [...modes].map(([key, mode]) => ({ key, granted: mode === "grant" }));
    save.mutate(
      { overrides },
      {
        onSuccess: () => toast.success("Permission overrides saved"),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save overrides"),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Individual permissions</CardTitle>
        <CardDescription>
          Leave on <em>role default</em> unless this person needs an exception. A deny always wins over roles.
          Highlighted permissions are currently effective.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {catalog.isPending && <Skeleton className="h-48 w-full" />}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {groupPermissions(catalog.data ?? []).map(([module, perms]) => (
            <section key={module} className="space-y-2">
              <h3 className="text-sm font-semibold capitalize">{module.replace(/_/g, " ")}</h3>
              {perms.map((p) => (
                <div key={p.key} className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-sm capitalize",
                      effective.has(p.key) ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                    title={p.key}
                  >
                    {permissionLabel(p.key as PermissionKey)}
                  </span>
                  <Select
                    disabled={readOnly}
                    value={modes.get(p.key) ?? "inherit"}
                    onValueChange={(v) => setMode(p.key, v as Mode)}
                  >
                    <SelectTrigger className="h-8 w-32" aria-label={`${p.key} override`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Role default</SelectItem>
                      <SelectItem value="grant">Grant</SelectItem>
                      <SelectItem value="deny">Deny</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </section>
          ))}
        </div>
      </CardContent>
      {!readOnly && (
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setModes(toMap(user))}>
            Reset
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save overrides"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
