"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { GENDERS, GENDER_LABELS, type ProviderDto, type UpdateProviderInput } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckField } from "@/components/forms/check-field";
import { Field, fieldA11y } from "@/components/forms/field";
import { ImageUpload } from "@/components/forms/image-upload";
import { TagInput } from "@/components/forms/tag-input";
import { ApiError } from "@/lib/api-client";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const schema = z
  .object({
    displayName: z.string().trim().min(2, "Required").max(120),
    designation: z.string().trim().max(120),
    email: z.preprocess(blank, z.email("Enter a valid email").optional()),
    phone: z.preprocess(
      blank,
      z
        .string()
        .transform((v) => v.replace(/[\s-]/g, ""))
        .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, "Enter a valid phone number"))
        .optional(),
    ),
    gender: z.enum(GENDERS),
    acceptsMale: z.boolean(),
    acceptsFemale: z.boolean(),
    experienceYears: z.coerce.number().int().min(0).max(80),
    rating: z.preprocess(blank, z.coerce.number().min(0).max(5).optional()),
    specializations: z.array(z.string()),
    bio: z.string().trim().max(3000),
    isActive: z.boolean(),
    sortOrder: z.coerce.number().int().min(0).max(10_000),
  })
  .refine((v) => v.acceptsMale || v.acceptsFemale, { path: ["acceptsFemale"], message: "Accept at least one gender" });
type Values = z.input<typeof schema>;

const toValues = (p: ProviderDto): Values => ({
  displayName: p.displayName,
  designation: p.designation ?? "",
  email: p.email ?? "",
  phone: p.phone ?? "",
  gender: p.gender,
  acceptsMale: p.acceptsMale,
  acceptsFemale: p.acceptsFemale,
  experienceYears: p.experienceYears,
  rating: p.rating ?? "",
  specializations: p.specializations,
  bio: p.bio ?? "",
  isActive: p.isActive,
  sortOrder: p.sortOrder,
});

/**
 * mode="self": the provider edits their own public card (designation, bio,
 * specialisations, photo, phone). Identity, gender matching, rating and status
 * are admin-only; the API rejects them from providers anyway.
 */
export function ProviderProfileForm({
  provider,
  mode,
  onSave,
  readOnly = false,
}: {
  provider: ProviderDto;
  mode: "admin" | "self";
  onSave: (body: UpdateProviderInput) => Promise<ProviderDto>;
  readOnly?: boolean;
}) {
  const [photo, setPhoto] = useState({ id: provider.profileImageId, url: provider.profileImageUrl });
  const form = useForm<Values, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema), defaultValues: toValues(provider) });
  const { errors, isSubmitting, isDirty } = form.formState;
  const admin = mode === "admin";

  const onSubmit = form.handleSubmit(async (v) => {
    const own = {
      designation: v.designation || null,
      bio: v.bio || null,
      specializations: v.specializations,
      phone: v.phone ?? null,
      profileImageId: photo.id,
    };
    const body: UpdateProviderInput = admin
      ? {
          ...own,
          displayName: v.displayName,
          email: v.email ?? null,
          gender: v.gender,
          acceptsMale: v.acceptsMale,
          acceptsFemale: v.acceptsFemale,
          experienceYears: v.experienceYears,
          rating: v.rating ?? null,
          isActive: v.isActive,
          sortOrder: v.sortOrder,
        }
      : own;
    try {
      const saved = await onSave(body);
      form.reset(toValues(saved));
      setPhoto({ id: saved.profileImageId, url: saved.profileImageUrl });
      toast.success("Profile saved");
    } catch (err) {
      if (err instanceof ApiError) {
        for (const e of err.errors) form.setError(e.path as "bio", { message: e.message });
        toast.error(err.message);
      } else toast.error("Could not save the profile");
    }
  });

  const check = (name: "acceptsMale" | "acceptsFemale" | "isActive", label: string, description?: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <CheckField
          id={`pp-${name}`}
          label={label}
          {...(description ? { description } : {})}
          checked={field.value}
          onCheckedChange={field.onChange}
          disabled={readOnly}
        />
      )}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{admin ? "Profile" : "Your profile card"}</CardTitle>
        <CardDescription>Customers see the photo, name, designation, experience and rating when choosing a provider.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly}>
          <CardContent className="grid gap-4">
            <Field id="pp-photo" label="Photo" optional>
              <ImageUpload
                id="pp-photo"
                shape="square"
                url={photo.url}
                disabled={readOnly}
                onChange={(img) => setPhoto(img ?? { id: null, url: null })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {admin && (
                <Field id="pp-name" label="Name" error={errors.displayName?.message} required info="As shown to customers, e.g. HK. Hayyan Marfani">
                  <Input {...fieldA11y("pp-name", errors.displayName?.message)} {...form.register("displayName")} />
                </Field>
              )}
              <Field id="pp-designation" label="Designation" error={errors.designation?.message} optional info="e.g. Hijama Therapist">
                <Input {...fieldA11y("pp-designation", errors.designation?.message)} {...form.register("designation")} />
              </Field>
            </div>
            {admin && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="pp-exp" label="Years of experience" error={errors.experienceYears?.message} required>
                  <Input type="number" min={0} {...fieldA11y("pp-exp", errors.experienceYears?.message)} {...form.register("experienceYears")} />
                </Field>
                <Field id="pp-rating" label="Rating (0–5)" error={errors.rating?.message} optional info="Leave empty to hide the stars on the booking form">
                  <Input type="number" min={0} max={5} step={0.1} {...fieldA11y("pp-rating", errors.rating?.message)} {...form.register("rating")} />
                </Field>
                <Field id="pp-gender" label="Gender" required>
                  <Controller
                    control={form.control}
                    name="gender"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={readOnly}>
                        <SelectTrigger id="pp-gender">
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
            )}
            {admin && (
              <fieldset className="grid gap-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Accepts customers</legend>
                <div className="flex flex-wrap gap-6">
                  {check("acceptsMale", "Male")}
                  {check("acceptsFemale", "Female")}
                </div>
                {errors.acceptsFemale && <p className="text-sm text-destructive">{errors.acceptsFemale.message}</p>}
                <p className="text-xs text-muted-foreground">
                  The booking form only offers this provider to customers of the ticked genders.
                </p>
              </fieldset>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {admin && (
                <Field id="pp-email" label="Email" error={errors.email?.message} optional info="Receives “New Booking Confirmed” emails">
                  <Input type="email" {...fieldA11y("pp-email", errors.email?.message)} {...form.register("email")} />
                </Field>
              )}
              <Field id="pp-phone" label="Phone" error={errors.phone?.message} optional>
                <Input type="tel" {...fieldA11y("pp-phone", errors.phone?.message)} {...form.register("phone")} />
              </Field>
            </div>
            <Field id="pp-spec" label="Specialisations" optional>
              <Controller
                control={form.control}
                name="specializations"
                render={({ field }) => (
                  <TagInput id="pp-spec" value={field.value} onChange={field.onChange} placeholder="e.g. Sciatica - press Enter" disabled={readOnly} />
                )}
              />
            </Field>
            <Field id="pp-bio" label="About" error={errors.bio?.message} optional>
              <Textarea rows={4} {...fieldA11y("pp-bio", errors.bio?.message)} {...form.register("bio")} />
            </Field>
            {admin && (
              <div className="grid items-end gap-3 sm:grid-cols-2">
                {check("isActive", "Active", "Inactive providers are hidden from the booking forms")}
                <Field id="pp-sort" label="Display order" error={errors.sortOrder?.message} required info="Lower numbers are listed first">
                  <Input type="number" min={0} {...fieldA11y("pp-sort", errors.sortOrder?.message)} {...form.register("sortOrder")} />
                </Field>
              </div>
            )}
          </CardContent>
        </fieldset>
        {!readOnly && (
          <CardFooter className="mt-4 justify-end">
            <Button type="submit" disabled={isSubmitting || (!isDirty && photo.id === provider.profileImageId)}>
              {isSubmitting ? "Saving…" : "Save profile"}
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}
