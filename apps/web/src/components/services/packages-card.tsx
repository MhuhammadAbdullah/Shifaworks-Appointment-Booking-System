"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import type { PackageDto, ServiceDto } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CheckField } from "@/components/forms/check-field";
import { Field, fieldA11y } from "@/components/forms/field";
import { useCreatePackage, useDeletePackage, useUpdatePackage } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api-client";
import { formatDuration, formatMoney, titleCase } from "@/lib/format";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Hijama packages / counselling session types: name, points, duration and price. */
export function PackagesCard({ service, packageNoun, readOnly }: { service: ServiceDto; packageNoun: string; readOnly: boolean }) {
  const [editing, setEditing] = useState<PackageDto | "new" | null>(null);
  const update = useUpdatePackage(service.id);
  const remove = useDeletePackage(service.id);
  const noun = titleCase(packageNoun);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="grid gap-1.5">
          <CardTitle>{noun}s</CardTitle>
          <CardDescription>
            Customers choose one on the form. Price and duration always come from here, never from the browser.
          </CardDescription>
        </div>
        {!readOnly && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Add {packageNoun}
          </Button>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 sm:px-6 sm:pb-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{noun}</TableHead>
              <TableHead className="hidden sm:table-cell">Duration</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {service.packages.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  No {packageNoun}s yet.
                </TableCell>
              </TableRow>
            )}
            {service.packages.map((p) => (
              <TableRow key={p.id} className={p.isActive ? undefined : "opacity-60"}>
                <TableCell>
                  <div className="font-medium">
                    {p.name}
                    {p.points !== null && <span className="ml-1 text-xs text-muted-foreground">({p.points}-point)</span>}
                  </div>
                  {p.description && <div className="line-clamp-2 text-xs text-muted-foreground">{p.description}</div>}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{formatDuration(p.effectiveDurationMinutes)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.discountEnabled && p.discountPercent ? (
                    <div className="grid gap-0.5">
                      <span className="text-xs text-muted-foreground line-through">{formatMoney(p.price, service.currency)}</span>
                      <span>{formatMoney(p.discountedPrice, service.currency)}</span>
                    </div>
                  ) : (
                    formatMoney(p.price, service.currency)
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {p.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Hidden</Badge>}
                    {p.discountEnabled && p.discountPercent && (
                      <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{p.discountPercent}% OFF</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {!readOnly && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${p.name}`}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (!window.confirm(`Delete “${p.name}”?`)) return;
                          remove.mutate(p.id, {
                            onSuccess: () => toast.success("Deleted"),
                            onError: (e) => {
                              // Booked packages are kept; offer to hide instead.
                              if (e instanceof ApiError && e.status === 409 && p.isActive && window.confirm(`${e.message}\n\nHide it now?`)) {
                                update.mutate({ id: p.id, body: { isActive: false } }, { onSuccess: () => toast.success("Hidden") });
                              } else toast.error(errorText(e, "Could not delete"));
                            },
                          });
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {editing && (
        <PackageDialog
          service={service}
          noun={noun}
          pkg={editing === "new" ? null : editing}
          showPoints={service.slug === "hijama-therapy"}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

const blank = (v: unknown) => (v === "" ? null : v);
const schema = z.object({
  name: z.string().trim().min(2, "Required").max(120),
  description: z.string().trim().max(1000),
  points: z.preprocess(blank, z.coerce.number().int().min(1).max(100).nullable()),
  durationMinutes: z.preprocess(blank, z.coerce.number().int().min(5).max(480).nullable()),
  price: z.coerce.number({ error: "Enter a price" }).min(0).max(100_000_000),
  discountEnabled: z.boolean(),
  discountPercent: z.preprocess(blank, z.coerce.number().min(0).max(100).nullable()),
  isActive: z.boolean(),
});
type Values = z.input<typeof schema>;

function PackageDialog({
  service,
  noun,
  pkg,
  showPoints,
  onClose,
}: {
  service: ServiceDto;
  noun: string;
  pkg: PackageDto | null;
  showPoints: boolean;
  onClose: () => void;
}) {
  const create = useCreatePackage(service.id);
  const update = useUpdatePackage(service.id);
  const form = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: pkg?.name ?? "",
      description: pkg?.description ?? "",
      points: pkg?.points ?? "",
      durationMinutes: pkg?.durationMinutes ?? "",
      price: pkg ? Number(pkg.price) : "",
      discountEnabled: pkg?.discountEnabled ?? false,
      discountPercent: pkg?.discountPercent ?? "",
      isActive: pkg?.isActive ?? true,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const discountEnabled = form.watch("discountEnabled");

  const onSubmit = form.handleSubmit(async (v) => {
    const body = { ...v, description: v.description || null, points: showPoints ? v.points : null, discountPercent: v.discountEnabled ? v.discountPercent : null };
    try {
      if (pkg) await update.mutateAsync({ id: pkg.id, body });
      else await create.mutateAsync(body);
      toast.success("Saved");
      onClose();
    } catch (e) {
      if (e instanceof ApiError) for (const fe of e.errors) form.setError(fe.path as "name", { message: fe.message });
      toast.error(errorText(e, "Could not save"));
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{pkg ? `Edit ${noun.toLowerCase()}` : `New ${noun.toLowerCase()}`}</DialogTitle>
          <DialogDescription>{service.name}</DialogDescription>
        </DialogHeader>
        <form id="package-form" onSubmit={onSubmit} noValidate className="grid gap-3">
          <Field id="pk-name" label="Name" error={errors.name?.message} required>
            <Input
              placeholder={showPoints ? "e.g. Sciatic Support Package" : "e.g. Individual session"}
              {...fieldA11y("pk-name", errors.name?.message)}
              {...form.register("name")}
            />
          </Field>
          <Field id="pk-desc" label="Description" error={errors.description?.message} optional>
            <Textarea rows={3} {...fieldA11y("pk-desc", errors.description?.message)} {...form.register("description")} />
          </Field>
          <div className={`grid gap-3 ${showPoints ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {showPoints && (
              <Field id="pk-points" label="Cup points" error={errors.points?.message} optional>
                <Input type="number" min={1} {...fieldA11y("pk-points", errors.points?.message)} {...form.register("points")} />
              </Field>
            )}
            <Field
              id="pk-duration"
              label="Duration (min)"
              error={errors.durationMinutes?.message}
              optional
              info={`Leave empty to use the service default (${service.defaultDurationMinutes} min)`}
            >
              <Input type="number" min={5} {...fieldA11y("pk-duration", errors.durationMinutes?.message)} {...form.register("durationMinutes")} />
            </Field>
            <Field id="pk-price" label={`Price (${service.currency})`} error={errors.price?.message} required>
              <Input type="number" min={0} step="0.01" {...fieldA11y("pk-price", errors.price?.message)} {...form.register("price")} />
            </Field>
          </div>
          <CheckField
            id="pk-discount-enabled"
            label="Discount"
            description="Shows the original price crossed out, plus a % OFF badge, on the booking form"
            checked={discountEnabled}
            onCheckedChange={(v) => form.setValue("discountEnabled", v, { shouldDirty: true })}
          />
          {discountEnabled && (
            <Field id="pk-discount-percent" label="Discount percentage" error={errors.discountPercent?.message} required>
              <Input type="number" min={0} max={100} step="0.01" {...fieldA11y("pk-discount-percent", errors.discountPercent?.message)} {...form.register("discountPercent")} />
            </Field>
          )}
          <CheckField
            id="pk-active"
            label="Shown on the booking form"
            checked={form.watch("isActive")}
            onCheckedChange={(v) => form.setValue("isActive", v, { shouldDirty: true })}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="package-form" disabled={isSubmitting}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
