"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import type { MeResponse } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, fieldA11y } from "@/components/forms/field";
import { ChangePasswordDialog } from "@/components/account/change-password-dialog";
import { authedRequest } from "@/lib/auth/api";
import { meQueryKey, useMe } from "@/lib/auth/hooks";
import { ApiError } from "@/lib/api-client";

// Form-level schema: empty inputs become null so they clear the stored value.
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const schema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  phone: z.preprocess(
    emptyToNull,
    z
      .string()
      .transform((v) => v.replace(/[\s-]/g, ""))
      .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, "Enter a valid phone number"))
      .nullable(),
  ),
});

/**
 * Name, phone and a change-password link for the account that's signed in —
 * the login identity, not the public-facing provider card (ProviderProfileForm
 * covers that separately: designation, bio, photo, booking-form phone).
 */
export function AccountIdentityCards() {
  const { data: me, isPending } = useMe();
  const queryClient = useQueryClient();
  const [changingPassword, setChangingPassword] = useState(false);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { firstName: "", lastName: "", phone: "" },
  });
  const { errors, isDirty } = form.formState;

  useEffect(() => {
    if (me) {
      form.reset({ firstName: me.user.firstName, lastName: me.user.lastName ?? "", phone: me.user.phone ?? "" });
    }
  }, [me, form]);

  const save = useMutation({
    mutationFn: (body: z.output<typeof schema>) =>
      authedRequest<MeResponse>("/auth/me", { method: "PATCH", body }).then((r) => r.data),
    onSuccess: (updated) => {
      queryClient.setQueryData(meQueryKey, updated);
      form.reset({
        firstName: updated.user.firstName,
        lastName: updated.user.lastName ?? "",
        phone: updated.user.phone ?? "",
      });
      toast.success("Profile updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save your profile"),
  });

  if (isPending || !me) return <Skeleton className="h-80 w-full" />;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>{me.user.email}</CardDescription>
        </CardHeader>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="firstName" label="First name" error={errors.firstName?.message}>
                <Input {...fieldA11y("firstName", errors.firstName?.message)} {...form.register("firstName")} />
              </Field>
              <Field id="lastName" label="Last name" error={errors.lastName?.message}>
                <Input {...fieldA11y("lastName", errors.lastName?.message)} {...form.register("lastName")} />
              </Field>
            </div>
            <Field id="phone" label="Phone" error={errors.phone?.message}>
              <Input type="tel" {...fieldA11y("phone", errors.phone?.message)} {...form.register("phone")} />
            </Field>
          </CardContent>
          <CardFooter className="mt-4 justify-end">
            <Button type="submit" disabled={!isDirty || save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        </form>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Choose a new password for your account.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" onClick={() => setChangingPassword(true)}>
            Change password
          </Button>
        </CardFooter>
      </Card>
      {changingPassword && me.user.email && (
        <ChangePasswordDialog email={me.user.email} onClose={() => setChangingPassword(false)} />
      )}
    </div>
  );
}
