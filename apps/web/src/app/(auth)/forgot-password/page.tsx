"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema } from "@booking/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, fieldA11y } from "@/components/forms/field";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const schema = loginSchema.pick({ email: true });

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/account/set-password`,
    });
    // Same message whether or not the account exists (no account enumeration).
    setSent(true);
  });

  if (sent) {
    return (
      <Alert>
        <AlertTitle>Check your email</AlertTitle>
        <AlertDescription>
          If an account exists for that address, you will receive a link to set a new password.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-muted gap-8 py-8 shadow-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>We&apos;ll email you a link to choose a new password.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent>
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="email" {...fieldA11y("email", errors.email?.message)} {...form.register("email")} />
          </Field>
        </CardContent>
        <CardFooter className="mt-2 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
          <Link href="/login" className="text-sm text-muted-foreground hover:underline">
            Back to sign in
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
