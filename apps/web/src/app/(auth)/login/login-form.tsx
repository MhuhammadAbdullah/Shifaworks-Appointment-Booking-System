"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { loginSchema, type MeResponse } from "@booking/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, fieldA11y } from "@/components/forms/field";
import { PasswordInput } from "@/components/forms/password-input";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { authedRequest } from "@/lib/auth/api";
import { safeNextPath } from "@/lib/auth/redirect";
import { homePathFor, meQueryKey } from "@/lib/auth/hooks";
import { ApiError } from "@/lib/api-client";
import { publicEnv } from "@/lib/env";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword(values);
    if (signInError) {
      setError(
        signInError.code === "email_not_confirmed"
          ? "Please confirm your email address first. Check your inbox."
          : "Incorrect email or password.",
      );
      return;
    }
    try {
      // Resolves the account on the API (invite-only: unknown emails are refused).
      const me = (await authedRequest<MeResponse>("/auth/me")).data;
      const home = homePathFor(me);
      if (!home) {
        await supabase.auth.signOut();
        setError("Your account has no dashboard access yet. Please contact an administrator.");
        return;
      }
      queryClient.setQueryData(meQueryKey, me);
      router.replace(safeNextPath(params.get("next"), home));
      router.refresh();
    } catch (err) {
      await supabase.auth.signOut();
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>For ShifaWorks staff, therapists and counsellors.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="email" {...fieldA11y("email", errors.email?.message)} {...form.register("email")} />
          </Field>
          <Field id="password" label="Password" error={errors.password?.message}>
            <PasswordInput
              autoComplete="current-password"
              {...fieldA11y("password", errors.password?.message)}
              {...form.register("password")}
            />
          </Field>
          <Link href="/forgot-password" className="justify-self-end text-sm text-muted-foreground hover:underline">
            Forgot password?
          </Link>
        </CardContent>
        <CardFooter className="mt-4 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Accounts are created by invitation. Looking to book a session?{" "}
            <a href={publicEnv.NEXT_PUBLIC_WEBSITE_URL} className="font-medium text-foreground hover:underline">
              Visit shifaworks.com
            </a>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
