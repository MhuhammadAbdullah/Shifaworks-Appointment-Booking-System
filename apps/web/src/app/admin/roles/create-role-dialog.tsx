"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { createRoleSchema, type RoleSummary } from "@booking/shared";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldA11y } from "@/components/forms/field";
import { useCreateRole } from "@/lib/api/admin";
import { usePermissions } from "@/lib/auth/hooks";
import { ApiError } from "@/lib/api-client";

export function CreateRoleDialog({
  open,
  onOpenChange,
  roles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: RoleSummary[];
  onCreated: (role: RoleSummary) => void;
}) {
  const { me } = usePermissions();
  const create = useCreateRole();
  const [copyFrom, setCopyFrom] = useState("none");
  const form = useForm({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { key: "", name: "", description: "", permissions: [] as string[] },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const base = roles.find((r) => r.id === copyFrom);
    // Only copy permissions the creator holds, or the API would reject the request.
    const permissions = (base?.permissions ?? []).filter(
      (p) => me?.isSuperAdmin || me?.permissions.includes(p),
    );
    try {
      const role = await create.mutateAsync({ ...values, permissions });
      toast.success("Role created");
      onCreated(role);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create role");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>Create a custom role, optionally starting from an existing one.</DialogDescription>
        </DialogHeader>
        <form id="create-role" onSubmit={onSubmit} noValidate className="grid gap-4">
          <Field id="cr-name" label="Name" error={errors.name?.message} required>
            <Input placeholder="Senior Receptionist" {...fieldA11y("cr-name", errors.name?.message)} {...form.register("name")} />
          </Field>
          <Field id="cr-key" label="Key" error={errors.key?.message} required info="Uppercase identifier, e.g. SENIOR_RECEPTIONIST">
            <Input {...fieldA11y("cr-key", errors.key?.message)} {...form.register("key")} />
          </Field>
          <Field id="cr-desc" label="Description" error={errors.description?.message} optional>
            <Textarea
              {...fieldA11y("cr-desc", errors.description?.message)}
              {...form.register("description", { setValueAs: (v: string) => (v?.trim() ? v : undefined) })}
            />
          </Field>
          <Field id="cr-copy" label="Start with permissions from" optional>
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger id="cr-copy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No permissions</SelectItem>
                {roles
                  .filter((r) => r.key !== "SUPER_ADMIN")
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-role" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
