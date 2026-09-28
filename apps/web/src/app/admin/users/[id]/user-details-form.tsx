"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import type { UserDetail } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, fieldA11y } from "@/components/forms/field";
import { useUpdateUser } from "@/lib/api/admin";
import { ApiError } from "@/lib/api-client";

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
  department: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  jobTitle: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
});

function toForm(u: UserDetail) {
  return {
    firstName: u.firstName,
    lastName: u.lastName ?? "",
    phone: u.phone ?? "",
    department: u.staffProfile?.department ?? "",
    jobTitle: u.staffProfile?.jobTitle ?? "",
  };
}

export function UserDetailsForm({ user, readOnly }: { user: UserDetail; readOnly: boolean }) {
  const update = useUpdateUser(user.id);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: toForm(user) });
  const { errors, isDirty } = form.formState;
  useEffect(() => form.reset(toForm(user)), [user, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    const { department, jobTitle, ...rest } = values;
    try {
      await update.mutateAsync(user.staffProfile ? values : rest);
      toast.success("Details saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly}>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="ud-first" label="First name" error={errors.firstName?.message} required>
                <Input {...fieldA11y("ud-first", errors.firstName?.message)} {...form.register("firstName")} />
              </Field>
              <Field id="ud-last" label="Last name" error={errors.lastName?.message} optional>
                <Input {...fieldA11y("ud-last", errors.lastName?.message)} {...form.register("lastName")} />
              </Field>
            </div>
            <Field id="ud-phone" label="Phone" error={errors.phone?.message} optional>
              <Input type="tel" {...fieldA11y("ud-phone", errors.phone?.message)} {...form.register("phone")} />
            </Field>
            {user.staffProfile && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="ud-dept" label="Department" error={errors.department?.message} optional>
                  <Input {...fieldA11y("ud-dept", errors.department?.message)} {...form.register("department")} />
                </Field>
                <Field id="ud-title" label="Job title" error={errors.jobTitle?.message} optional>
                  <Input {...fieldA11y("ud-title", errors.jobTitle?.message)} {...form.register("jobTitle")} />
                </Field>
              </div>
            )}
          </CardContent>
        </fieldset>
        {!readOnly && (
          <CardFooter className="mt-4 justify-end">
            <Button type="submit" disabled={!isDirty || update.isPending}>
              {update.isPending ? "Saving…" : "Save details"}
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}
