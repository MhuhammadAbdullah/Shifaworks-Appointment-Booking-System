"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, CircleAlert, Mail, Plus, Receipt, RefreshCw, Star, Trash2, UserRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { PROVIDER_TYPE_LABELS, type ProviderDto } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CheckField } from "@/components/forms/check-field";
import { Field, fieldA11y } from "@/components/forms/field";
import { PasswordInput } from "@/components/forms/password-input";
import { AvailabilityEditor } from "@/components/availability/availability-editor";
import { SlotPreview } from "@/components/availability/slot-preview";
import { ProviderProfileForm } from "@/components/providers/provider-profile-form";
import { WebsiteCalendarCard } from "@/components/providers/website-calendar-card";
import { ConcernOptionsCard, providerChecklistLabel } from "@/components/services/concern-options-card";
import { UserStatusBadge } from "@/components/dashboard/status-badge";
import { InvoiceStatusBadge } from "@/components/finance/status-badges";
import { usePermissions } from "@/lib/auth/hooks";
import {
  useDeleteProvider,
  useInviteProvider,
  useProvider,
  useServices,
  useSetProviderServices,
  useUpdateProvider,
} from "@/lib/api/catalog";
import { useCreatePayslip, useInvoices } from "@/lib/api/invoices";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { generatePassword } from "@/lib/generate-password";
import { cn } from "@/lib/utils";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

type TabKey = "profile" | "services" | "availability" | "website" | "account";

/**
 * One provider, organised by task instead of one long scroll:
 * a summary header with a readiness strip, then Profile / Services / Availability / Website / Account & pay.
 * Opened as a popup from the providers list and as the standalone /admin/providers/[id] page.
 */
export function ProviderDetailView({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = usePermissions();
  const { data: provider, isPending, error } = useProvider(id);
  const update = useUpdateProvider(id);
  const [tab, setTab] = useState<TabKey>("profile");

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !provider) return <p className="text-destructive">{error?.message ?? "Provider not found"}</p>;

  const canEdit = can("providers.update");
  const activeServices = provider.services.filter((s) => s.linkActive);

  return (
    <div className="grid gap-5">
      <ProviderHeader provider={provider} />
      <ReadinessStrip provider={provider} onJump={setTab} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        {/* Scrolls sideways on a phone instead of wrapping into a second row. */}
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="services">Services{activeServices.length > 0 && ` (${activeServices.length})`}</TabsTrigger>
            <TabsTrigger value="availability">Availability</TabsTrigger>
            <TabsTrigger value="website">Website</TabsTrigger>
            <TabsTrigger value="account">Account &amp; pay</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="profile" className="mt-4 grid gap-6">
          <ProviderProfileForm provider={provider} mode="admin" readOnly={!canEdit} onSave={(body) => update.mutateAsync(body)} />
          {can("providers.delete") && <DangerZone provider={provider} onDeleted={onClose} />}
        </TabsContent>

        <TabsContent value="services" className="mt-4 grid gap-6">
          <ServicesCard provider={provider} readOnly={!canEdit} />
          <ConcernOptionsCard provider={provider} readOnly={!can("services.manage_concern_options")} />
        </TabsContent>

        <TabsContent value="availability" className="mt-4 grid gap-6">
          <SlotPreview provider={provider} />
          <AvailabilityEditor providerId={provider.id} readOnly={!can("availability.manage_all")} />
        </TabsContent>

        <TabsContent value="website" className="mt-4 grid gap-6">
          <WebsiteCalendarCard provider={provider} />
        </TabsContent>

        <TabsContent value="account" className="mt-4 grid gap-6">
          <LoginCard provider={provider} canInvite={can("providers.update") && can("staff.create")} />
          {can("invoices.view") && <PayslipsCard provider={provider} canCreate={can("invoices.create")} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProviderHeader({ provider }: { provider: ProviderDto }) {
  const accepts = provider.acceptsMale && provider.acceptsFemale ? "Male & female clients" : provider.acceptsMale ? "Male clients only" : "Female clients only";
  return (
    <div className="flex items-start gap-4">
      <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
        {provider.profileImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public image URL
          <img src={provider.profileImageUrl} alt="" className="size-full object-cover" />
        ) : (
          <UserRound className="size-7 text-muted-foreground" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{provider.displayName}</h1>
          {provider.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {provider.designation ?? PROVIDER_TYPE_LABELS[provider.providerType]}
          {" · "}
          {provider.experienceYears} {provider.experienceYears === 1 ? "year" : "years"} experience
          {provider.rating && (
            <span className="ml-1 inline-flex items-center gap-0.5">
              {" · "}
              <Star className="size-3 fill-current" aria-hidden /> {provider.rating}
            </span>
          )}
          {" · "}
          {accepts}
        </p>
      </div>
    </div>
  );
}

/** What stops this provider from being booked, at a glance; each chip jumps to where it is fixed. */
function ReadinessStrip({ provider, onJump }: { provider: ProviderDto; onJump: (tab: TabKey) => void }) {
  const activeServices = provider.services.filter((s) => s.linkActive);
  const account = provider.account;
  const showAreas = providerChecklistLabel(provider) !== null;
  const activeAreas = provider.concernOptions.filter((o) => o.isActive).length;

  const items: { ok: boolean | null; text: string; tab: TabKey }[] = [
    { ok: provider.isActive, text: provider.isActive ? "Shown on booking forms" : "Hidden from booking forms", tab: "profile" },
    {
      ok: activeServices.length > 0,
      text: activeServices.length > 0 ? `${activeServices.length} service${activeServices.length === 1 ? "" : "s"}` : "No service assigned",
      tab: "services",
    },
    ...(showAreas
      ? [{ ok: activeAreas > 0 ? true : null, text: activeAreas > 0 ? `${activeAreas} areas of concern` : "No areas of concern", tab: "services" as TabKey }]
      : []),
    {
      ok: account ? (account.status === "ACTIVE" ? true : null) : null,
      text: account ? (account.status === "ACTIVE" ? "Dashboard login active" : "Login invited") : "No dashboard login",
      tab: "account",
    },
  ];

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Booking readiness">
      {items.map((i) => (
        <li key={i.text}>
          <button
            type="button"
            onClick={() => onJump(i.tab)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
              i.ok === false && "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
              i.ok === true && "text-foreground",
              i.ok === null && "text-muted-foreground",
            )}
          >
            {i.ok === true && <Check className="size-3.5 text-emerald-600" aria-hidden />}
            {i.ok === false && <CircleAlert className="size-3.5" aria-hidden />}
            {i.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DangerZone({ provider, onDeleted }: { provider: ProviderDto; onDeleted: () => void }) {
  const remove = useDeleteProvider();
  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base">Delete provider</CardTitle>
        <CardDescription>
          Removes {provider.displayName} from the booking forms, availability and admin lists. Past bookings and payments are kept.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          variant="outline"
          className="text-destructive"
          disabled={remove.isPending}
          onClick={() => {
            if (!window.confirm(`Delete ${provider.displayName}? They'll be removed from the booking form and admin lists; their past bookings and payments are kept.`)) return;
            remove.mutate(provider.id, {
              onSuccess: () => {
                toast.success("Provider deleted");
                onDeleted();
              },
              onError: (e) => toast.error(errorText(e, "Could not delete")),
            });
          }}
        >
          <Trash2 className="size-4" /> Delete provider
        </Button>
      </CardFooter>
    </Card>
  );
}

function ServicesCard({ provider, readOnly }: { provider: ProviderDto; readOnly: boolean }) {
  const services = useServices();
  const save = useSetProviderServices(provider.id);
  const initial = provider.services.map((s) => s.id);
  const [selected, setSelected] = useState<string[]>(initial);
  useEffect(() => setSelected(provider.services.map((s) => s.id)), [provider.services]);
  // Not filtered by type: some providers do both disciplines and need services assigned across both.
  const offered = services.data ?? [];
  const dirty = selected.length !== initial.length || selected.some((id) => !initial.includes(id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Services</CardTitle>
        <CardDescription>The booking forms this provider appears on.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {services.isPending && <Skeleton className="h-16 w-full" />}
        {offered.map((s) => (
          <label key={s.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <Checkbox
              disabled={readOnly}
              checked={selected.includes(s.id)}
              onCheckedChange={(c) => setSelected((cur) => (c ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
            />
            {s.name}
            {!s.open && <span className="text-xs text-muted-foreground">(registration closed)</span>}
          </label>
        ))}
      </CardContent>
      {!readOnly && (
        <CardFooter className="justify-end">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(selected, {
                onSuccess: () => toast.success("Services saved"),
                onError: (e) => toast.error(errorText(e, "Could not save")),
              })
            }
          >
            Save services
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function LoginCard({ provider, canInvite }: { provider: ProviderDto; canInvite: boolean }) {
  const invite = useInviteProvider(provider.id);
  const [email, setEmail] = useState(provider.email ?? "");
  const [password, setPassword] = useState("");
  const account = provider.account;

  const send = () =>
    invite.mutate(account ? {} : { ...(email ? { email } : {}), password }, {
      onSuccess: () => toast.success(account ? "New login details emailed" : "Login created and credentials emailed"),
      onError: (e) => toast.error(errorText(e, "Could not send the invitation")),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dashboard login</CardTitle>
        <CardDescription>
          Optional. With a login the provider sees only their own appointments and can manage their availability.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {account ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>{account.email}</span>
            <UserStatusBadge status={account.status} />
            {canInvite && (
              <Link href={`/admin/users/${account.userId}`} className="text-muted-foreground underline">
                Manage account
              </Link>
            )}
          </div>
        ) : (
          <>
            <p className="text-muted-foreground">No login yet.</p>
            {canInvite && (
              <>
                <Input
                  type="email"
                  aria-label="Login email"
                  placeholder="Email to send the invitation to"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Field id="pr-password" label="Password" hint="At least 10 characters with upper- and lowercase letters and a number.">
                  <div className="flex gap-2">
                    <PasswordInput
                      id="pr-password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <Button type="button" variant="outline" size="icon" title="Generate a password" onClick={() => setPassword(generatePassword())}>
                      <RefreshCw className="size-4" />
                    </Button>
                  </div>
                </Field>
              </>
            )}
          </>
        )}
      </CardContent>
      {canInvite && (!account || account.status === "INVITED") && (
        <CardFooter className="justify-end">
          <Button variant="outline" disabled={invite.isPending || (!account && (!email || !password))} onClick={send}>
            <Mail className="size-4" /> {account ? "Resend invitation" : "Send invitation"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function PayslipsCard({ provider, canCreate }: { provider: ProviderDto; canCreate: boolean }) {
  const [creating, setCreating] = useState(false);
  const { data, isPending } = useInvoices({ providerId: provider.id, audience: "PROVIDER", pageSize: 10 });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4" /> Pay slips
          </CardTitle>
          <CardDescription>Payout receipts issued to this provider - each issue posts an expense to the finance ledger.</CardDescription>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New pay slip
          </Button>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 sm:px-6 sm:pb-6">
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Issue date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No pay slips yet.
                  </TableCell>
                </TableRow>
              )}
              {data?.data.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link href={`/admin/invoices/${inv.id}`} className="font-mono text-sm font-medium hover:underline">
                      {inv.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{formatMoney(inv.totalAmount, inv.currency)}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={inv.status} />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{inv.issueDate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {creating && <NewPayslipDialog providerId={provider.id} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function NewPayslipDialog({ providerId, onClose }: { providerId: string; onClose: () => void }) {
  const create = useCreatePayslip();
  const form = useForm({
    defaultValues: { amount: "", description: "", dueDate: "", notes: "", issue: true },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit((v) => {
    create.mutate(
      { providerId, amount: Number(v.amount), description: v.description, dueDate: v.dueDate || undefined, notes: v.notes || undefined, issue: v.issue },
      {
        onSuccess: () => { toast.success("Pay slip created"); onClose(); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not create the pay slip"),
      },
    );
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New pay slip</DialogTitle>
          <DialogDescription>Issuing it immediately posts an EXPENSE entry to the finance ledger under Salaries.</DialogDescription>
        </DialogHeader>
        <form id="payslip-form" onSubmit={onSubmit} className="grid gap-3">
          <Field id="ps-amount" label="Amount" error={errors.amount?.message} required>
            <Input type="number" min={0} step="0.01" {...fieldA11y("ps-amount", errors.amount?.message)} {...form.register("amount", { required: true })} />
          </Field>
          <Field id="ps-desc" label="Description" error={errors.description?.message} required info="e.g. Sessions 1–15 September">
            <Input {...fieldA11y("ps-desc", errors.description?.message)} {...form.register("description", { required: true })} />
          </Field>
          <Field id="ps-due" label="Due date" error={errors.dueDate?.message} optional>
            <Input type="date" {...fieldA11y("ps-due", errors.dueDate?.message)} {...form.register("dueDate")} />
          </Field>
          <Field id="ps-notes" label="Notes" error={errors.notes?.message} optional>
            <Textarea rows={2} {...fieldA11y("ps-notes", errors.notes?.message)} {...form.register("notes")} />
          </Field>
          <CheckField
            id="ps-issue"
            label="Issue immediately"
            description="Posts the expense to the ledger now - leave off to save as a draft"
            checked={form.watch("issue")}
            onCheckedChange={(v) => form.setValue("issue", v, { shouldDirty: true })}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payslip-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Create pay slip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
