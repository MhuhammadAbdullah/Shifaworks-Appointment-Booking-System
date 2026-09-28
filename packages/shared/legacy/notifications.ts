import { z } from "zod";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, type NotificationChannel, type NotificationEvent } from "./enums.js";
import { paginationQuerySchema } from "./validation.js";

// ---------------------------------------------------------------------------
// Enums (mirror the Prisma enums; checked by contracts.test.ts)
// ---------------------------------------------------------------------------

export const NOTIFICATION_STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const WHATSAPP_TEMPLATE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "DISABLED"] as const;
export type WhatsAppTemplateStatus = (typeof WHATSAPP_TEMPLATE_STATUSES)[number];

/** Who a template is written for. */
export const NOTIFICATION_AUDIENCES = ["CUSTOMER", "PROVIDER", "ADMIN"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/** Channels that can actually be delivered today (SMS has an interface but no provider yet). */
export const DELIVERABLE_CHANNELS = ["EMAIL", "WHATSAPP", "IN_APP"] as const satisfies readonly NotificationChannel[];

/** Delivery attempts before a notification is given up on. */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  BOOKING_CREATED: "Booking received",
  BOOKING_CONFIRMED: "Booking confirmed",
  BOOKING_CANCELLED: "Booking cancelled",
  BOOKING_RESCHEDULED: "Appointment rescheduled",
  PAYMENT_RECEIVED: "Payment received",
  PAYMENT_FAILED: "Payment failed",
  APPOINTMENT_REMINDER: "Appointment reminder",
  EVENT_REMINDER: "Event reminder",
  EVENT_TICKET_CREATED: "Event tickets issued",
  APPOINTMENT_COMPLETED: "Appointment completed",
};

// ---------------------------------------------------------------------------
// Template variables: the only names templates may use.
// ---------------------------------------------------------------------------

const COMMON_VARS = ["orgName", "customerName", "bookingNumber", "link"] as const;
const APPOINTMENT_VARS = ["serviceName", "providerName", "date", "time", "location", "meetingUrl", "amount", "currency"] as const;
const EVENT_VARS = ["eventName", "serviceName", "date", "time", "venue", "ticketCount", "ticketNumber", "amount", "currency"] as const;
const PAYMENT_VARS = ["amount", "currency", "paymentNumber", "paymentMethod", "failureReason"] as const;

/** Variables available per event. Booking events work for appointments and events alike. */
export const TEMPLATE_VARIABLES: Record<NotificationEvent, readonly string[]> = {
  BOOKING_CREATED: [...COMMON_VARS, ...new Set([...APPOINTMENT_VARS, ...EVENT_VARS])],
  BOOKING_CONFIRMED: [...COMMON_VARS, ...new Set([...APPOINTMENT_VARS, ...EVENT_VARS])],
  BOOKING_CANCELLED: [...COMMON_VARS, ...new Set([...APPOINTMENT_VARS, ...EVENT_VARS]), "cancellationReason"],
  BOOKING_RESCHEDULED: [...COMMON_VARS, ...APPOINTMENT_VARS],
  APPOINTMENT_REMINDER: [...COMMON_VARS, ...APPOINTMENT_VARS],
  APPOINTMENT_COMPLETED: [...COMMON_VARS, ...APPOINTMENT_VARS],
  EVENT_REMINDER: [...COMMON_VARS, ...EVENT_VARS],
  EVENT_TICKET_CREATED: [...COMMON_VARS, ...EVENT_VARS],
  PAYMENT_RECEIVED: [...COMMON_VARS, ...PAYMENT_VARS],
  PAYMENT_FAILED: [...COMMON_VARS, ...PAYMENT_VARS],
};

/** Example values for previews and test sends. */
export const SAMPLE_TEMPLATE_VALUES: Record<string, string> = {
  orgName: "Wellness Practice",
  customerName: "Ayesha Khan",
  bookingNumber: "APT-2026-000123",
  link: "https://example.com/portal/appointments/123",
  serviceName: "Individual Therapy Session",
  providerName: "Dr. Sara Ahmed",
  date: "Mon, 12 Oct 2026",
  time: "10:00 AM",
  location: "Main Clinic",
  meetingUrl: "",
  amount: "4,500.00",
  currency: "PKR",
  eventName: "Mindfulness Workshop",
  venue: "Community Hall",
  ticketCount: "2",
  ticketNumber: "TKT-2026-000045",
  paymentNumber: "PAY-2026-000077",
  paymentMethod: "JazzCash",
  failureReason: "The payment was declined",
  cancellationReason: "Schedule conflict",
};

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** An in-app notification as the recipient sees it. */
export interface InboxItemDto {
  id: string;
  event: NotificationEvent;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  status: NotificationStatus;
  audience: NotificationAudience | null;
  recipient: { id: string | null; name: string | null; email: string | null; phone: string | null };
  entityType: string | null;
  entityId: string | null;
  title: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface NotificationDetailDto extends NotificationDto {
  body: string | null;
  logs: { id: string; attempt: number; status: string; provider: string | null; error: string | null; createdAt: string }[];
  whatsApp: { providerMessageId: string | null; status: string; deliveredAt: string | null; readAt: string | null; error: string | null } | null;
}

export interface ChannelStatusDto {
  email: { provider: string; configured: boolean; from: string | null };
  whatsapp: { provider: string; configured: boolean; webhookUrl: string };
  queue: { mode: "bullmq" | "in-process"; redis: boolean };
}

export interface NotificationTemplateDto {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  audience: NotificationAudience;
  locale: string;
  name: string;
  subject: string | null;
  body: string;
  isActive: boolean;
  whatsAppTemplate: { id: string; key: string; metaName: string; status: WhatsAppTemplateStatus } | null;
  updatedAt: string;
}

export interface WhatsAppTemplateDto {
  id: string;
  key: string;
  metaName: string;
  language: string;
  category: string;
  variables: string[];
  status: WhatsAppTemplateStatus;
  updatedAt: string;
}

export interface ReminderRuleDto {
  id: string;
  target: "APPOINTMENT" | "EVENT";
  offsetMinutes: number;
  channels: NotificationChannel[];
  isActive: boolean;
}

export interface TemplatePreviewDto {
  subject: string | null;
  body: string;
  /** Plain-text rendering (what WhatsApp / in-app show). */
  text: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const listInboxQuerySchema = paginationQuerySchema.extend({
  unread: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
export type ListInboxQuery = z.infer<typeof listInboxQuerySchema>;

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  event: z.enum(NOTIFICATION_EVENTS).optional(),
  search: z.string().trim().max(120).optional(),
  entityId: z.uuid().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const testNotificationSchema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  to: z.string().trim().min(5).max(200),
  event: z.enum(NOTIFICATION_EVENTS).default("BOOKING_CONFIRMED"),
});
export type TestNotificationInput = z.infer<typeof testNotificationSchema>;

const templateBody = z.string().trim().min(1, "Write the message").max(20_000);
export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    subject: z.string().trim().max(300).nullable().optional(),
    body: templateBody.optional(),
    isActive: z.boolean().optional(),
    whatsAppTemplateId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const createTemplateSchema = z.object({
  event: z.enum(NOTIFICATION_EVENTS),
  channel: z.enum(DELIVERABLE_CHANNELS),
  audience: z.enum(NOTIFICATION_AUDIENCES),
  name: z.string().trim().min(2).max(120),
  subject: z.string().trim().max(300).nullable().optional(),
  body: templateBody,
  whatsAppTemplateId: z.uuid().nullable().optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const previewTemplateSchema = z.object({
  event: z.enum(NOTIFICATION_EVENTS),
  channel: z.enum(NOTIFICATION_CHANNELS),
  subject: z.string().max(300).nullable().optional(),
  body: z.string().max(20_000),
});
export type PreviewTemplateInput = z.infer<typeof previewTemplateSchema>;

const variableName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, "Letters and digits only");
export const whatsAppTemplateSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{2,60}$/, "Lowercase letters, digits and _"),
  metaName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Must match the template name in Meta (lowercase, digits, _)"),
  language: z.string().trim().min(2).max(10).default("en"),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]).default("UTILITY"),
  variables: z.array(variableName).max(20),
  status: z.enum(WHATSAPP_TEMPLATE_STATUSES).default("DRAFT"),
});
export type WhatsAppTemplateInput = z.infer<typeof whatsAppTemplateSchema>;
export const updateWhatsAppTemplateSchema = whatsAppTemplateSchema.omit({ key: true }).partial();
export type UpdateWhatsAppTemplateInput = z.infer<typeof updateWhatsAppTemplateSchema>;

export const reminderRuleSchema = z.object({
  target: z.enum(["APPOINTMENT", "EVENT"]),
  // 5 minutes to 14 days before the start.
  offsetMinutes: z.coerce.number().int().min(5).max(14 * 24 * 60),
  channels: z.array(z.enum(DELIVERABLE_CHANNELS)).min(1).max(3),
  isActive: z.boolean().default(true),
});
export type ReminderRuleInput = z.infer<typeof reminderRuleSchema>;
export const updateReminderRuleSchema = reminderRuleSchema.omit({ target: true }).partial();
export type UpdateReminderRuleInput = z.infer<typeof updateReminderRuleSchema>;
