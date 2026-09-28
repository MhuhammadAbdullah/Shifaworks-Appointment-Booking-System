"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import {
  GENDERS,
  GENDER_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  SERVICE_DEFINITIONS,
  SERVICE_SLUGS,
  manualBookingSchema,
  type ManualBookingInput,
  type ServiceSlug,
} from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckField } from "@/components/forms/check-field";
import { Field, fieldA11y } from "@/components/forms/field";
import { StaffDateTimePicker } from "@/components/bookings/staff-datetime-picker";
import { usePermissions } from "@/lib/auth/hooks";
import { useService } from "@/lib/api/catalog";
import { useCreateManualBooking } from "@/lib/api/bookings";
import { ApiError } from "@/lib/api-client";
import { formatDuration, formatMoney } from "@/lib/format";

const blankToUndefined = (v: string) => (v?.trim() ? v : undefined);

// overrideAvailability/markPaid carry .default(false), so the raw (pre-default) form
// values type is a shade looser than the submitted (post-default) ManualBookingInput -
// same three-generic split used throughout this codebase's other defaulted forms.
type FormValues = z.input<typeof manualBookingSchema>;

/** Phone/walk-in booking, made with the same engine and checks as the online forms. */
export function NewBookingDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { can } = usePermissions();
  const create = useCreateManualBooking();
  const form = useForm<FormValues, unknown, ManualBookingInput>({
    resolver: zodResolver(manualBookingSchema),
    defaultValues: {
      service: "hijama-therapy",
      providerId: "",
      packageId: "",
      startsAt: "",
      personal: { firstName: "", phone: "", email: "", gender: "FEMALE" },
      location: {},
      source: "PHONE",
      overrideAvailability: false,
      markPaid: false,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const values = form.watch();
  const service = useService(values.service);

  // Changing the service invalidates the provider/package/time already chosen.
  useEffect(() => {
    form.resetField("providerId", { defaultValue: "" });
    form.resetField("packageId", { defaultValue: "" });
    form.resetField("startsAt", { defaultValue: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the service should trigger this
  }, [values.service]);

  const providers = (service.data?.providers ?? []).filter((p) => p.isActive && p.linkActive);
  const packages = (service.data?.packages ?? []).filter((p) => p.isActive);

  const onSubmit = form.handleSubmit(async (body) => {
    try {
      const booking = await create.mutateAsync(body);
      toast.success(`Booked ${booking.bookingNumber}`);
      onClose();
      router.push(`/admin/bookings/${booking.id}`);
    } catch (err) {
      if (err instanceof ApiError) for (const e of err.errors) form.setError(e.path as "providerId", { message: e.message });
      toast.error(err instanceof ApiError ? err.message : "Could not create the booking");
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>Phone or walk-in booking, made with the same engine and checks as the online forms.</DialogDescription>
        </DialogHeader>

        <form id="new-booking-form" onSubmit={onSubmit} noValidate className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-4">
          <Card>
            <CardHeader>
              <CardTitle>Service, provider &amp; option</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field id="nb-service" label="Service" required>
                <Controller
                  control={form.control}
                  name="service"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => field.onChange(v as ServiceSlug)}>
                      <SelectTrigger id="nb-service">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SERVICE_SLUGS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {SERVICE_DEFINITIONS[s].name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="nb-provider" label={SERVICE_DEFINITIONS[values.service]?.providerNoun ?? "Provider"} error={errors.providerId?.message} required>
                  <Controller
                    control={form.control}
                    name="providerId"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!service.data}>
                        <SelectTrigger id="nb-provider">
                          <SelectValue placeholder={service.isPending ? "Loading…" : "Choose"} />
                        </SelectTrigger>
                        <SelectContent>
                          {providers.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.displayName} · {GENDER_LABELS[p.gender]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Field id="nb-package" label={SERVICE_DEFINITIONS[values.service]?.packageNoun ?? "Option"} error={errors.packageId?.message} required>
                  <Controller
                    control={form.control}
                    name="packageId"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!service.data}>
                        <SelectTrigger id="nb-package">
                          <SelectValue placeholder={service.isPending ? "Loading…" : "Choose"} />
                        </SelectTrigger>
                        <SelectContent>
                          {packages.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} - {formatMoney(p.price, service.data?.currency)} ({formatDuration(p.effectiveDurationMinutes)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Date &amp; time</CardTitle>
              <CardDescription>Same availability engine as the online forms; no minimum-notice limit for staff bookings.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <StaffDateTimePicker
                serviceId={service.data?.id ?? null}
                providerId={values.providerId || null}
                packageId={values.packageId || null}
                value={values.startsAt || null}
                onChange={(iso) => form.setValue("startsAt", iso, { shouldDirty: true, shouldValidate: true })}
              />
              {errors.startsAt && <p className="text-sm text-destructive">{errors.startsAt.message}</p>}
              {can("bookings.override_availability") && (
                <Controller
                  control={form.control}
                  name="overrideAvailability"
                  render={({ field }) => (
                    <CheckField
                      id="nb-override"
                      label="Book outside availability"
                      description="Only use this when you've already confirmed the provider can see them - it never overlaps another booking"
                      checked={field.value ?? false}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="nb-first" label="First name" error={errors.personal?.firstName?.message} required>
                  <Input {...fieldA11y("nb-first", errors.personal?.firstName?.message)} {...form.register("personal.firstName")} />
                </Field>
                <Field id="nb-last" label="Last name" error={errors.personal?.lastName?.message} optional>
                  <Input {...fieldA11y("nb-last", errors.personal?.lastName?.message)} {...form.register("personal.lastName", { setValueAs: blankToUndefined })} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="nb-phone" label="Phone" error={errors.personal?.phone?.message} required>
                  <Input type="tel" {...fieldA11y("nb-phone", errors.personal?.phone?.message)} {...form.register("personal.phone")} />
                </Field>
                <Field id="nb-email" label="Email" error={errors.personal?.email?.message} required>
                  <Input type="email" {...fieldA11y("nb-email", errors.personal?.email?.message)} {...form.register("personal.email")} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label id="nb-gender-label">
                    Gender
                    <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Controller
                    control={form.control}
                    name="personal.gender"
                    render={({ field }) => (
                      <RadioGroup aria-labelledby="nb-gender-label" className="flex gap-4 pt-1.5" value={field.value} onValueChange={field.onChange}>
                        {GENDERS.map((g) => (
                          <label key={g} className="flex items-center gap-2 text-sm font-normal">
                            <RadioGroupItem value={g} /> {GENDER_LABELS[g]}
                          </label>
                        ))}
                      </RadioGroup>
                    )}
                  />
                </div>
                <Field id="nb-dob" label="Date of birth" error={errors.personal?.dateOfBirth?.message} optional>
                  <Input type="date" max={new Date().toISOString().slice(0, 10)} {...fieldA11y("nb-dob", errors.personal?.dateOfBirth?.message)} {...form.register("personal.dateOfBirth", { setValueAs: blankToUndefined })} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="nb-city" label="City" error={errors.location?.city?.message} optional>
                  <Input {...fieldA11y("nb-city", errors.location?.city?.message)} {...form.register("location.city", { setValueAs: blankToUndefined })} />
                </Field>
                <Field id="nb-province" label="Province" error={errors.location?.province?.message} optional>
                  <Input {...fieldA11y("nb-province", errors.location?.province?.message)} {...form.register("location.province", { setValueAs: blankToUndefined })} />
                </Field>
                <Field id="nb-address" label="Address" error={errors.location?.address?.message} optional>
                  <Input {...fieldA11y("nb-address", errors.location?.address?.message)} {...form.register("location.address", { setValueAs: blankToUndefined })} />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Booking details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label id="nb-source-label">
                  How was this booked?
                  <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                </Label>
                <Controller
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <RadioGroup aria-labelledby="nb-source-label" className="flex flex-wrap gap-4" value={field.value} onValueChange={field.onChange}>
                      <label className="flex items-center gap-2 text-sm font-normal">
                        <RadioGroupItem value="PHONE" /> Phone
                      </label>
                      <label className="flex items-center gap-2 text-sm font-normal">
                        <RadioGroupItem value="WALK_IN" /> Walk-in
                      </label>
                      <label className="flex items-center gap-2 text-sm font-normal">
                        <RadioGroupItem value="ADMIN" /> Other
                      </label>
                    </RadioGroup>
                  )}
                />
              </div>
              <Controller
                control={form.control}
                name="markPaid"
                render={({ field }) => (
                  <CheckField id="nb-paid" label="Already paid" description="Payment received at the desk" checked={field.value ?? false} onCheckedChange={field.onChange} />
                )}
              />
              {values.markPaid && (
                <Field id="nb-method" label="Payment method" error={errors.paymentMethod?.message} required className="max-w-xs">
                  <Controller
                    control={form.control}
                    name="paymentMethod"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="nb-method">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {PAYMENT_METHOD_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              )}
              <Field id="nb-notes" label="Notes" error={errors.customerNotes?.message} optional>
                <Textarea rows={3} {...fieldA11y("nb-notes", errors.customerNotes?.message)} {...form.register("customerNotes", { setValueAs: blankToUndefined })} />
              </Field>
            </CardContent>
          </Card>
        </form>

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-booking-form" disabled={isSubmitting}>
            {isSubmitting ? "Booking…" : "Create booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
