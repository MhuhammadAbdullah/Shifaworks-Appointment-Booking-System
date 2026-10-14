"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { CONCERN_CHECKLIST_LABEL, isServiceSlug, type ConcernOptionDto, type ProviderDto } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckField } from "@/components/forms/check-field";
import { Field, fieldA11y } from "@/components/forms/field";
import { useCreateConcernOption, useDeleteConcernOption, useUpdateConcernOption } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api-client";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** The checklist question this provider's services ask ("Areas of concern", "What would you like coaching on?"), or null if none of them has one. */
export function providerChecklistLabel(provider: ProviderDto): string | null {
  for (const s of provider.services) {
    if (isServiceSlug(s.slug) && CONCERN_CHECKLIST_LABEL[s.slug]) return CONCERN_CHECKLIST_LABEL[s.slug]!;
  }
  return null;
}

/** This provider's own checklist options on the "Areas of concern" question — patients always also see a fixed "Other". */
export function ConcernOptionsCard({ provider, readOnly }: { provider: ProviderDto; readOnly: boolean }) {
  const [editing, setEditing] = useState<ConcernOptionDto | "new" | null>(null);
  const remove = useDeleteConcernOption(provider.id);
  const options = [...provider.concernOptions].sort((a, b) => a.sortOrder - b.sortOrder);
  const questionLabel = providerChecklistLabel(provider);
  const fieldLabel = questionLabel ?? "Areas of concern";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{fieldLabel}</CardTitle>
        <CardDescription>
            What {provider.displayName} covers. These choices appear on the booking form under "{fieldLabel}" when a patient books with them,
            together with a fixed "Other" and a text box. With no options, patients see only "Other".
        </CardDescription>
        {!questionLabel && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            None of {provider.displayName}&apos;s services asks this question yet. It appears on Clinical Counseling, Faith-Based Counseling and
            Islamic Life Coaching, so assign one of them above for these options to show on a booking form.
          </p>
        )}
      </CardHeader>
      <CardContent className="grid gap-3 px-0 sm:px-6">
        {!readOnly && (
          <div className="flex justify-end px-6 sm:px-0">
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Add option
            </Button>
          </div>
        )}
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead className="hidden sm:table-cell">Code</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {options.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  No options yet.
                </TableCell>
              </TableRow>
            )}
            {options.map((o) => (
              <TableRow key={o.id} className={o.isActive ? undefined : "opacity-60"}>
                <TableCell className="font-medium">{o.label}</TableCell>
                <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{o.code}</TableCell>
                <TableCell>{o.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Hidden</Badge>}</TableCell>
                <TableCell>
                  {!readOnly && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${o.label}`} onClick={() => setEditing(o)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${o.label}`}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (!window.confirm(`Delete "${o.label}"? Past bookings keep their answer as-is.`)) return;
                          remove.mutate(o.id, {
                            onSuccess: () => toast.success("Deleted"),
                            onError: (e) => toast.error(errorText(e, "Could not delete")),
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
        </div>
      </CardContent>
      {editing && (
        <ConcernOptionDialog provider={provider} option={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Card>
  );
}

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Required")
    .max(50)
    .regex(/^[A-Za-z][A-Za-z0-9_ ]*$/, "Letters, numbers and underscores only")
    .transform((v) => v.toUpperCase().replace(/ /g, "_")),
  label: z.string().trim().min(1, "Required").max(120),
  isActive: z.boolean(),
});
type Values = z.input<typeof schema>;

function ConcernOptionDialog({ provider, option, onClose }: { provider: ProviderDto; option: ConcernOptionDto | null; onClose: () => void }) {
  const create = useCreateConcernOption(provider.id);
  const update = useUpdateConcernOption(provider.id);
  const form = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { code: option?.code ?? "", label: option?.label ?? "", isActive: option?.isActive ?? true },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (option) await update.mutateAsync({ id: option.id, body: v });
      else await create.mutateAsync(v);
      toast.success("Saved");
      onClose();
    } catch (e) {
      if (e instanceof ApiError) for (const fe of e.errors) form.setError(fe.path as "code", { message: fe.message });
      toast.error(errorText(e, "Could not save"));
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{option ? "Edit option" : "New option"}</DialogTitle>
          <DialogDescription>{provider.displayName}</DialogDescription>
        </DialogHeader>
        <form id="concern-option-form" onSubmit={onSubmit} noValidate className="grid gap-3">
          <Field id="co-label" label="Label" error={errors.label?.message} required info="Shown to customers on the form">
            <Input placeholder="e.g. Anxiety" {...fieldA11y("co-label", errors.label?.message)} {...form.register("label")} />
          </Field>
          <Field
            id="co-code"
            label="Code"
            error={errors.code?.message}
            required
            info="Internal key, stored with each booking's answer — avoid changing it once it's in use"
          >
            <Input placeholder="e.g. ANXIETY" className="font-mono" {...fieldA11y("co-code", errors.code?.message)} {...form.register("code")} />
          </Field>
          <CheckField
            id="co-active"
            label="Shown on the booking form"
            checked={form.watch("isActive")}
            onCheckedChange={(v) => form.setValue("isActive", v, { shouldDirty: true })}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="concern-option-form" disabled={isSubmitting}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
