"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Mail, Plus, Receipt, Trash2 } from "lucide-react";
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
import { AvailabilityEditor } from "@/components/availability/availability-editor";
import { SlotPreview } from "@/components/availability/slot-preview";
import { ProviderProfileForm } from "@/components/providers/provider-profile-form";
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

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const { data: provider, isPending, error } = useProvider(id);
  const update = useUpdateProvider(id);
  const remove = useDeleteProvider();

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !provider) return <p className="text-destructive">{error?.message ?? "Provider not found"}</p>;

  const canEdit = can("providers.update");

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href={`/admin/providers?type=${provider.providerType}`}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {PROVIDER_TYPE_LABELS[provider.providerType]}s
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{provider.displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{provider.designation ?? PROVIDER_TYPE_LABELS[provider.providerType]}</span>
              {provider.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
            </div>
          </div>
          {can("providers.delete") && (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!window.confirm(`Delete ${provider.displayName}? This cannot be undone.`)) return;
                remove.mutate(provider.id, {
                  onSuccess: () => {
                    toast.success("Provider deleted");
                    router.replace("/admin/providers");
                  },
                  onError: (e) => toast.error(errorText(e, "Could not delete")),
                });
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-4 grid gap-6">
          <ProviderProfileForm provider={provider} mode="admin" readOnly={!canEdit} onSave={(body) => update.mutateAsync(body)} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ServicesCard provider={provider} readOnly={!canEdit} />
            <LoginCard provider={provider} canInvite={can("providers.update") && can("staff.create")} />
          </div>
          {can("invoices.view") && <PayslipsCard provider={provider} canCreate={can("invoices.create")} />}
        </TabsContent>
        <TabsContent value="availability" className="mt-4 grid gap-6">
          <SlotPreview provider={provider} />
          <AvailabilityEditor
            providerId={provider.id}
            readOnly={!can("availability.manage_all")}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ServicesCard({ provider, readOnly }: { provider: ProviderDto; readOnly: boolean }) {
  const services = useServices();
  const save = useSetProviderServices(provider.id);
  const initial = provider.services.map((s) => s.id);
  const [selected, setSelected] = useState<string[]>(initial);
  useEffect(() => setSelected(provider.services.map((s) => s.id)), [provider.services]);
  const offered = (services.data ?? []).filter((s) => !s.providerType || s.providerType === provider.providerType);
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
  const account = provider.account;

  const send = () =>
    invite.mutate(account ? {} : email ? { email } : {}, {
      onSuccess: () => toast.success("Invitation sent"),
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
              <Input
                type="email"
                aria-label="Login email"
                placeholder="Email to send the invitation to"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </>
        )}
      </CardContent>
      {canInvite && (!account || account.status === "INVITED") && (
        <CardFooter className="justify-end">
          <Button variant="outline" disabled={invite.isPending || (!account && !email)} onClick={send}>
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
