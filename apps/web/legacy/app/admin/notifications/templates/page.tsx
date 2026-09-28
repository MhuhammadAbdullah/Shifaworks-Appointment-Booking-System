"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENTS,
  TEMPLATE_VARIABLES,
  WHATSAPP_TEMPLATE_STATUSES,
  type NotificationTemplateDto,
  type WhatsAppTemplateDto,
  type WhatsAppTemplateStatus,
} from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/dashboard/app-shell";
import { CheckField } from "@/components/forms/check-field";
import { AUDIENCE_LABELS, CHANNEL_LABELS, NotificationTabs } from "@/components/notifications/shared";
import { usePermissions } from "@/lib/auth/hooks";
import {
  previewTemplate,
  useCreateWhatsAppTemplate,
  useInstallDefaults,
  useTemplates,
  useUpdateTemplate,
  useUpdateWhatsAppTemplate,
  useWhatsAppTemplates,
} from "@/lib/api/notifications";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ApiError } from "@/lib/api-client";
import { titleCase } from "@/lib/format";

const errorText = (e: unknown, fallback: string) =>
  e instanceof ApiError ? [e.message, ...(e.errors?.map((x) => x.message) ?? [])].filter(Boolean).join(": ") : fallback;

export default function TemplatesPage() {
  const { can } = usePermissions();
  const manage = can("notifications.manage_templates");
  const { data: templates, isPending, error } = useTemplates();
  const install = useInstallDefaults();
  const [editing, setEditing] = useState<NotificationTemplateDto | null>(null);

  const byEvent = useMemo(() => {
    const m = new Map<string, NotificationTemplateDto[]>();
    for (const t of templates ?? []) m.set(t.event, [...(m.get(t.event) ?? []), t]);
    return m;
  }, [templates]);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What each message says. Changes apply to messages sent from now on."
        actions={
          manage && (
            <Button
              variant="outline"
              disabled={install.isPending}
              onClick={() =>
                install.mutate(undefined, {
                  onSuccess: (r) =>
                    toast.success(
                      r.templates || r.refreshed || r.whatsapp
                        ? `Added ${r.templates} template(s), refreshed ${r.refreshed} unedited built-in(s)`
                        : "All built-in templates are already installed",
                    ),
                  onError: (e) => toast.error(errorText(e, "Could not install")),
                })
              }
            >
              <Download className="size-4" /> Install missing defaults
            </Button>
          )
        }
      />
      <NotificationTabs />
      {isPending && <Skeleton className="h-64 w-full" />}
      {error && <p className="text-destructive">{error.message}</p>}
      <div className="grid gap-4">
        {NOTIFICATION_EVENTS.filter((e) => byEvent.has(e)).map((event) => (
          <Card key={event}>
            <CardHeader>
              <CardTitle className="text-base">{NOTIFICATION_EVENT_LABELS[event]}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {byEvent.get(event)!.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{CHANNEL_LABELS[t.channel]}</Badge>
                      <span className="text-muted-foreground">to {AUDIENCE_LABELS[t.audience] ?? t.audience}</span>
                      {!t.isActive && <Badge variant="outline">Off</Badge>}
                      {t.channel === "WHATSAPP" && t.whatsAppTemplate && t.whatsAppTemplate.status !== "APPROVED" && (
                        <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
                          Meta template {titleCase(t.whatsAppTemplate.status)}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 truncate text-muted-foreground">{t.subject ?? t.body}</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                    <Pencil className="size-4" /> {manage ? "Edit" : "View"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
      <WhatsAppTemplatesCard manage={manage} />
      {editing && <TemplateDialog template={editing} manage={manage} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateDialog({ template, manage, onClose }: { template: NotificationTemplateDto; manage: boolean; onClose: () => void }) {
  const update = useUpdateTemplate();
  const wa = useWhatsAppTemplates();
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const [isActive, setIsActive] = useState(template.isActive);
  const [waId, setWaId] = useState(template.whatsAppTemplate?.id ?? "none");
  const hasSubject = template.channel !== "WHATSAPP";
  const vars = TEMPLATE_VARIABLES[template.event];

  const dSubject = useDebounced(subject, 400);
  const dBody = useDebounced(body, 400);
  const preview = useQuery({
    queryKey: ["template-preview", template.event, template.channel, dSubject, dBody],
    queryFn: () => previewTemplate({ event: template.event, channel: template.channel, subject: hasSubject ? dSubject : null, body: dBody }),
    placeholderData: (prev) => prev,
  });
  const selectedWa = wa.data?.find((w) => w.id === waId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {NOTIFICATION_EVENT_LABELS[template.event]} · {CHANNEL_LABELS[template.channel]} to {AUDIENCE_LABELS[template.audience]}
          </DialogTitle>
          <DialogDescription>
            Insert details with {"{{variable}}"}; use {"{{#if variable}}…{{/if}}"} for optional parts.
            {template.channel === "EMAIL" && " The body is HTML; values are escaped automatically."}
            {template.channel === "WHATSAPP" && " WhatsApp sends the approved Meta template below; this text is the preview shown in logs."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            {hasSubject && (
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-subject">{template.channel === "EMAIL" ? "Subject" : "Title"}</Label>
                <Input id="tpl-subject" value={subject} disabled={!manage} onChange={(e) => setSubject(e.target.value)} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-body">{template.channel === "EMAIL" ? "Body (HTML)" : "Text"}</Label>
              <Textarea id="tpl-body" rows={template.channel === "EMAIL" ? 10 : 4} className="font-mono text-xs" value={body} disabled={!manage} onChange={(e) => setBody(e.target.value)} />
            </div>
            {manage && (
              <div className="flex flex-wrap gap-1" aria-label="Insert a variable">
                {vars.map((v) => (
                  <button key={v} type="button" className="rounded border px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent" onClick={() => setBody((b) => `${b}{{${v}}}`)}>
                    {v}
                  </button>
                ))}
              </div>
            )}
            {template.channel === "WHATSAPP" && (
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-wa">Meta template</Label>
                <Select value={waId} onValueChange={setWaId} disabled={!manage}>
                  <SelectTrigger id="tpl-wa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {wa.data?.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.metaName} ({titleCase(w.status)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedWa && (
                  <p className="text-xs text-muted-foreground">
                    Sends {selectedWa.variables.map((v, i) => `{{${i + 1}}} = ${v}`).join(", ") || "no variables"}.
                  </p>
                )}
              </div>
            )}
            {manage && <CheckField id="tpl-active" label="Send this message" checked={isActive} onCheckedChange={setIsActive} />}
          </div>
          <div className="grid content-start gap-2">
            <div className="text-xs font-medium text-muted-foreground uppercase">Preview with sample details</div>
            {preview.data?.errors.length ? (
              <ul className="list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-6 text-sm text-destructive">
                {preview.data.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : preview.data ? (
              <div className="grid gap-2">
                {preview.data.subject && <div className="text-sm font-medium">{preview.data.subject}</div>}
                {template.channel === "EMAIL" ? (
                  // Sandboxed: no scripts, no same-origin access.
                  <iframe title="Email preview" sandbox="" srcDoc={preview.data.body} className="h-96 w-full rounded-md border bg-white" />
                ) : (
                  <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{preview.data.text}</p>
                )}
              </div>
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {manage ? "Cancel" : "Close"}
          </Button>
          {manage && (
            <Button
              disabled={update.isPending || Boolean(preview.data?.errors.length)}
              onClick={() =>
                update.mutate(
                  {
                    id: template.id,
                    body: {
                      body,
                      isActive,
                      ...(hasSubject ? { subject: subject.trim() || null } : {}),
                      ...(template.channel === "WHATSAPP" ? { whatsAppTemplateId: waId === "none" ? null : waId } : {}),
                    },
                  },
                  {
                    onSuccess: () => {
                      toast.success("Template saved");
                      onClose();
                    },
                    onError: (e) => toast.error(errorText(e, "Could not save")),
                  },
                )
              }
            >
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const WA_STATUS_TONE: Record<WhatsAppTemplateStatus, string> = {
  DRAFT: "",
  PENDING_APPROVAL: "border-amber-400 text-amber-700 dark:text-amber-400",
  APPROVED: "border-emerald-400 text-emerald-700 dark:text-emerald-400",
  REJECTED: "border-rose-400 text-rose-700 dark:text-rose-400",
  DISABLED: "",
};

function WhatsAppTemplatesCard({ manage }: { manage: boolean }) {
  const { data, isPending } = useWhatsAppTemplates();
  const [editing, setEditing] = useState<WhatsAppTemplateDto | "new" | null>(null);
  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">WhatsApp (Meta) templates</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Business-initiated WhatsApp messages must use templates approved in Meta Business Manager. Create each template there with the same name and variables in this
            order, then mark it Approved here.
          </p>
        </div>
        {manage && (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meta name</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Variables ({"{{1}}"}, {"{{2}}"} …)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-xs">{w.metaName}</TableCell>
                    <TableCell>{w.language}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.variables.join(", ") || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={WA_STATUS_TONE[w.status]}>
                        {titleCase(w.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {manage && (
                        <Button variant="ghost" size="sm" onClick={() => setEditing(w)}>
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {editing && <WhatsAppDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function WhatsAppDialog({ template, onClose }: { template: WhatsAppTemplateDto | null; onClose: () => void }) {
  const create = useCreateWhatsAppTemplate();
  const update = useUpdateWhatsAppTemplate();
  const [key, setKey] = useState(template?.key ?? "");
  const [metaName, setMetaName] = useState(template?.metaName ?? "");
  const [language, setLanguage] = useState(template?.language ?? "en");
  const [variables, setVariables] = useState(template?.variables.join(", ") ?? "");
  const [status, setStatus] = useState<WhatsAppTemplateStatus>(template?.status ?? "DRAFT");
  const vars = variables
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const done = {
    onSuccess: () => {
      toast.success("WhatsApp template saved");
      onClose();
    },
    onError: (e: unknown) => toast.error(errorText(e, "Could not save")),
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? `WhatsApp template: ${template.key}` : "New WhatsApp template"}</DialogTitle>
          <DialogDescription>Must match the template approved in Meta exactly (name, language and variable order).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {!template && (
            <div className="grid gap-1.5">
              <Label htmlFor="wa-key">Internal key</Label>
              <Input id="wa-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="follow_up" />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="wa-name">Meta template name</Label>
            <Input id="wa-name" value={metaName} onChange={(e) => setMetaName(e.target.value)} className="font-mono" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wa-lang">Language code</Label>
            <Input id="wa-lang" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en, en_US, ur" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wa-status">Status in Meta</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as WhatsAppTemplateStatus)}>
              <SelectTrigger id="wa-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WHATSAPP_TEMPLATE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {titleCase(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="wa-vars">Variables in order, comma separated</Label>
            <Input id="wa-vars" value={variables} onChange={(e) => setVariables(e.target.value)} placeholder="customerName, serviceName, date, time" />
            <p className="text-xs text-muted-foreground">{vars.map((v, i) => `{{${i + 1}}} → ${v}`).join("  ·  ")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || update.isPending || !metaName.trim()}
            onClick={() =>
              template
                ? update.mutate({ id: template.id, body: { metaName: metaName.trim(), language: language.trim(), variables: vars, status } }, done)
                : create.mutate({ key: key.trim(), metaName: metaName.trim(), language: language.trim(), category: "UTILITY", variables: vars, status }, done)
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
