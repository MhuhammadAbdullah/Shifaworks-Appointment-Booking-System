"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { GENDERS, GENDER_LABELS, PROVIDER_TYPES, PROVIDER_TYPE_LABELS, type ProviderType } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckField } from "@/components/forms/check-field";
import { Field, fieldA11y } from "@/components/forms/field";
import { useCreateProvider, useServices } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api-client";

const schema = z
  .object({
    providerType: z.enum(PROVIDER_TYPES),
    displayName: z.string().trim().min(2, "Required").max(120),
    designation: z.string().trim().max(120),
    email: z.preprocess((v) => (v === "" ? undefined : v), z.email("Enter a valid email").optional()),
    gender: z.enum(GENDERS),
    acceptsMale: z.boolean(),
    acceptsFemale: z.boolean(),
    experienceYears: z.coerce.number().int().min(0).max(80),
    serviceIds: z.array(z.string()),
  })
  .refine((v) => v.acceptsMale || v.acceptsFemale, { path: ["acceptsFemale"], message: "Accept at least one gender" });
type Values = z.input<typeof schema>;

/** Quick create: identity, gender matching and services. Photo, rating and bio are on the provider's own detail popup. */
export function CreateProviderDialog({
  defaultType,
  onClose,
  onCreated,
}: {
  defaultType: ProviderType;
  onClose: () => void;
  /** Called with the new provider's id right after creation, so the caller can open its detail popup. */
  onCreated?: (providerId: string) => void;
}) {
  const create = useCreateProvider();
  const services = useServices();
  const form = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      providerType: defaultType,
      displayName: "",
      designation: "",
      email: "",
      gender: "FEMALE",
      acceptsMale: false,
      acceptsFemale: true,
      experienceYears: 0,
      serviceIds: [],
    },
  });
  const { errors, isSubmitting } = form.formState;
  const type = form.watch("providerType");
  const offered = (services.data ?? []).filter((s) => !s.providerType || s.providerType === type);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const provider = await create.mutateAsync({
        ...v,
        designation: v.designation || null,
        email: v.email ?? null,
        serviceIds: v.serviceIds.filter((id) => offered.some((s) => s.id === id)),
      });
      toast.success("Provider added. Next: photo and weekly hours.");
      onClose();
      onCreated?.(provider.id);
    } catch (e) {
      if (e instanceof ApiError) for (const fe of e.errors) form.setError(fe.path as "displayName", { message: fe.message });
      toast.error(e instanceof ApiError ? e.message : "Could not add the provider");
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Add provider</DialogTitle>
          <DialogDescription>A therapist or counsellor customers can book. A dashboard login is optional and can be sent later.</DialogDescription>
        </DialogHeader>
        <form id="create-provider" onSubmit={onSubmit} noValidate className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-6 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cp-type" label="Type" required>
              <Controller
                control={form.control}
                name="providerType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="cp-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDER_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {PROVIDER_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field id="cp-gender" label="Gender" required>
              <Controller
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(g) => {
                      field.onChange(g);
                      // Sensible default: same-gender matching, adjustable below.
                      form.setValue("acceptsMale", g === "MALE");
                      form.setValue("acceptsFemale", g === "FEMALE");
                    }}
                  >
                    <SelectTrigger id="cp-gender">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GENDERS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {GENDER_LABELS[g]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
          <Field id="cp-name" label="Name" error={errors.displayName?.message} required info="As customers will see it">
            <Input {...fieldA11y("cp-name", errors.displayName?.message)} {...form.register("displayName")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Field id="cp-designation" label="Designation" error={errors.designation?.message} optional>
              <Input placeholder="e.g. Hijama Therapist" {...fieldA11y("cp-designation", errors.designation?.message)} {...form.register("designation")} />
            </Field>
            <Field id="cp-exp" label="Experience (yrs)" error={errors.experienceYears?.message} required>
              <Input type="number" min={0} {...fieldA11y("cp-exp", errors.experienceYears?.message)} {...form.register("experienceYears")} />
            </Field>
          </div>
          <Field
            id="cp-email"
            label="Email"
            error={errors.email?.message}
            optional
            info="For booking-confirmed emails and the dashboard login - can be added later"
          >
            <Input type="email" {...fieldA11y("cp-email", errors.email?.message)} {...form.register("email")} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Accepts customers</legend>
            <div className="flex gap-6">
              <CheckField id="cp-male" label="Male" checked={form.watch("acceptsMale")} onCheckedChange={(v) => form.setValue("acceptsMale", v)} />
              <CheckField id="cp-female" label="Female" checked={form.watch("acceptsFemale")} onCheckedChange={(v) => form.setValue("acceptsFemale", v)} />
            </div>
            {errors.acceptsFemale && <p className="text-sm text-destructive">{errors.acceptsFemale.message}</p>}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Services</legend>
            <Controller
              control={form.control}
              name="serviceIds"
              render={({ field }) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  {offered.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                      <Checkbox
                        checked={field.value.includes(s.id)}
                        onCheckedChange={(c) => field.onChange(c ? [...field.value, s.id] : field.value.filter((id) => id !== s.id))}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
            />
          </fieldset>
        </form>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-provider" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
