/**
 * Email notifications (Phase 7): the outbox log, editable templates, and the
 * variable allow-list `render.ts` enforces both when a template is saved and
 * when it is rendered. There is no in-app inbox and no WhatsApp automation —
 * only staff/providers have accounts, and WhatsApp stays a support channel
 * (a "Chat on WhatsApp" button), never sent by the API (docs/ARCHITECTURE.md §0, §7).
 */
import { z } from "zod";
import {
  DELIVERY_STATUSES,
  EMAIL_TEMPLATE_KEYS,
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  type DeliveryStatus,
  type EmailTemplateKey,
  type NotificationAudience,
  type NotificationChannel,
  type NotificationStatus,
} from "./enums.js";
import { emailSchema, multiEnumQuery, paginationQuerySchema } from "./validation.js";

/** Retried after 1, 2, 4, 8 … minutes, capped, until this many attempts (docs/ARCHITECTURE.md §7). */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

/**
 * The variables each template MAY use (validated on save and re-checked on
 * render — an unknown `{{var}}` is a validation error, not a silent blank).
 * One list per key, shared by every audience of that key; a customer
 * template simply never references `link` (there is no customer portal).
 */
export const TEMPLATE_VARIABLES: Record<EmailTemplateKey, readonly string[]> = {
  BOOKING_RECEIVED: [
    "orgName", "customerName", "customerPhone", "customerEmail", "bookingNumber", "serviceName", "providerName",
    "date", "time", "amount", "currency", "source", "paymentInstructions", "paymentMethod", "accountName",
    "accountNumber", "iban", "whatsappNumber", "supportEmail", "link",
  ],
  BOOKING_CONFIRMED: ["orgName", "customerName", "customerPhone", "bookingNumber", "serviceName", "providerName", "date", "time", "amount", "currency", "link", "qrCodeUrl"],
  PAYMENT_REJECTED: ["orgName", "customerName", "bookingNumber", "serviceName", "reason", "paymentInstructions", "whatsappNumber", "supportEmail"],
  BOOKING_CANCELLED: ["orgName", "customerName", "bookingNumber", "serviceName", "providerName", "date", "time", "reason", "link"],
  BOOKING_RESCHEDULED: ["orgName", "customerName", "bookingNumber", "serviceName", "providerName", "date", "time", "link"],
  STAFF_INVITE: ["orgName", "inviteeName", "roleLabel", "email", "password", "loginUrl", "supportEmail"],
};

/** Sample values for template preview and "send test" — one flat pool covering every key's variables. */
export const SAMPLE_TEMPLATE_VALUES: Record<string, string> = {
  orgName: "ShifaWorks",
  customerName: "Ayesha Khan",
  customerPhone: "+923001234567",
  customerEmail: "ayesha@example.com",
  email: "bilal.ahmed@example.com",
  bookingNumber: "APT-2026-000123",
  serviceName: "Hijama Therapy",
  providerName: "Dr. Bilal Ahmed",
  date: "Thu, 12 Mar 2026",
  time: "2:30 PM",
  amount: "3,500.00",
  currency: "PKR",
  source: "Online",
  reason: "Requested by the customer",
  paymentInstructions: "Transfer to the bank account below and send a screenshot on WhatsApp.",
  paymentMethod: "Meezan Bank",
  accountName: "ShifaWorks",
  accountNumber: "0123456789012",
  iban: "PK00MEZN0000000123456789",
  whatsappNumber: "+923001234567",
  supportEmail: "support@shifaworks.com",
  link: "https://booking.shifaworks.com/admin/bookings/00000000-0000-0000-0000-000000000000",
  qrCodeUrl: "https://placehold.co/240x240/934AA6/FFFFFF/png?text=QR",
  inviteeName: "Dr. Bilal Ahmed",
  roleLabel: "Therapist",
  password: "Tr7kMh2pQx9w",
  loginUrl: "https://booking.shifaworks.com/login",
};

// ---------------------------------------------------------------------------
// Outbox / delivery log
// ---------------------------------------------------------------------------

export interface NotificationDto {
  id: string;
  templateKey: EmailTemplateKey;
  audience: NotificationAudience;
  channel: NotificationChannel;
  status: NotificationStatus;
  recipient: { name: string | null; email: string | null; phone: string | null };
  booking: { id: string; bookingNumber: string } | null;
  subject: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface NotificationLogEntryDto {
  id: string;
  attempt: number;
  status: DeliveryStatus;
  provider: string | null;
  error: string | null;
  createdAt: string;
}

export interface NotificationDetailDto extends NotificationDto {
  body: string | null;
  logs: NotificationLogEntryDto[];
}

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  status: multiEnumQuery(NOTIFICATION_STATUSES),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  templateKey: z.enum(EMAIL_TEMPLATE_KEYS).optional(),
  bookingId: z.uuid().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const testNotificationSchema = z.object({
  templateKey: z.enum(EMAIL_TEMPLATE_KEYS),
  audience: z.enum(NOTIFICATION_AUDIENCES),
  to: emailSchema,
});
export type TestNotificationInput = z.infer<typeof testNotificationSchema>;

export interface ChannelStatusDto {
  email: { provider: string; configured: boolean; from: string | null };
  queue: { mode: "bullmq" | "in-process"; redis: boolean };
}

// ---------------------------------------------------------------------------
// Templates (fixed set: one row per key × audience, seeded; edit, don't create/delete)
// ---------------------------------------------------------------------------

export interface EmailTemplateDto {
  id: string;
  key: EmailTemplateKey;
  audience: NotificationAudience;
  name: string;
  subject: string;
  bodyHtml: string;
  isActive: boolean;
  updatedAt: string;
}

export const updateTemplateSchema = z.object({
  subject: z.string().trim().min(1, "Required").max(200).optional(),
  bodyHtml: z.string().trim().min(1, "Required").max(20_000).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const previewTemplateSchema = z.object({
  key: z.enum(EMAIL_TEMPLATE_KEYS),
  subject: z.string().trim().min(1, "Required").max(200),
  bodyHtml: z.string().trim().min(1, "Required").max(20_000),
});
export type PreviewTemplateInput = z.infer<typeof previewTemplateSchema>;

export interface TemplatePreviewDto {
  subject: string | null;
  html: string;
  text: string;
  errors: string[];
}
