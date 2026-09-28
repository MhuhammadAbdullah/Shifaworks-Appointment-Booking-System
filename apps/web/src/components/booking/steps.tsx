"use client";

import { useState } from "react";
import { Controller } from "react-hook-form";
import Link from "next/link";
import { Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { GENDERS, GENDER_LABELS, type PublicPackageDto, type PublicProviderDto, type PublicServiceDto } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, fieldA11y } from "@/components/forms/field";
import { useUploadPublicReceipt } from "@/lib/api/public";
import { ApiError } from "@/lib/api-client";
import { formatDate, formatMoney, formatTime12 } from "@/lib/format";
import { blankToUndefined, type BaseBookingValues, type StepProps } from "./wizard-types";

export function PersonalStep<TValues extends BaseBookingValues>({ form }: StepProps<TValues>) {
  const { errors } = form.formState;
  const personal = errors.personal as Record<string, { message?: string } | undefined> | undefined;
  const location = errors.location as Record<string, { message?: string } | undefined> | undefined;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">A few details so we know who we&apos;re booking for.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="p-first" label="First name" required error={personal?.firstName?.message}>
          <Input {...fieldA11y("p-first", personal?.firstName?.message)} {...form.register("personal.firstName" as never)} />
        </Field>
        <Field id="p-last" label="Last name" optional error={personal?.lastName?.message}>
          <Input {...fieldA11y("p-last", personal?.lastName?.message)} {...form.register("personal.lastName" as never)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="p-phone" label="Contact number" required error={personal?.phone?.message} info="We only use this to confirm your appointment and, if needed, contact you about it.">
          <Input type="tel" placeholder="03001234567" {...fieldA11y("p-phone", personal?.phone?.message)} {...form.register("personal.phone" as never)} />
        </Field>
        <Field id="p-email" label="Email" required error={personal?.email?.message}>
          <Input type="email" placeholder="you@example.com" {...fieldA11y("p-email", personal?.email?.message)} {...form.register("personal.email" as never)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="p-dob" label="Date of birth" optional error={personal?.dateOfBirth?.message}>
          <Input
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            {...fieldA11y("p-dob", personal?.dateOfBirth?.message)}
            {...form.register("personal.dateOfBirth" as never, { setValueAs: blankToUndefined })}
          />
        </Field>
        <Field id="p-gender" label="Gender" required error={personal?.gender?.message} info="Used to match you with a provider comfortable seeing your gender.">
          <Controller
            control={form.control}
            name={"personal.gender" as never}
            render={({ field }) => (
              <Select value={(field.value as string) || undefined} onValueChange={field.onChange}>
                <SelectTrigger id="p-gender" className="w-full" aria-invalid={Boolean(personal?.gender?.message)}>
                  <SelectValue placeholder="Select" />
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="l-city" label="City" required error={location?.city?.message}>
          <Input {...fieldA11y("l-city", location?.city?.message)} {...form.register("location.city" as never)} />
        </Field>
        <Field id="l-province" label="Province / state" optional error={location?.province?.message}>
          <Input {...fieldA11y("l-province", location?.province?.message)} {...form.register("location.province" as never, { setValueAs: blankToUndefined })} />
        </Field>
      </div>
    </div>
  );
}

/** Off-screen (not display:none, so simple bots that skip hidden fields still get caught) and never focusable by a real visitor. */
export function HoneypotField<TValues extends BaseBookingValues>({ form }: StepProps<TValues>) {
  return (
    <div className="absolute -left-[9999px] size-px overflow-hidden" aria-hidden="true">
      <label htmlFor="website">Leave this field empty</label>
      <input id="website" type="text" tabIndex={-1} autoComplete="off" {...form.register("website" as never)} />
    </div>
  );
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function ReceiptUpload<TValues extends BaseBookingValues>({ form }: StepProps<TValues>) {
  const upload = useUploadPublicReceipt();
  const [fileName, setFileName] = useState<string | null>(null);
  const fileId = (form.watch() as BaseBookingValues).receiptFileId;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    upload.mutate(file, {
      onSuccess: (r) => form.setValue("receiptFileId" as never, r.id as never, { shouldDirty: true }),
      onError: (err) => {
        setFileName(null);
        toast.error(errorText(err, "Could not upload the receipt"));
      },
    });
  }

  function clear() {
    setFileName(null);
    form.setValue("receiptFileId" as never, undefined as never, { shouldDirty: true });
  }

  return (
    <Field id="r-receipt" label="Payment receipt" optional info="Already paid? Attach a screenshot or photo of your receipt so we can verify it faster.">
      {fileId && fileName ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5 truncate">
            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" /> {fileName}
          </span>
          <button type="button" onClick={clear} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Remove receipt">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:bg-accent/50">
          {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          {upload.isPending ? "Uploading…" : "Attach a receipt (image or PDF)"}
          <input id="r-receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={upload.isPending} onChange={onPick} />
        </label>
      )}
    </Field>
  );
}

export function ReviewStep<TValues extends BaseBookingValues>({
  form,
  provider,
  pkg,
  service,
  termsUrl,
  timezone,
}: StepProps<TValues> & { provider: PublicProviderDto | null; pkg: PublicPackageDto | null; service: PublicServiceDto; termsUrl: string; timezone: string }) {
  const v = form.getValues();
  const { errors } = form.formState;
  const startsAt = v.startsAt as string | undefined;
  const rows: [string, string][] = [
    ["Name", [v.personal.firstName, v.personal.lastName].filter(Boolean).join(" ")],
    ["Contact", `${v.personal.phone} · ${v.personal.email}`],
    ["Location", [v.location.city, v.location.province].filter(Boolean).join(", ")],
    ["Provider", provider?.displayName ?? "-"],
    ["Package", pkg?.name ?? "-"],
    ["Date & time", startsAt ? `${formatDate(startsAt, timezone)} at ${formatTime12(startsAt, timezone)}` : "-"],
  ];
  const payRows: [string, string][] = [
    ["Bank", service.paymentInstructions.bankName],
    ["Account title", service.paymentInstructions.accountTitle],
    ["Account number", service.paymentInstructions.accountNumber],
    ["IBAN", service.paymentInstructions.iban],
    ["JazzCash", service.paymentInstructions.jazzcash],
    ["Easypaisa", service.paymentInstructions.easypaisa],
  ].filter(([, val]) => val) as [string, string][];

  return (
    <div className="grid gap-5">
      <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
        {pkg && (
          <>
            <div className="my-1 border-t" />
            {pkg.originalPrice && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Price</span>
                <span className="text-right text-muted-foreground line-through">{formatMoney(pkg.originalPrice, service.currency)}</span>
              </div>
            )}
            {pkg.discountPercent && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Discount</span>
                <span className="text-right font-medium text-emerald-700 dark:text-emerald-400">
                  <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{pkg.discountPercent}% OFF</Badge>
                </span>
              </div>
            )}
            <div className="flex justify-between gap-4 text-base">
              <span className="font-medium">Amount payable</span>
              <span className="text-right font-semibold">{formatMoney(pkg.price, service.currency)}</span>
            </div>
          </>
        )}
      </div>

      {payRows.length > 0 && (
        <div className="grid gap-1.5 rounded-md border bg-muted/40 p-3 text-sm">
          <p className="mb-1 font-medium">Payment details</p>
          {payRows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{label}</span>
              <span className="text-right font-medium">{value}</span>
            </div>
          ))}
          {service.paymentInstructions.instructions && <p className="pt-1 text-muted-foreground">{service.paymentInstructions.instructions}</p>}
        </div>
      )}

      <ReceiptUpload form={form} />

      <Controller
        control={form.control}
        name={"termsAccepted" as never}
        render={({ field }) => (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={field.value as boolean} onCheckedChange={field.onChange} className="mt-0.5" />
            <span>
              I agree to the{" "}
              <Link href={termsUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                Terms &amp; Conditions
              </Link>
            </span>
          </label>
        )}
      />
      {(errors as Record<string, { message?: string } | undefined>).termsAccepted?.message && (
        <p className="-mt-3 text-sm text-destructive">{(errors as Record<string, { message?: string } | undefined>).termsAccepted!.message}</p>
      )}
    </div>
  );
}
