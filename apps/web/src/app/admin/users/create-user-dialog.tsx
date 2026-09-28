"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { PROVIDER_ROLE_KEYS, createUserSchema } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, fieldA11y } from "@/components/forms/field";
import { PasswordInput } from "@/components/forms/password-input";
import { useCreateUser, useRoles } from "@/lib/api/admin";
import { usePermissions } from "@/lib/auth/hooks";
import { ApiError } from "@/lib/api-client";
import { generatePassword } from "@/lib/generate-password";

const blankToUndefined = (v: string) => (v?.trim() ? v : undefined);

export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { me } = usePermissions();
  const roles = useRoles(open);
  const create = useCreateUser();
  const form = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      roleIds: [] as string[],
      sendInvite: true,
      password: "",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const sendInvite = form.watch("sendInvite");

  // Therapist/counsellor logins are invited from their provider profile, so
  // only staff roles are offered here; only a super admin hands out SUPER_ADMIN.
  const providerRoles = new Set<string>(PROVIDER_ROLE_KEYS);
  const assignable = (roles.data ?? []).filter(
    (r) => !providerRoles.has(r.key) && (r.key !== "SUPER_ADMIN" || me?.isSuperAdmin),
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const user = await create.mutateAsync(values);
      toast.success(values.sendInvite ? `Login credentials emailed to ${user.email}` : "User created");
      onOpenChange(false);
      router.push(`/admin/users/${user.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) {
        for (const e of err.errors) form.setError(e.path as "email", { message: e.message });
      }
      toast.error(err instanceof ApiError ? err.message : "Could not create the user");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a staff member</DialogTitle>
          <DialogDescription>Set their password below; they&apos;ll receive it by email and can sign in right away.</DialogDescription>
        </DialogHeader>
        <form id="create-user" onSubmit={onSubmit} noValidate className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cu-first" label="First name" error={errors.firstName?.message} required>
              <Input {...fieldA11y("cu-first", errors.firstName?.message)} {...form.register("firstName")} />
            </Field>
            <Field id="cu-last" label="Last name" error={errors.lastName?.message} optional>
              <Input {...fieldA11y("cu-last", errors.lastName?.message)} {...form.register("lastName")} />
            </Field>
          </div>
          <Field id="cu-email" label="Email" error={errors.email?.message} required>
            <Input type="email" {...fieldA11y("cu-email", errors.email?.message)} {...form.register("email")} />
          </Field>
          <Field id="cu-phone" label="Phone" error={errors.phone?.message} optional>
            <Input
              type="tel"
              {...fieldA11y("cu-phone", errors.phone?.message)}
              {...form.register("phone", { setValueAs: blankToUndefined })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cu-dept" label="Department" error={errors.department?.message} optional>
              <Input {...form.register("department", { setValueAs: blankToUndefined })} id="cu-dept" />
            </Field>
            <Field id="cu-title" label="Job title" error={errors.jobTitle?.message} optional>
              <Input {...form.register("jobTitle", { setValueAs: blankToUndefined })} id="cu-title" />
            </Field>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">
              Roles
              <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </legend>
            {roles.isPending && <p className="text-sm text-muted-foreground">Loading roles…</p>}
            {roles.error && <p className="text-sm text-destructive">{roles.error.message}</p>}
            <Controller
              control={form.control}
              name="roleIds"
              render={({ field }) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  {assignable.map((role) => {
                    const checked = field.value.includes(role.id);
                    return (
                      <label key={role.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) =>
                            field.onChange(c ? [...field.value, role.id] : field.value.filter((id) => id !== role.id))
                          }
                        />
                        <span>
                          <span className="font-medium">{role.name}</span>
                          {role.description && (
                            <span className="block text-xs text-muted-foreground">{role.description}</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            />
            {errors.roleIds && <p className="text-sm text-destructive">{errors.roleIds.message}</p>}
            <p className="text-sm text-muted-foreground">
              Therapists and counsellors get their login from their provider profile (Providers → Invite).
            </p>
          </fieldset>

          <Controller
            control={form.control}
            name="sendInvite"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Checkbox id="cu-invite" checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />
                <Label htmlFor="cu-invite" className="font-normal">
                  Create the login and email the credentials now
                </Label>
              </div>
            )}
          />

          {sendInvite && (
            <Field id="cu-password" label="Password" error={errors.password?.message} required hint="At least 10 characters with upper- and lowercase letters and a number.">
              <div className="flex gap-2">
                <PasswordInput
                  autoComplete="new-password"
                  {...fieldA11y("cu-password", errors.password?.message)}
                  {...form.register("password")}
                />
                <Button type="button" variant="outline" size="icon" title="Generate a password" onClick={() => form.setValue("password", generatePassword(), { shouldValidate: true })}>
                  <RefreshCw className="size-4" />
                </Button>
              </div>
            </Field>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-user" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
