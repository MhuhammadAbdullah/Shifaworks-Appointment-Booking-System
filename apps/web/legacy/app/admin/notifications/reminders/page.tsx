"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DELIVERABLE_CHANNELS, type NotificationChannel, type ReminderRuleDto } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { CheckField } from "@/components/forms/check-field";
import { CHANNEL_LABELS, NotificationTabs } from "@/components/notifications/shared";
import { usePermissions } from "@/lib/auth/hooks";
import { useCreateReminderRule, useDeleteReminderRule, useReminderRules, useUpdateReminderRule } from "@/lib/api/notifications";
import { ApiError } from "@/lib/api-client";

type Target = "APPOINTMENT" | "EVENT";
type Channel = (typeof DELIVERABLE_CHANNELS)[number];
const deliverable = (c: NotificationChannel): c is Channel => (DELIVERABLE_CHANNELS as readonly string[]).includes(c);
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function formatOffset(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

export default function RemindersPage() {
  const { can } = usePermissions();
  const manage = can("notifications.manage_templates");
  const { data, isPending, error } = useReminderRules();

  return (
    <>
      <PageHeader title="Notifications" description="Automatic reminders before confirmed appointments and events." />
      <NotificationTabs />
      {isPending && <Skeleton className="h-48 w-full" />}
      {error && <p className="text-destructive">{error.message}</p>}
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          {(["APPOINTMENT", "EVENT"] as const).map((target) => (
            <Card key={target}>
              <CardHeader>
                <CardTitle className="text-base">{target === "APPOINTMENT" ? "Appointment reminders" : "Event reminders"}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {data.filter((r) => r.target === target).length === 0 && <p className="text-sm text-muted-foreground">No reminders.</p>}
                {data
                  .filter((r) => r.target === target)
                  .map((r) => (
                    <RuleRow key={r.id} rule={r} manage={manage} />
                  ))}
                {manage && <AddRule target={target} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-6 max-w-2xl text-sm text-muted-foreground">
        Reminders are planned a few minutes ahead and checked again just before sending: a cancelled or moved booking never gets the old reminder, and a booking made
        after a reminder&apos;s time simply skips it. Customers who opted out of WhatsApp or have no mobile number get the other channels only.
      </p>
    </>
  );
}

function ChannelChecks({ value, onChange, disabled, idPrefix }: { value: Channel[]; onChange: (v: Channel[]) => void; disabled?: boolean; idPrefix: string }) {
  return (
    <div className="flex flex-wrap gap-4">
      {DELIVERABLE_CHANNELS.map((c) => (
        <CheckField
          key={c}
          id={`${idPrefix}-${c}`}
          label={CHANNEL_LABELS[c]}
          checked={value.includes(c)}
          disabled={disabled}
          onCheckedChange={(on) => onChange(on ? [...value, c] : value.filter((x) => x !== c))}
        />
      ))}
    </div>
  );
}

function RuleRow({ rule, manage }: { rule: ReminderRuleDto; manage: boolean }) {
  const update = useUpdateReminderRule();
  const remove = useDeleteReminderRule();
  const save = (body: { channels?: Channel[]; isActive?: boolean }) =>
    update.mutate({ id: rule.id, body }, { onError: (e) => toast.error(errorText(e, "Could not save")) });
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{formatOffset(rule.offsetMinutes)} before</span>
        <div className="flex items-center gap-2">
          <CheckField id={`on-${rule.id}`} label="On" checked={rule.isActive} disabled={!manage || update.isPending} onCheckedChange={(v) => save({ isActive: v })} />
          {manage && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete reminder"
              disabled={remove.isPending}
              onClick={() => {
                if (!window.confirm(`Delete the ${formatOffset(rule.offsetMinutes)} reminder? Scheduled reminders from it will not be sent.`)) return;
                remove.mutate(rule.id, { onSuccess: () => toast.success("Reminder deleted"), onError: (e) => toast.error(errorText(e, "Could not delete")) });
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <ChannelChecks
        idPrefix={rule.id}
        value={rule.channels.filter(deliverable)}
        disabled={!manage || update.isPending}
        onChange={(channels) => (channels.length ? save({ channels }) : toast.error("Keep at least one channel, or turn the reminder off"))}
      />
    </div>
  );
}

function AddRule({ target }: { target: Target }) {
  const create = useCreateReminderRule();
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("days");
  const [channels, setChannels] = useState<Channel[]>(["EMAIL", "WHATSAPP"]);
  const minutes = Number(amount) * (unit === "days" ? 1440 : unit === "hours" ? 60 : 1);
  const valid = Number.isInteger(minutes) && minutes >= 5 && minutes <= 14 * 1440 && channels.length > 0;
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`add-${target}`}>New reminder</Label>
          <Input id={`add-${target}`} type="number" min={1} className="w-20" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
          <SelectTrigger className="w-28" aria-label="Unit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minutes">minutes</SelectItem>
            <SelectItem value="hours">hours</SelectItem>
            <SelectItem value="days">days</SelectItem>
          </SelectContent>
        </Select>
        <span className="pb-2 text-sm text-muted-foreground">before</span>
        <Button
          className="ml-auto"
          disabled={!valid || create.isPending}
          onClick={() =>
            create.mutate(
              { target, offsetMinutes: minutes, channels, isActive: true },
              { onSuccess: () => toast.success("Reminder added"), onError: (e) => toast.error(errorText(e, "Could not add")) },
            )
          }
        >
          Add
        </Button>
      </div>
      <ChannelChecks idPrefix={`new-${target}`} value={channels} onChange={setChannels} />
      {!valid && <p className="text-xs text-muted-foreground">Between 5 minutes and 14 days, with at least one channel.</p>}
    </div>
  );
}
