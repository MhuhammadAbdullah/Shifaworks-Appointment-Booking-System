"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BellRing, CalendarOff, ChevronRight, MapPin, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { SettingsDto } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/dashboard/app-shell";
import { CheckField } from "@/components/forms/check-field";
import { ImageUpload } from "@/components/forms/image-upload";
import { usePermissions } from "@/lib/auth/hooks";
import { useSettings, useUpdateBookingSettings, useUpdateInvoiceSettings, useUpdateNotificationSettings, useUpdateOrganization } from "@/lib/api/reports";
import { ApiError } from "@/lib/api-client";

const errorText = (e: unknown, fallback: string) =>
  e instanceof ApiError ? [e.message, ...e.errors.map((x) => x.message)].filter((v, i, a) => v && a.indexOf(v) === i).join(": ") : fallback;

const COMMON_CURRENCIES = ["PKR", "USD", "EUR", "GBP", "AED", "SAR", "CAD", "AUD", "INR"];

export default function SettingsPage() {
  const { data: s, isPending, error } = useSettings();
  const { can } = usePermissions();
  return (
    <>
      <PageHeader title="Settings" description="Organisation details and the rules the system applies. Every change is recorded in the audit log." />
      {error && <p className="text-destructive">{error.message}</p>}
      {isPending && <Skeleton className="h-96 w-full" />}
      {s && (
        <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="grid content-start gap-6">
            <OrganizationCard s={s} />
            <BookingCard s={s} />
            <NotificationsCard s={s} />
            <InvoicesCard s={s} />
          </div>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">More settings</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              <MoreLink href="/admin/locations" icon={<MapPin className="size-4" />} label="Locations & time zones" />
              <MoreLink href="/admin/holidays" icon={<CalendarOff className="size-4" />} label="Holidays & closures" />
              {(can("notifications.view") || can("notifications.manage_templates")) && (
                <MoreLink href="/admin/notifications/reminders" icon={<BellRing className="size-4" />} label="Reminders & message templates" />
              )}
              {can("roles.view") && <MoreLink href="/admin/roles" icon={<ShieldCheck className="size-4" />} label="Roles & permissions" />}
              {s.updatedAt && <p className="mt-3 text-xs text-muted-foreground">Last changed {new Date(s.updatedAt).toLocaleString()}</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function MoreLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent">
      {icon}
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

function Section({ title, description, children, dirty, saving, onSave, onReset }: {
  title: string;
  description: string;
  children: ReactNode;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
      <CardFooter className="justify-end gap-2">
        {dirty && (
          <Button variant="ghost" onClick={onReset} disabled={saving}>
            Discard
          </Button>
        )}
        <Button onClick={onSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Local form state that resets whenever the server copy changes. */
function useDraft<T>(source: T) {
  const [draft, setDraft] = useState(source);
  useEffect(() => setDraft(source), [source]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(source);
  return { draft, setDraft, dirty, reset: () => setDraft(source) };
}

function OrganizationCard({ s }: { s: SettingsDto }) {
  const update = useUpdateOrganization();
  const source = useMemo(
    () => ({
      name: s.organization.name,
      email: s.organization.email ?? "",
      phone: s.organization.phone ?? "",
      website: s.organization.website ?? "",
      timezone: s.organization.timezone,
      currency: s.organization.currency,
      locale: s.organization.locale,
      logo: s.organization.logo,
    }),
    [s.organization],
  );
  const { draft, setDraft, dirty, reset } = useDraft(source);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const zoneChanged = draft.timezone !== source.timezone;
  const currencyChanged = draft.currency !== source.currency;

  return (
    <Section
      title="Organisation"
      description="Shown on emails, invoices and public pages."
      dirty={dirty}
      saving={update.isPending}
      onReset={reset}
      onSave={() =>
        update.mutate(
          {
            name: draft.name,
            email: draft.email,
            phone: draft.phone,
            website: draft.website,
            timezone: draft.timezone,
            currency: draft.currency.toUpperCase(),
            locale: draft.locale,
            logoFileId: draft.logo?.id ?? null,
          },
          { onSuccess: () => toast.success("Organisation updated"), onError: (e) => toast.error(errorText(e, "Could not save")) },
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="grid gap-1.5">
          <Label htmlFor="org-logo">Logo</Label>
          <div className="w-28">
            <ImageUpload id="org-logo" shape="square" url={draft.logo?.url ?? null} onChange={(img) => set("logo", img)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="org-name" label="Name" className="sm:col-span-2">
            <Input id="org-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field id="org-email" label="Email">
            <Input id="org-email" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field id="org-phone" label="Phone">
            <Input id="org-phone" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field id="org-web" label="Website" className="sm:col-span-2">
            <Input id="org-web" placeholder="https://" value={draft.website} onChange={(e) => set("website", e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="org-tz" label="Time zone">
          <Input id="org-tz" list="tz-list" value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field id="org-cur" label="Currency">
          <Input id="org-cur" list="cur-list" maxLength={3} value={draft.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
          <datalist id="cur-list">
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field id="org-locale" label="Locale">
          <Input id="org-locale" placeholder="en-PK" value={draft.locale} onChange={(e) => set("locale", e.target.value)} />
        </Field>
      </div>
      {(zoneChanged || currencyChanged) && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {zoneChanged && "Changing the time zone changes how every date is shown and how reports group days. Existing bookings keep their exact times. "}
          {currencyChanged && "Changing the currency does not convert existing prices, payments or invoices."}
        </p>
      )}
    </Section>
  );
}

function Field({ id, label, hint, className, children }: { id: string; label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className ? `grid gap-1.5 ${className}` : "grid gap-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumberField({ id, label, hint, value, onChange, min, max }: { id: string; label: string; hint: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Input id={id} type="number" min={min} max={max} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))} />
    </Field>
  );
}

function BookingCard({ s }: { s: SettingsDto }) {
  const update = useUpdateBookingSettings();
  const { draft, setDraft, dirty, reset } = useDraft(s.booking);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <Section
      title="Booking rules"
      description="Apply to online bookings by customers. Staff can always override."
      dirty={dirty}
      saving={update.isPending}
      onReset={reset}
      onSave={() => update.mutate(draft, { onSuccess: () => toast.success("Booking rules saved"), onError: (e) => toast.error(errorText(e, "Could not save")) })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField id="b-hold" label="Payment hold (minutes)" hint="How long an unpaid online booking keeps its slot (5–240)." min={5} max={240} value={draft.holdMinutes} onChange={(v) => set("holdMinutes", v)} />
        <NumberField id="b-search" label="Slot search window (days)" hint="Longest range one availability search may cover (7–92)." min={7} max={92} value={draft.maxSlotSearchDays} onChange={(v) => set("maxSlotSearchDays", v)} />
        <NumberField id="b-cancel" label="Self-cancel cutoff (hours)" hint="Customers cannot cancel online closer to the start than this." min={0} max={720} value={draft.cancellationCutoffHours} onChange={(v) => set("cancellationCutoffHours", v)} />
        <NumberField id="b-resched" label="Self-reschedule cutoff (hours)" hint="Customers cannot reschedule online closer to the start than this." min={0} max={720} value={draft.rescheduleCutoffHours} onChange={(v) => set("rescheduleCutoffHours", v)} />
      </div>
      <CheckField
        id="b-auto"
        label="Confirm bookings automatically once fully paid"
        description="Turn off to confirm every paid booking by hand."
        checked={draft.autoConfirmPaid}
        onCheckedChange={(v) => set("autoConfirmPaid", v)}
      />
    </Section>
  );
}

function NotificationsCard({ s }: { s: SettingsDto }) {
  const update = useUpdateNotificationSettings();
  const source = useMemo(() => s.notifications.adminEmails.join("\n"), [s.notifications.adminEmails]);
  const { draft, setDraft, dirty, reset } = useDraft(source);
  const emails = draft
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  return (
    <Section
      title="Staff notifications"
      description="These addresses receive a copy of new bookings, cancellations and payments."
      dirty={dirty}
      saving={update.isPending}
      onReset={reset}
      onSave={() =>
        update.mutate({ adminEmails: emails }, { onSuccess: () => toast.success("Staff notification addresses saved"), onError: (e) => toast.error(errorText(e, "Could not save")) })
      }
    >
      <Field id="n-emails" label="Email addresses (one per line)" hint={`${emails.length} address${emails.length === 1 ? "" : "es"} · up to 20`}>
        <Textarea id="n-emails" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="frontdesk@clinic.pk" />
      </Field>
    </Section>
  );
}

function InvoicesCard({ s }: { s: SettingsDto }) {
  const update = useUpdateInvoiceSettings();
  const { draft, setDraft, dirty, reset } = useDraft(s.invoices);
  return (
    <Section
      title="Invoices"
      description="Defaults for new invoices and the PDF."
      dirty={dirty}
      saving={update.isPending}
      onReset={reset}
      onSave={() => update.mutate(draft, { onSuccess: () => toast.success("Invoice settings saved"), onError: (e) => toast.error(errorText(e, "Could not save")) })}
    >
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <NumberField id="i-due" label="Payment due after (days)" hint="0 = due on issue." min={0} max={365} value={draft.defaultDueDays} onChange={(v) => setDraft((d) => ({ ...d, defaultDueDays: v }))} />
        <Field id="i-footer" label="Footer text" hint="Printed at the bottom of every invoice PDF.">
          <Textarea id="i-footer" rows={2} maxLength={500} value={draft.footer} onChange={(e) => setDraft((d) => ({ ...d, footer: e.target.value }))} />
        </Field>
      </div>
    </Section>
  );
}
