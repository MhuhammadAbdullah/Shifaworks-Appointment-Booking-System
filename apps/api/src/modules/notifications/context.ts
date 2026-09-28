/**
 * Loads everything a notification needs about its booking: who receives it
 * and the template variables. Re-run at send time (not cached from when the
 * row was queued), so a same-day dispatch always reflects the current state
 * — e.g. a reschedule's new time, not the one that was true when queued.
 * Recipients come from the booking's own snapshot fields (§3 of the
 * architecture doc), never the possibly-since-changed Customer row: a later
 * booking with the same email must not silently redirect an older one's mail.
 */
import { DateTime } from "luxon";
import { ROLE_LABELS, type EmailTemplateKey, type NotificationAudience, type RoleKey } from "@booking/shared";
import { env } from "../../config/env.js";
import type { DbClient } from "../../lib/prisma.js";
import { getOrgSettings } from "../../lib/settings.js";
import { checkInQrPublicUrl } from "../../lib/qrcode.js";
import { money } from "../../utils/serialize.js";

export interface Recipient {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface NotificationContext {
  organizationId: string;
  orgName: string;
  customer: Recipient | null;
  provider: Recipient | null;
  vars: Record<string, string>;
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

const bookingInclude = {
  organization: { select: { id: true, name: true } },
  appointments: {
    where: { rescheduledTo: null },
    take: 1,
    select: {
      id: true,
      checkInToken: true,
      startsAt: true,
      timezone: true,
      cancellationReason: true,
      provider: { select: { displayName: true, email: true } },
      service: { select: { name: true } },
    },
  },
  payments: { where: { status: "REJECTED" as const }, orderBy: { rejectedAt: "desc" as const }, take: 1, select: { rejectionReason: true } },
} as const;

/**
 * Loads a booking's notification context. Returns null if the booking (or its
 * live appointment) no longer exists. `templateKey` is optional — passed at
 * send time (not at queue time) so the digital-ticket QR is only generated
 * for BOOKING_CONFIRMED, not on every notification.
 */
export async function loadNotificationContext(db: DbClient, bookingId: string, templateKey?: EmailTemplateKey): Promise<NotificationContext | null> {
  const b = await db.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!b) return null;
  const live = b.appointments[0];
  if (!live) return null;
  const settings = await getOrgSettings(b.organizationId);
  const customerName = [b.customerFirstName, b.customerLastName].filter(Boolean).join(" ");
  const when = DateTime.fromJSDate(live.startsAt, { zone: live.timezone });
  const qrCodeUrl = templateKey === "BOOKING_CONFIRMED" ? await checkInQrPublicUrl(b.organizationId, live.id, live.checkInToken) : "";

  return {
    organizationId: b.organizationId,
    orgName: b.organization.name,
    customer: customerName ? { key: "customer", name: customerName, email: b.customerEmail, phone: b.customerPhone } : null,
    provider: live.provider ? { key: "provider", name: live.provider.displayName, email: live.provider.email, phone: null } : null,
    vars: {
      orgName: b.organization.name,
      customerName,
      customerPhone: b.customerPhone ?? "",
      customerEmail: b.customerEmail ?? "",
      bookingNumber: b.bookingNumber,
      serviceName: live.service.name,
      providerName: live.provider?.displayName ?? "",
      date: when.toFormat("ccc, d LLL yyyy"),
      time: when.toFormat("h:mm a"),
      amount: b.totalAmount.isZero() ? "" : money(b.totalAmount),
      currency: b.currency,
      source: titleCase(b.source),
      reason: live.cancellationReason ?? b.payments[0]?.rejectionReason ?? "",
      paymentInstructions: settings.paymentInstructions,
      whatsappNumber: settings.whatsappNumber,
      supportEmail: settings.supportEmail,
      qrCodeUrl,
    },
  };
}

export function recipientsFor(audience: NotificationAudience, ctx: NotificationContext, adminEmails: readonly string[]): Recipient[] {
  switch (audience) {
    case "CUSTOMER":
      return ctx.customer ? [ctx.customer] : [];
    case "PROVIDER":
      return ctx.provider ? [ctx.provider] : [];
    case "ADMIN":
      return adminEmails.map((email) => ({ key: email, name: null, email, phone: null }));
    case "STAFF":
      return []; // STAFF_INVITE rows carry their own recipient directly (queueInviteEmail), not via a booking context
  }
}

// ---------------------------------------------------------------------------
// Account-level messages (STAFF_INVITE) — not about a booking, so this is a
// separate, smaller context loader from loadNotificationContext above.
// ---------------------------------------------------------------------------

export interface InviteContext {
  organizationId: string;
  orgName: string;
  recipient: Recipient;
  vars: Record<string, string>;
}

/** `password` is passed in (read from the stored Notification row at send time) — see the schema comment on `Notification.credential`. */
export async function loadInviteContext(db: DbClient, userId: string, password: string): Promise<InviteContext | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } }, userRoles: { select: { role: { select: { key: true } } }, take: 1 } },
  });
  if (!u || !u.email) return null;
  const settings = await getOrgSettings(u.organizationId);
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
  const roleKey = u.userRoles[0]?.role.key as RoleKey | undefined;

  return {
    organizationId: u.organizationId,
    orgName: u.organization.name,
    recipient: { key: "staff", name, email: u.email, phone: u.phone },
    vars: {
      orgName: u.organization.name,
      inviteeName: name,
      roleLabel: roleKey ? ROLE_LABELS[roleKey] : "",
      email: u.email,
      password,
      loginUrl: absoluteUrl("/login", env.APP_URL),
      supportEmail: settings.supportEmail,
    },
  };
}

export async function adminEmailsFor(organizationId: string): Promise<string[]> {
  const { adminEmails } = await getOrgSettings(organizationId);
  return [...new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/** Absolute URL into the web app for links inside staff/provider messages (never sent to customers — there is no portal). */
export function absoluteUrl(path: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}${path}`;
}
