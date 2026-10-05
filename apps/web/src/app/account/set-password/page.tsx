"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { passwordSchema } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, fieldA11y } from "@/components/forms/field";
import { PasswordInput } from "@/components/forms/password-input";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { authedRequest } from "@/lib/auth/api";
import { useMe, homePathFor } from "@/lib/auth/hooks";

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

/** Reached from a password-reset link (session already set) or from the profile page. New staff/provider accounts get a password directly from the admin, so this page is never part of onboarding. */
export default function SetPasswordPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    const { error } = await getSupabaseBrowserClient().auth.updateUser({ password });
    if (error) {
      form.setError("password", { message: error.message });
      return;
    }
    // Lifts the restriction a password-reset-link session starts under (see recovery-lock.ts) —
    // harmless, and required, for an ordinary session too (nothing to lift there).
    await authedRequest("/auth/confirm-recovery", { method: "POST" }).catch(() => undefined);
    toast.success("Password saved");
    router.replace((me && homePathFor(me)) ?? "/admin");
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set your password</CardTitle>
        <CardDescription>At least 10 characters with upper- and lowercase letters and a number.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          <Field id="password" label="New password" error={errors.password?.message}>
            <PasswordInput
              autoComplete="new-password"
              {...fieldA11y("password", errors.password?.message)}
              {...form.register("password")}
            />
          </Field>
          <Field id="confirm" label="Confirm password" error={errors.confirm?.message}>
            <PasswordInput
              autoComplete="new-password"
              {...fieldA11y("confirm", errors.confirm?.message)}
              {...form.register("confirm")}
            />
          </Field>
        </CardContent>
        <CardFooter className="mt-4 justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save password"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
