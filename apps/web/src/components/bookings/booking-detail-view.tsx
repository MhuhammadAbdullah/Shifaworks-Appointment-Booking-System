"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, CalendarClock, CheckCircle2, Mail, Paperclip, Pencil, Receipt, Ticket, Trash2, UserX, XCircle } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { BookingDetailDto } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CheckField } from "@/components/forms/check-field";
import { Field, fieldA11y } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/bookings/status-badges";
import { StaffDateTimePicker } from "@/components/bookings/staff-datetime-picker";
import { usePermissions } from "@/lib/auth/hooks";
import { useProviders, useService } from "@/lib/api/catalog";
import {
  useBooking,
  useCancelBooking,
  useCompleteBooking,
  useConfirmBooking,
  useDeleteBooking,
  useMarkNoShow,
  useRescheduleBooking,
  useResendConfirmation,
  useUpdateBookingDetails,
  useUpdateBookingNotes,
} from "@/lib/api/bookings";
import { useInvoiceFromBooking } from "@/lib/api/invoices";
import { openPrivateFile } from "@/lib/api/files";
import { ApiError } from "@/lib/api-client";
import { formatDateTime, formatMoney, titleCase } from "@/lib/format";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const SLOT_HOLDING_STATUSES = ["PENDING_PAYMENT", "PAYMENT_SUBMITTED", "PAYMENT_VERIFIED", "CONFIRMED"] as const;

/**
 * Shared by /admin/bookings/[id], /provider/appointments/[id] and the bookings-list popup —
 * every action here is already permission- and ownership-scoped by the API. Pass `backHref`/`backLabel`
 * for a full-page use (renders a back link); pass `onClose` instead when embedded in a dialog.
 */
export function BookingDetailView({
  id,
  backHref,
  backLabel,
  onClose,
}: {
  id: string;
  backHref?: string;
  backLabel?: string;
  onClose?: () => void;
}) {
  const router = useRouter();
  const { can, me } = usePermissions();
  const { data: booking, isPending, error } = useBooking(id);
  const concernService = useService(booking?.service.slug ?? "", Boolean(booking));
  const [dialog, setDialog] = useState<"cancel" | "reschedule" | "edit" | "delete" | null>(null);
  const complete = useCompleteBooking(id);
  const noShow = useMarkNoShow(id);
  const confirm = useConfirmBooking(id);
  const resendConfirmation = useResendConfirmation(id);
  const raiseInvoice = useInvoiceFromBooking();

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !booking) return <p className="text-destructive">{error?.message ?? "Booking not found"}</p>;

  const isOwnProvider = me?.providerProfileId === booking.provider.id;
  const canManage = can("bookings.update") && (can("bookings.view_all") || isOwnProvider);
  const slotHolding = (SLOT_HOLDING_STATUSES as readonly string[]).includes(booking.status);

  return (
    <div className="grid gap-6">
      <div>
        {backHref && (
          <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {backLabel}
          </Link>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{booking.bookingNumber}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <BookingStatusBadge status={booking.status} />
              <PaymentStatusBadge status={booking.paymentStatus} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && booking.status === "PAYMENT_VERIFIED" && (
              <Button
                variant="outline"
                onClick={() => confirm.mutate(undefined, { onSuccess: () => toast.success("Booking confirmed"), onError: (e) => toast.error(errorText(e, "Could not confirm")) })}
              >
                <BadgeCheck className="size-4" /> Confirm
              </Button>
            )}
            {canManage && booking.status === "CONFIRMED" && (
              <Button variant="outline" onClick={() => complete.mutate(undefined, { onSuccess: () => toast.success("Marked completed"), onError: (e) => toast.error(errorText(e, "Could not complete")) })}>
                <CheckCircle2 className="size-4" /> Complete
              </Button>
            )}
            {canManage && can("bookings.view_all") && booking.status === "CONFIRMED" && (
              <Button variant="outline" onClick={() => noShow.mutate(undefined, { onSuccess: () => toast.success("Marked no-show"), onError: (e) => toast.error(errorText(e, "Could not mark no-show")) })}>
                <UserX className="size-4" /> No-show
              </Button>
            )}
            {can("bookings.update") && can("bookings.view_all") && slotHolding && (
              <Button variant="outline" onClick={() => setDialog("reschedule")}>
                <CalendarClock className="size-4" /> Reschedule
              </Button>
            )}
            {can("bookings.cancel") && slotHolding && (
              <Button variant="outline" className="text-destructive" onClick={() => setDialog("cancel")}>
                <XCircle className="size-4" /> Cancel
              </Button>
            )}
            {canManage && can("bookings.view_all") && (
              <Button variant="outline" onClick={() => setDialog("edit")}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
            {can("bookings.delete") && can("bookings.view_all") && booking.paymentStatus === "PENDING" && (
              <Button variant="outline" className="text-destructive" onClick={() => setDialog("delete")}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
            {can("invoices.create") && (booking.status === "CONFIRMED" || booking.status === "COMPLETED") && (
              <Button
                variant="outline"
                disabled={raiseInvoice.isPending}
                onClick={() =>
                  raiseInvoice.mutate(
                    { bookingId: booking.id },
                    { onSuccess: (inv) => router.push(`/admin/invoices/${inv.id}`), onError: (e) => toast.error(errorText(e, "Could not raise invoice")) },
                  )
                }
              >
                <Receipt className="size-4" /> Raise invoice
              </Button>
            )}
            {canManage && can("bookings.view_all") && booking.status === "CONFIRMED" && (
              <Button
                variant="outline"
                disabled={resendConfirmation.isPending}
                onClick={() =>
                  resendConfirmation.mutate(undefined, {
                    onSuccess: () => toast.success("Ticket re-sent"),
                    onError: (e) => toast.error(errorText(e, "Could not resend")),
                  })
                }
              >
                <Mail className="size-4" /> Resend ticket
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Appointment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Service" value={booking.serviceName} />
          <Row label="Option" value={booking.packageName ?? "-"} />
          <Row label="Provider" value={booking.providerName} />
          <Row label="When" value={formatDateTime(booking.startsAt, booking.timezone)} />
          <Row label="Amount" value={formatMoney(booking.amount, booking.currency)} />
          <Row label="Source" value={titleCase(booking.source)} />
          {booking.availabilityOverridden && <Row label="Note" value="Booked outside normal availability" />}
        </CardContent>
      </Card>

      {can("bookings.view_all") && (
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <Row label="Name" value={[booking.customer.firstName, booking.customer.lastName].filter(Boolean).join(" ")} />
            <Row label="Customer #" value={booking.customer.customerNumber} />
            <Row label="Phone" value={booking.customer.phone ?? "-"} />
            <Row label="Email" value={booking.customer.email ?? "-"} />
            <Row label="City" value={[booking.customer.city, booking.customer.province].filter(Boolean).join(", ") || "-"} />
            <Row label="Address" value={booking.customer.address ?? "-"} />
            {booking.customerNotes && (
              <div className="sm:col-span-2">
                <div className="text-muted-foreground">Notes from the customer</div>
                <p className="whitespace-pre-wrap">{booking.customerNotes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {can("bookings.view_all") && booking.payment && (
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <Row label="Reference" value={booking.payment.paymentNumber} />
            <Row label="Amount" value={formatMoney(booking.payment.amount, booking.currency)} />
            <div>
              <div className="text-muted-foreground">Status</div>
              <PaymentStatusBadge status={booking.payment.status} />
            </div>
            <Row label="Method" value={booking.payment.method ? titleCase(booking.payment.method) : "-"} />
          </CardContent>
          {can("payments.view") && (
            <CardFooter className="flex-wrap justify-end gap-2">
              {booking.payment.proofFileId && (
                <Button variant="outline" onClick={() => void openPrivateFile(booking.payment!.proofFileId!)}>
                  <Paperclip className="size-4" /> View receipt
                </Button>
              )}
              <Button variant="outline" asChild>
                <Link href={`/admin/payments/${booking.payment.id}`}>Open payment</Link>
              </Button>
            </CardFooter>
          )}
        </Card>
      )}

      {can("bookings.view_all") && booking.status === "CONFIRMED" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ticket className="size-4" /> Check-in
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            {booking.checkIn ? (
              <>
                <Row label="Checked in" value={formatDateTime(booking.checkIn.checkedInAt, booking.timezone)} />
                <Row label="By" value={booking.checkIn.checkedInBy ?? "-"} />
              </>
            ) : (
              <p className="text-muted-foreground sm:col-span-2">Not checked in yet.</p>
            )}
          </CardContent>
          {can("bookings.check_in") && (
            <CardFooter className="justify-end">
              <Button variant="outline" asChild>
                <Link href="/admin/check-in">Open check-in</Link>
              </Button>
            </CardFooter>
          )}
        </Card>
      )}

      {isFormDataFilled(booking.formData) && (
        <Card>
          <CardHeader>
            <CardTitle>Submitted with the online form</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {Object.entries(booking.formData as Record<string, unknown>).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4 border-b pb-1.5 last:border-0">
                <span className="text-muted-foreground">{titleCase(key)}</span>
                <span className="text-right">
                  {isChecklistValue(value) ? describeChecklist(value, concernService.data?.concernOptions ?? []) : describeValue(value)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(booking.status === "CANCELLED" || booking.cancellationReason) && (
        <Card>
          <CardHeader>
            <CardTitle>Cancellation</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Cancelled" value={booking.cancelledAt ? formatDateTime(booking.cancelledAt, booking.timezone) : "-"} />
            <Row label="Reason" value={booking.cancellationReason ?? "-"} />
          </CardContent>
        </Card>
      )}

      {can("bookings.update") && <NotesCard bookingId={booking.id} internalNotes={booking.internalNotes} />}

      {dialog === "cancel" && <CancelDialog bookingId={booking.id} onClose={() => setDialog(null)} />}
      {dialog === "edit" && <EditDetailsDialog booking={booking} onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <DeleteDialog
          bookingId={booking.id}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            if (onClose) onClose();
            else if (backHref) router.push(backHref);
          }}
        />
      )}
      {dialog === "reschedule" && (
        <RescheduleDialog
          bookingId={booking.id}
          currentProviderId={booking.provider.id}
          serviceSlug={booking.service.slug}
          packageId={booking.package?.id ?? null}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function isFormDataFilled(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && Object.keys(v).length > 0;
}

function describeValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.map(describeValue).join(", ") : "-";
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(describeValue).filter((s) => s !== "-").join(" · ") || "-";
  return String(v);
}

/** The shape every "Areas of concern" style checklist field submits: `{selected: string[], otherDetail?: string}`. */
function isChecklistValue(v: unknown): v is { selected: unknown[]; otherDetail?: string | null } {
  return typeof v === "object" && v !== null && Array.isArray((v as { selected?: unknown }).selected);
}

/** Codes are opaque keys — map them back to their admin-set label, falling back to the raw code if the option was since renamed/removed. */
function describeChecklist(v: { selected: unknown[]; otherDetail?: string | null }, options: { code: string; label: string }[]): string {
  const labelOf = (code: string) => options.find((o) => o.code === code)?.label ?? code;
  const parts = v.selected
    .filter((c): c is string => typeof c === "string")
    .map((code) => (code === "OTHER" ? (v.otherDetail?.trim() ? `Other (${v.otherDetail.trim()})` : "Other") : labelOf(code)));
  return parts.length ? parts.join(", ") : "-";
}

function NotesCard({ bookingId, internalNotes }: { bookingId: string; internalNotes: string | null }) {
  const [value, setValue] = useState(internalNotes ?? "");
  const [dirty, setDirty] = useState(false);
  const update = useUpdateBookingNotes(bookingId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal notes</CardTitle>
        <CardDescription>Visible to staff only.</CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea
          rows={3}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDirty(true);
          }}
        />
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          variant="outline"
          disabled={!dirty || update.isPending}
          onClick={() =>
            update.mutate(
              { internalNotes: value || null },
              { onSuccess: () => { toast.success("Notes saved"); setDirty(false); }, onError: (e) => toast.error(errorText(e, "Could not save")) },
            )
          }
        >
          {update.isPending ? "Saving…" : "Save notes"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function CancelDialog({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const cancel = useCancelBooking(bookingId);
  const form = useForm({ defaultValues: { reason: "" } });

  const onSubmit = form.handleSubmit((v) =>
    cancel.mutate(
      { reason: v.reason || undefined },
      {
        onSuccess: () => {
          toast.success("Booking cancelled");
          onClose();
        },
        onError: (e) => toast.error(errorText(e, "Could not cancel")),
      },
    ),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>The customer is not notified automatically yet - let them know separately.</DialogDescription>
        </DialogHeader>
        <form id="cancel-form" onSubmit={onSubmit}>
          <Label htmlFor="cancel-reason">Reason (optional)</Label>
          <Textarea id="cancel-reason" rows={3} className="mt-1.5" {...form.register("reason")} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep booking
          </Button>
          <Button type="submit" form="cancel-form" variant="destructive" disabled={cancel.isPending}>
            {cancel.isPending ? "Cancelling…" : "Cancel booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDetailsDialog({ booking, onClose }: { booking: BookingDetailDto; onClose: () => void }) {
  const update = useUpdateBookingDetails(booking.id);
  const form = useForm({
    defaultValues: {
      firstName: booking.customer.firstName,
      lastName: booking.customer.lastName ?? "",
      email: booking.customer.email ?? "",
      phone: booking.customer.phone ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit((v) =>
    update.mutate(
      { firstName: v.firstName, lastName: v.lastName || null, email: v.email || null, phone: v.phone || null },
      { onSuccess: () => { toast.success("Details saved"); onClose(); }, onError: (e) => toast.error(errorText(e, "Could not save")) },
    ),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit customer details</DialogTitle>
          <DialogDescription>Fixes a typo in the contact snapshot - everything else about the booking is fixed once created.</DialogDescription>
        </DialogHeader>
        <form id="edit-details-form" onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <Field id="ed-first" label="First name" error={errors.firstName?.message} required>
            <Input {...fieldA11y("ed-first", errors.firstName?.message)} {...form.register("firstName")} />
          </Field>
          <Field id="ed-last" label="Last name" error={errors.lastName?.message} optional>
            <Input {...fieldA11y("ed-last", errors.lastName?.message)} {...form.register("lastName")} />
          </Field>
          <Field id="ed-phone" label="Phone" error={errors.phone?.message} optional>
            <Input type="tel" {...fieldA11y("ed-phone", errors.phone?.message)} {...form.register("phone")} />
          </Field>
          <Field id="ed-email" label="Email" error={errors.email?.message} optional>
            <Input type="email" {...fieldA11y("ed-email", errors.email?.message)} {...form.register("email")} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-details-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ bookingId, onClose, onDeleted }: { bookingId: string; onClose: () => void; onDeleted: () => void }) {
  const del = useDeleteBooking(bookingId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this booking?</DialogTitle>
          <DialogDescription>
            This permanently removes the booking - it only works while there is no payment history. This cannot be undone; cancel it
            instead if you just want to close it out.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep booking
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(undefined, {
                onSuccess: () => {
                  toast.success("Booking deleted");
                  onDeleted();
                },
                onError: (e) => toast.error(errorText(e, "Could not delete")),
              })
            }
          >
            {del.isPending ? "Deleting…" : "Delete booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RescheduleDialog({
  bookingId,
  currentProviderId,
  serviceSlug,
  packageId,
  onClose,
}: {
  bookingId: string;
  currentProviderId: string;
  serviceSlug: string;
  packageId: string | null;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const reschedule = useRescheduleBooking(bookingId);
  const service = useService(serviceSlug);
  const providers = useProviders({ serviceId: service.data?.id, pageSize: 100 });
  const form = useForm({ defaultValues: { providerId: currentProviderId, startsAt: "", overrideAvailability: false, reason: "" } });
  const values = form.watch();

  const onSubmit = form.handleSubmit((v) => {
    if (!v.startsAt) {
      toast.error("Choose a new date and time");
      return;
    }
    reschedule.mutate(
      { startsAt: v.startsAt, providerId: v.providerId, overrideAvailability: v.overrideAvailability, reason: v.reason || undefined },
      {
        onSuccess: () => {
          toast.success("Booking rescheduled");
          onClose();
        },
        onError: (e) => toast.error(errorText(e, "Could not reschedule")),
      },
    );
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reschedule</DialogTitle>
          <DialogDescription>The current time is freed as soon as the new one is confirmed.</DialogDescription>
        </DialogHeader>
        <form id="reschedule-form" onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="rs-provider">Provider</Label>
            <Controller
              control={form.control}
              name="providerId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => { field.onChange(v); form.setValue("startsAt", ""); }}>
                  <SelectTrigger id="rs-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.data?.data.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <StaffDateTimePicker
            serviceId={service.data?.id ?? null}
            providerId={values.providerId || null}
            packageId={packageId}
            value={values.startsAt || null}
            onChange={(iso) => form.setValue("startsAt", iso, { shouldDirty: true })}
          />
          {can("bookings.override_availability") && (
            <Controller
              control={form.control}
              name="overrideAvailability"
              render={({ field }) => (
                <CheckField id="rs-override" label="Book outside availability" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="rs-reason">Reason (optional)</Label>
            <Textarea id="rs-reason" rows={2} {...form.register("reason")} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reschedule-form" disabled={reschedule.isPending || !values.startsAt}>
            {reschedule.isPending ? "Saving…" : "Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
