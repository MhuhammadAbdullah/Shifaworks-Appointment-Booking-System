"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { passwordSchema } from "@booking/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, fieldA11y } from "@/components/forms/field";
import { PasswordInput } from "@/components/forms/password-input";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const schema = z
  .object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords do not match" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Choose a password different from your current one" });

/**
 * Requires the current password before accepting a new one — unlike the
 * forgot-password recovery link (which has to work without it), this is a
 * voluntary change from someone already signed in, so confirming they still
 * know the real password stops a briefly-unlocked device from being used to
 * lock the real owner out.
 */
export function ChangePasswordDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (verifyError) {
      form.setError("currentPassword", { message: "Current password is incorrect" });
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setFormError(updateError.message);
      return;
    }
    toast.success("Password changed");
    onClose();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Enter your current password, then choose a new one.</DialogDescription>
        </DialogHeader>
        <form id="change-password" onSubmit={onSubmit} noValidate className="grid gap-4">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <Field id="cp-current" label="Current password" error={errors.currentPassword?.message}>
            <PasswordInput
              autoComplete="current-password"
              {...fieldA11y("cp-current", errors.currentPassword?.message)}
              {...form.register("currentPassword")}
            />
          </Field>
          <Field id="cp-new" label="New password" error={errors.newPassword?.message} hint="At least 10 characters with upper- and lowercase letters and a number.">
            <PasswordInput
              autoComplete="new-password"
              {...fieldA11y("cp-new", errors.newPassword?.message)}
              {...form.register("newPassword")}
            />
          </Field>
          <Field id="cp-confirm" label="Confirm new password" error={errors.confirm?.message}>
            <PasswordInput
              autoComplete="new-password"
              {...fieldA11y("cp-confirm", errors.confirm?.message)}
              {...form.register("confirm")}
            />
          </Field>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="change-password" disabled={isSubmitting}>
            {isSubmitting ? "Changing…" : "Change password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
