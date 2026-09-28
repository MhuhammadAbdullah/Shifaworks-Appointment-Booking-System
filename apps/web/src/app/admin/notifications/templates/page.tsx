"use client";

import { useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { EMAIL_TEMPLATE_KEY_LABELS, type EmailTemplateDto } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CheckField } from "@/components/forms/check-field";
import { Field } from "@/components/forms/field";
import { PageHeader } from "@/components/dashboard/app-shell";
import { useEmailTemplates, useInstallDefaultTemplates, usePreviewEmailTemplate, useSendTestNotification, useUpdateEmailTemplate } from "@/lib/api/notifications";
import { usePermissions } from "@/lib/auth/hooks";
import { ApiError } from "@/lib/api-client";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function EmailTemplatesPage() {
  const { can } = usePermissions();
  const { data: templates, isPending, error } = useEmailTemplates();
  const install = useInstallDefaultTemplates();
  const [editing, setEditing] = useState<EmailTemplateDto | null>(null);

  return (
    <div>
      <PageHeader
        title="Email templates"
        description="One template per event and audience. Edit wording, not variables - {{customerName}} etc. are validated against an allow-list."
        actions={
          can("notifications.manage_templates") && (
            <Button
              variant="outline"
              disabled={install.isPending}
              onClick={() =>
                install.mutate(undefined, {
                  onSuccess: (r) => toast.success(`${r.created} created, ${r.refreshed} refreshed`),
                  onError: (e) => toast.error(errorText(e, "Could not install defaults")),
                })
              }
            >
              <RefreshCw className="size-4" /> Install missing defaults
            </Button>
          )
        }
      />

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead className="hidden sm:table-cell">Subject</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={4} className="text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {templates?.map((t) => (
              <TableRow key={t.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setEditing(t)}>
                <TableCell className="font-medium">{EMAIL_TEMPLATE_KEY_LABELS[t.key]}</TableCell>
                <TableCell className="text-sm">{t.audience}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{t.subject}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={t.isActive ? "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-transparent bg-muted text-muted-foreground"}>
                    {t.isActive ? "Active" : "Off"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing && <EditTemplateDialog template={editing} canManage={can("notifications.manage_templates")} canSend={can("notifications.send")} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditTemplateDialog({ template, canManage, canSend, onClose }: { template: EmailTemplateDto; canManage: boolean; canSend: boolean; onClose: () => void }) {
  const update = useUpdateEmailTemplate();
  const preview = usePreviewEmailTemplate();
  const sendTest = useSendTestNotification();
  const form = useForm({ defaultValues: { subject: template.subject, bodyHtml: template.bodyHtml, isActive: template.isActive } });
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [testEmail, setTestEmail] = useState("");

  const onPreview = form.handleSubmit((v) =>
    preview.mutate(
      { key: template.key, subject: v.subject, bodyHtml: v.bodyHtml },
      {
        onSuccess: (r) => {
          setPreviewErrors(r.errors);
          setPreviewHtml(r.errors.length ? null : r.html);
        },
      },
    ),
  );

  const onSubmit = form.handleSubmit((v) =>
    update.mutate(
      { id: template.id, subject: v.subject, bodyHtml: v.bodyHtml, isActive: v.isActive },
      { onSuccess: () => { toast.success("Template saved"); onClose(); }, onError: (e) => toast.error(errorText(e, "Could not save")) },
    ),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {EMAIL_TEMPLATE_KEY_LABELS[template.key]} · {template.audience}
          </DialogTitle>
          <DialogDescription>Only the variables this event provides may be used; an unknown {"{{variable}}"} is rejected on save.</DialogDescription>
        </DialogHeader>
        <form id="tpl-form" onSubmit={onSubmit} className="grid gap-4">
          <Field id="tpl-subject" label="Subject" required>
            <Input id="tpl-subject" disabled={!canManage} {...form.register("subject", { required: true })} />
          </Field>
          <Field id="tpl-body" label="Body (HTML)" required info="Handlebars-style {{variables}} from the allow-list only">
            <Textarea id="tpl-body" rows={10} className="font-mono text-xs" disabled={!canManage} {...form.register("bodyHtml", { required: true })} />
          </Field>
          <CheckField
            id="tpl-active"
            label="Active"
            disabled={!canManage}
            checked={form.watch("isActive")}
            onCheckedChange={(v) => form.setValue("isActive", v, { shouldDirty: true })}
          />
        </form>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void onPreview()} disabled={preview.isPending}>
            {preview.isPending ? "Rendering…" : "Preview with sample data"}
          </Button>
        </div>
        {previewErrors.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-destructive">
            {previewErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {previewHtml && (
          <div className="overflow-hidden rounded-md border">
            <iframe title="Template preview" srcDoc={previewHtml} className="h-64 w-full bg-white" sandbox="" />
          </div>
        )}

        {canSend && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="tpl-test-email">Send a test to</Label>
              <Input id="tpl-test-email" type="email" placeholder="you@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!testEmail || sendTest.isPending}
              onClick={() =>
                sendTest.mutate(
                  { templateKey: template.key, audience: template.audience, to: testEmail },
                  { onSuccess: () => toast.success("Test sent"), onError: (e) => toast.error(errorText(e, "Could not send")) },
                )
              }
            >
              <Send className="size-4" /> Send test
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {canManage && (
            <Button type="submit" form="tpl-form" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
