"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChannelStatusDto,
  CreateTemplateInput,
  InboxItemDto,
  ListNotificationsQuery,
  NotificationDetailDto,
  NotificationDto,
  NotificationTemplateDto,
  PreviewTemplateInput,
  ReminderRuleDto,
  ReminderRuleInput,
  TemplatePreviewDto,
  TestNotificationInput,
  UpdateReminderRuleInput,
  UpdateTemplateInput,
  UpdateWhatsAppTemplateInput,
  WhatsAppTemplateDto,
  WhatsAppTemplateInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const notificationKeys = {
  inbox: ["notifications", "inbox"] as const,
  unread: ["notifications", "inbox", "unread"] as const,
  log: ["notifications", "log"] as const,
  templates: ["notifications", "templates"] as const,
  whatsapp: ["notifications", "whatsapp-templates"] as const,
  reminders: ["notifications", "reminders"] as const,
};

// ---- personal inbox ---------------------------------------------------------------

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: ({ signal }) => data(authedRequest<{ count: number }>("/notifications/inbox/unread-count", { signal })).then((r) => r.count),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useInbox(q: { page?: number; pageSize?: number; unread?: boolean }, enabled = true) {
  return useQuery({
    queryKey: [...notificationKeys.inbox, q],
    queryFn: ({ signal }) => authedRequest<InboxItemDto[]>("/notifications/inbox", { query: q as Query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

function useInboxMutation<T>(request: (input: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: request, onSuccess: () => void qc.invalidateQueries({ queryKey: notificationKeys.inbox }) });
}
export const useMarkRead = () => useInboxMutation((id: string) => authedRequest(`/notifications/inbox/${id}/read`, { method: "POST" }));
export const useMarkAllRead = () => useInboxMutation(() => authedRequest("/notifications/inbox/read-all", { method: "POST" }));

// ---- delivery log (staff) ------------------------------------------------------------

export function useNotificationLog(q: Partial<ListNotificationsQuery>) {
  return useQuery({
    queryKey: [...notificationKeys.log, q],
    queryFn: ({ signal }) => authedRequest<NotificationDto[]>("/notifications", { query: q as Query, signal }),
    placeholderData: keepPreviousData,
  });
}
export function useNotification(id: string | null) {
  return useQuery({
    queryKey: [...notificationKeys.log, "one", id],
    queryFn: ({ signal }) => data(authedRequest<NotificationDetailDto>(`/notifications/${id}`, { signal })),
    enabled: Boolean(id),
  });
}
export function useChannelStatus() {
  return useQuery({ queryKey: ["notifications", "channels"], queryFn: ({ signal }) => data(authedRequest<ChannelStatusDto>("/notifications/channels", { signal })) });
}
function useLogMutation<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: request, onSuccess: () => void qc.invalidateQueries({ queryKey: notificationKeys.log }) });
}
export const useRetryNotification = () =>
  useLogMutation((id: string) => data(authedRequest<NotificationDetailDto>(`/notifications/${id}/retry`, { method: "POST" })));
export const useSendTest = () =>
  useLogMutation((body: TestNotificationInput) => data(authedRequest<NotificationDetailDto>("/notifications/test", { method: "POST", body })));

// ---- templates, WhatsApp templates, reminders ------------------------------------------

export function useTemplates() {
  return useQuery({ queryKey: notificationKeys.templates, queryFn: ({ signal }) => data(authedRequest<NotificationTemplateDto[]>("/notification-templates", { signal })) });
}
function useSettingsMutation<T, R>(key: readonly string[], request: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: request, onSuccess: () => void qc.invalidateQueries({ queryKey: key }) });
}
export const useUpdateTemplate = () =>
  useSettingsMutation(notificationKeys.templates, ({ id, body }: { id: string; body: UpdateTemplateInput }) =>
    data(authedRequest<NotificationTemplateDto>(`/notification-templates/${id}`, { method: "PATCH", body })),
  );
export const useCreateTemplate = () =>
  useSettingsMutation(notificationKeys.templates, (body: CreateTemplateInput) => data(authedRequest<NotificationTemplateDto>("/notification-templates", { method: "POST", body })));
export const useInstallDefaults = () =>
  useSettingsMutation(notificationKeys.templates, () =>
    data(authedRequest<{ templates: number; whatsapp: number; refreshed: number }>("/notification-templates/install-defaults", { method: "POST" })),
  );
export const previewTemplate = (body: PreviewTemplateInput) => data(authedRequest<TemplatePreviewDto>("/notification-templates/preview", { method: "POST", body }));

export function useWhatsAppTemplates() {
  return useQuery({ queryKey: notificationKeys.whatsapp, queryFn: ({ signal }) => data(authedRequest<WhatsAppTemplateDto[]>("/whatsapp-templates", { signal })) });
}
export const useCreateWhatsAppTemplate = () =>
  useSettingsMutation(notificationKeys.whatsapp, (body: WhatsAppTemplateInput) => data(authedRequest<WhatsAppTemplateDto>("/whatsapp-templates", { method: "POST", body })));
export const useUpdateWhatsAppTemplate = () =>
  useSettingsMutation(notificationKeys.whatsapp, ({ id, body }: { id: string; body: UpdateWhatsAppTemplateInput }) =>
    data(authedRequest<WhatsAppTemplateDto>(`/whatsapp-templates/${id}`, { method: "PATCH", body })),
  );

export function useReminderRules() {
  return useQuery({ queryKey: notificationKeys.reminders, queryFn: ({ signal }) => data(authedRequest<ReminderRuleDto[]>("/reminder-rules", { signal })) });
}
export const useCreateReminderRule = () =>
  useSettingsMutation(notificationKeys.reminders, (body: ReminderRuleInput) => data(authedRequest<ReminderRuleDto>("/reminder-rules", { method: "POST", body })));
export const useUpdateReminderRule = () =>
  useSettingsMutation(notificationKeys.reminders, ({ id, body }: { id: string; body: UpdateReminderRuleInput }) =>
    data(authedRequest<ReminderRuleDto>(`/reminder-rules/${id}`, { method: "PATCH", body })),
  );
export const useDeleteReminderRule = () =>
  useSettingsMutation(notificationKeys.reminders, (id: string) => authedRequest(`/reminder-rules/${id}`, { method: "DELETE" }));
