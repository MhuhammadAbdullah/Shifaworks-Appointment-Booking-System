"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { OrgSettings, UpdateOrganizationInput } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CheckField } from "@/components/forms/check-field";
import { Field } from "@/components/forms/field";
import { ImageUpload } from "@/components/forms/image-upload";
import { PageHeader } from "@/components/dashboard/app-shell";
import { useSettings, useUpdateSettings } from "@/lib/api/settings";
import { ApiError } from "@/lib/api-client";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

type FormValues = UpdateOrganizationInput & OrgSettings & { adminEmailsText: string };

export default function SettingsPage() {
  const { data, isPending, error } = useSettings();
  const update = useUpdateSettings();
  const form = useForm<FormValues>({ defaultValues: {} });
  // undefined = unchanged from the server; null = removed; an object = a freshly uploaded logo.
  const [logo, setLogo] = useState<{ id: string; url: string } | null | undefined>(undefined);

  useEffect(() => {
    if (!data) return;
    form.reset({
      name: data.organization.name,
      timezone: data.organization.timezone,
      currency: data.organization.currency,
      locale: data.organization.locale,
      email: data.organization.email ?? "",
      phone: data.organization.phone ?? "",
      website: data.organization.website ?? "",
      ...data.settings,
      adminEmailsText: data.settings.adminEmails.join("\n"),
    });
    setLogo(undefined);
  }, [data, form]);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data) return null;

  const logoUrl = logo !== undefined ? (logo?.url ?? null) : data.organization.logoUrl;

  const onSubmit = form.handleSubmit((v) => {
    const { name, timezone, currency, locale, email, phone, website, adminEmailsText, ...settings } = v;
    update.mutate(
      {
        organization: {
          name,
          timezone,
          currency,
          locale,
          email: email || null,
          phone: phone || null,
          website: website || null,
          ...(logo !== undefined ? { logoFileId: logo?.id ?? null } : {}),
        },
        settings: {
          ...settings,
          adminEmails: adminEmailsText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      },
      { onSuccess: () => toast.success("Settings saved"), onError: (e) => toast.error(errorText(e, "Could not save settings")) },
    );
  });

  return (
    <div>
      <PageHeader title="Settings" description="Organisation details, support contacts, payment instructions and booking rules." />
      <form onSubmit={onSubmit} className="grid gap-6">
        <Tabs defaultValue="organization">
          <TabsList className="flex-wrap">
            <TabsTrigger value="organization">Organisation</TabsTrigger>
            <TabsTrigger value="support">Support</TabsTrigger>
            <TabsTrigger value="payment">Payment</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="booking">Booking</TabsTrigger>
            <TabsTrigger value="cancellation">Cancellation</TabsTrigger>
            <TabsTrigger value="invoice">Invoice</TabsTrigger>
          </TabsList>

          <TabsContent value="organization">
            <Card>
              <CardHeader>
                <CardTitle>Organisation</CardTitle>
                <CardDescription>Shown on invoices and used to format dates and money across the app.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="org-logo">Logo</Label>
                  <ImageUpload id="org-logo" shape="wide" url={logoUrl} onChange={setLogo} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-name" label="Name" required><Input id="s-name" {...form.register("name")} /></Field>
                <Field id="s-timezone" label="Timezone" required info="IANA timezone name, e.g. Asia/Karachi"><Input id="s-timezone" {...form.register("timezone")} /></Field>
                <Field id="s-currency" label="Currency" required info="3-letter ISO code, e.g. PKR"><Input id="s-currency" maxLength={3} className="uppercase" {...form.register("currency")} /></Field>
                <Field id="s-locale" label="Locale" required><Input id="s-locale" {...form.register("locale")} /></Field>
                <Field id="s-org-email" label="Organisation email" optional><Input id="s-org-email" type="email" {...form.register("email")} /></Field>
                <Field id="s-org-phone" label="Organisation phone" optional><Input id="s-org-phone" {...form.register("phone")} /></Field>
                <Field id="s-org-website" label="Website" optional className="sm:col-span-2"><Input id="s-org-website" {...form.register("website")} /></Field>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="support">
            <Card>
              <CardHeader>
                <CardTitle>Support contacts</CardTitle>
                <CardDescription>Shown to customers on booking forms and in confirmation emails.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field id="s-support-email" label="Support email" optional><Input id="s-support-email" type="email" {...form.register("supportEmail")} /></Field>
                <Field id="s-support-phone" label="Support phone" optional><Input id="s-support-phone" {...form.register("supportPhone")} /></Field>
                <Field
                  id="s-whatsapp"
                  label="WhatsApp number"
                  optional
                  info="Include the country code, e.g. +923001234567"
                  className="sm:col-span-2"
                >
                  <Input id="s-whatsapp" placeholder="+923001234567" {...form.register("whatsappNumber")} />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payment">
            <Card>
              <CardHeader>
                <CardTitle>Payment details</CardTitle>
                <CardDescription>Shown to customers after they submit a booking form, so they know where to send payment.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field id="s-bank" label="Bank name" optional><Input id="s-bank" {...form.register("paymentBankName")} /></Field>
                <Field id="s-acct-title" label="Account title" optional><Input id="s-acct-title" {...form.register("paymentAccountTitle")} /></Field>
                <Field id="s-acct-number" label="Account number" optional><Input id="s-acct-number" {...form.register("paymentAccountNumber")} /></Field>
                <Field id="s-iban" label="IBAN" optional><Input id="s-iban" {...form.register("paymentIban")} /></Field>
                <Field id="s-jazzcash" label="JazzCash" optional><Input id="s-jazzcash" {...form.register("paymentJazzcash")} /></Field>
                <Field id="s-easypaisa" label="Easypaisa" optional><Input id="s-easypaisa" {...form.register("paymentEasypaisa")} /></Field>
                <Field
                  id="s-instructions"
                  label="Instructions"
                  optional
                  info="Shown alongside the payment details customers see after submitting a booking"
                  className="sm:col-span-2"
                >
                  <Textarea id="s-instructions" rows={3} {...form.register("paymentInstructions")} />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle>Email</CardTitle>
                <CardDescription>Who receives new-booking notifications, and the sender name on outgoing mail.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field id="s-from-name" label="Sender name" optional><Input id="s-from-name" {...form.register("emailFromName")} /></Field>
                <Field
                  id="s-admin-emails"
                  label="Admin emails (one per line)"
                  optional
                  info="Each address gets a copy of every new-booking notification - leave empty and no one is notified"
                >
                  <Textarea id="s-admin-emails" rows={3} placeholder="admin@example.com" {...form.register("adminEmailsText")} />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="booking">
            <Card>
              <CardHeader>
                <CardTitle>Booking</CardTitle>
                <CardDescription>Defaults and rules that apply across every service.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field id="s-duration" label="Default duration (minutes)" required>
                  <Input id="s-duration" type="number" min={5} {...form.register("defaultDurationMinutes", { valueAsNumber: true })} />
                </Field>
                <Field id="s-window" label="Unpaid booking window (hours, 0 = never)" required>
                  <Input id="s-window" type="number" min={0} {...form.register("paymentWindowHours", { valueAsNumber: true })} />
                </Field>
                <Field id="s-terms" label="Terms & Conditions URL" optional className="sm:col-span-2">
                  <Input id="s-terms" {...form.register("termsUrl")} />
                </Field>
                <CheckField
                  id="s-auto-confirm"
                  label="Verifying a payment confirms the booking immediately"
                  checked={form.watch("autoConfirmOnVerify")}
                  onCheckedChange={(v) => form.setValue("autoConfirmOnVerify", v, { shouldDirty: true })}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cancellation">
            <Card>
              <CardHeader>
                <CardTitle>Cancellation</CardTitle>
                <CardDescription>Policy text shown in confirmation emails, and staff reference for cutoff notice.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field id="s-cutoff" label="Minimum notice (hours)" required info="Staff reference only - not enforced automatically">
                  <Input id="s-cutoff" type="number" min={0} {...form.register("cancellationCutoffHours", { valueAsNumber: true })} />
                </Field>
                <Field id="s-policy" label="Policy text" optional info="Shown in booking confirmation emails">
                  <Textarea id="s-policy" rows={4} {...form.register("cancellationPolicy")} />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoice">
            <Card>
              <CardHeader>
                <CardTitle>Invoice</CardTitle>
                <CardDescription>Defaults applied to every invoice raised.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field id="s-due-days" label="Default due (days)" required>
                  <Input id="s-due-days" type="number" min={0} {...form.register("invoiceDefaultDueDays", { valueAsNumber: true })} />
                </Field>
                <Field id="s-footer" label="Footer text" optional>
                  <Textarea id="s-footer" rows={2} {...form.register("invoiceFooter")} />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </div>
  );
}
