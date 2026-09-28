"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChannelStatusDto,
  EmailTemplateDto,
  ListNotificationsQuery,
  NotificationDetailDto,
  NotificationDto,
  PreviewTemplateInput,
  TemplatePreviewDto,
  TestNotificationInput,
  UpdateTemplateInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

/** `status` travels as a comma-separated string on the wire (multi-select) — the server parses it back into ListNotificationsQuery["status"]. */
type NotificationsListQuery = Partial<Omit<ListNotificationsQuery, "status">> & { status?: string };

export const notificationKeys = {
  list: (q: NotificationsListQuery) => ["notifications", "list", q] as const,
  listAll: ["notifications", "list"] as const,
  detail: (id: string) => ["notifications", "detail", id] as const,
  templates: ["notifications", "templates"] as const,
  channelStatus: ["notifications", "channel-status"] as const,
};

export function useNotifications(query: NotificationsListQuery) {
  return useQuery({
    queryKey: notificationKeys.list(query),
    queryFn: ({ signal }) => authedRequest<NotificationDto[]>("/notifications", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useNotification(id: string) {
  return useQuery({
    queryKey: notificationKeys.detail(id),
    queryFn: ({ signal }) => data(authedRequest<NotificationDetailDto>(`/notifications/${id}`, { signal })),
  });
}

export function useRetryNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => data(authedRequest<NotificationDetailDto>(`/notifications/${id}/retry`, { method: "POST" })),
    onSuccess: (n) => {
      qc.setQueryData(notificationKeys.detail(n.id), n);
      void qc.invalidateQueries({ queryKey: notificationKeys.listAll });
    },
  });
}

export function useSendTestNotification() {
  return useMutation({
    mutationFn: (body: TestNotificationInput) => data(authedRequest<NotificationDetailDto>("/notifications/test", { method: "POST", body })),
  });
}

export function useChannelStatus() {
  return useQuery({
    queryKey: notificationKeys.channelStatus,
    queryFn: ({ signal }) => data(authedRequest<ChannelStatusDto>("/notifications/channel-status", { signal })),
  });
}

export function useEmailTemplates() {
  return useQuery({
    queryKey: notificationKeys.templates,
    queryFn: ({ signal }) => data(authedRequest<EmailTemplateDto[]>("/notifications/templates", { signal })),
  });
}

export function useUpdateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateTemplateInput & { id: string }) => data(authedRequest<EmailTemplateDto>(`/notifications/templates/${id}`, { method: "PATCH", body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.templates });
    },
  });
}

export function usePreviewEmailTemplate() {
  return useMutation({
    mutationFn: (body: PreviewTemplateInput) => data(authedRequest<TemplatePreviewDto>("/notifications/templates/preview", { method: "POST", body })),
  });
}

export function useInstallDefaultTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => data(authedRequest<{ created: number; refreshed: number }>("/notifications/templates/install-defaults", { method: "POST" })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.templates });
    },
  });
}
