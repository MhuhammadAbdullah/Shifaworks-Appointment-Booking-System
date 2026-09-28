/**
 * Built-in email templates (Handlebars). Pure data so the seed and the
 * "install missing defaults" admin action share one source. Existing rows
 * are never overwritten once a template has been edited — admins own their
 * wording from that point on.
 */
import type { EmailTemplateKey, NotificationAudience } from "@booking/shared";

export interface DefaultTemplate {
  key: EmailTemplateKey;
  audience: NotificationAudience;
  name: string;
  subject: string;
  bodyHtml: string;
}

const link = (label: string) => `<p><a href="{{link}}">${label}</a></p>`;

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "BOOKING_RECEIVED",
    audience: "CUSTOMER",
    name: "Booking received",
    subject: "We received your booking {{bookingNumber}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>We have received your booking <strong>{{bookingNumber}}</strong> for {{serviceName}}{{#if providerName}} with {{providerName}}{{/if}} on <strong>{{date}} at {{time}}</strong>.</p><p>Your booking is not yet confirmed. {{#if paymentInstructions}}{{paymentInstructions}}{{/if}}</p>{{#if whatsappNumber}}<p>Send your payment screenshot and booking reference on WhatsApp: {{whatsappNumber}}.</p>{{/if}}{{#if supportEmail}}<p>Questions? Email us at {{supportEmail}}.</p>{{/if}}`,
  },
  {
    key: "BOOKING_RECEIVED",
    audience: "ADMIN",
    name: "New booking request (staff copy)",
    subject: "[New booking] {{bookingNumber}}: {{customerName}}",
    bodyHtml: `<p>{{customerName}} ({{customerPhone}}{{#if customerEmail}}, {{customerEmail}}{{/if}}) booked <strong>{{serviceName}}</strong> with {{providerName}} on {{date}} at {{time}}.</p><p>Booking {{bookingNumber}} · {{currency}} {{amount}} · via {{source}}</p>${link("Open this booking")}`,
  },
  {
    key: "BOOKING_CONFIRMED",
    audience: "CUSTOMER",
    name: "Booking confirmed",
    subject: "Booking confirmed: {{serviceName}} on {{date}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Your payment has been verified and your appointment{{#if providerName}} with {{providerName}}{{/if}} on <strong>{{date}} at {{time}}</strong> is confirmed.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:2px solid #934AA6;border-radius:10px;overflow:hidden">
<tr><td style="background:#934AA6;padding:14px 20px;text-align:center">
<span style="color:#FFFFFF;font-size:13px;letter-spacing:1px;text-transform:uppercase;font-weight:bold">Digital Ticket</span>
</td></tr>
<tr><td style="background:#FFFFFF;padding:20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding-bottom:14px;text-align:center">
<span style="display:inline-block;background:#85C141;color:#FFFFFF;font-size:11px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;padding:4px 12px;border-radius:12px">Booking Confirmed</span>
</td></tr>
<tr><td style="text-align:center;padding-bottom:16px">
<div style="font-size:11px;color:#000000;letter-spacing:1px;text-transform:uppercase">Ticket Number</div>
<div style="font-size:22px;font-weight:bold;color:#934AA6;letter-spacing:1px">{{bookingNumber}}</div>
</td></tr>
<tr><td style="border-top:1px dashed #d4d4d8;padding-top:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td width="50%" style="padding:4px 0;font-size:13px;color:#000000;vertical-align:top"><span style="color:#71717a">Guest</span><br><strong>{{customerName}}</strong></td>
<td width="50%" style="padding:4px 0;font-size:13px;color:#000000;vertical-align:top"><span style="color:#71717a">Service</span><br><strong>{{serviceName}}</strong></td>
</tr>
<tr>
<td style="padding:4px 0;font-size:13px;color:#000000;vertical-align:top"><span style="color:#71717a">Provider</span><br><strong>{{providerName}}</strong></td>
<td style="padding:4px 0;font-size:13px;color:#000000;vertical-align:top"><span style="color:#71717a">Amount</span><br><strong>{{currency}} {{amount}}</strong></td>
</tr>
<tr>
<td colspan="2" style="padding:12px 0 4px;font-size:13px;color:#000000"><span style="color:#71717a">Date &amp; time</span><br><strong style="font-size:15px">{{date}} at {{time}}</strong></td>
</tr>
</table>
</td></tr>
{{#if qrCodeUrl}}
<tr><td style="text-align:center;padding-top:18px;border-top:1px dashed #d4d4d8;margin-top:16px">
<img src="{{qrCodeUrl}}" alt="Check-in QR code" width="160" height="160" style="display:block;margin:0 auto 8px;border:1px solid #e4e4e7;border-radius:8px" />
<div style="font-size:11px;color:#71717a">Show this QR code at check-in</div>
</td></tr>
{{/if}}
</table>
</td></tr>
</table>
<p>We look forward to seeing you.</p>`,
  },
  {
    key: "BOOKING_CONFIRMED",
    audience: "PROVIDER",
    name: "Booking confirmed (provider)",
    subject: "Confirmed: {{customerName}} on {{date}}",
    bodyHtml: `<p>{{customerName}} ({{customerPhone}}) is confirmed for {{serviceName}} on <strong>{{date}} at {{time}}</strong>.</p><p>Booking {{bookingNumber}}</p>${link("Open this booking")}`,
  },
  {
    key: "PAYMENT_REJECTED",
    audience: "CUSTOMER",
    name: "Payment not accepted",
    subject: "We could not verify your payment for {{bookingNumber}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>We were unable to verify the payment for your booking <strong>{{bookingNumber}}</strong> ({{serviceName}}).</p>{{#if reason}}<p>Reason: {{reason}}</p>{{/if}}<p>{{#if paymentInstructions}}{{paymentInstructions}}{{/if}}</p>{{#if whatsappNumber}}<p>Send a fresh screenshot on WhatsApp: {{whatsappNumber}}.</p>{{/if}}{{#if supportEmail}}<p>Questions? Email {{supportEmail}}.</p>{{/if}}</p>`,
  },
  {
    key: "BOOKING_CANCELLED",
    audience: "CUSTOMER",
    name: "Booking cancelled",
    subject: "Booking {{bookingNumber}} cancelled",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Your booking <strong>{{bookingNumber}}</strong> for {{serviceName}} on {{date}} at {{time}} has been cancelled.</p>{{#if reason}}<p>Reason: {{reason}}</p>{{/if}}<p>If this is unexpected, please contact us.</p>`,
  },
  {
    key: "BOOKING_CANCELLED",
    audience: "PROVIDER",
    name: "Booking cancelled (provider)",
    subject: "Cancelled: {{customerName}} on {{date}}",
    bodyHtml: `<p>{{customerName}}'s booking {{bookingNumber}} ({{serviceName}}, {{date}} {{time}}) was cancelled.</p>{{#if reason}}<p>Reason: {{reason}}</p>{{/if}}${link("Open this booking")}`,
  },
  {
    key: "BOOKING_RESCHEDULED",
    audience: "CUSTOMER",
    name: "Appointment rescheduled",
    subject: "Your appointment has been rescheduled",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Your {{serviceName}} appointment has moved to <strong>{{date}} at {{time}}</strong>{{#if providerName}} with {{providerName}}{{/if}}.</p><p>Booking number: {{bookingNumber}}</p>`,
  },
  {
    key: "BOOKING_RESCHEDULED",
    audience: "PROVIDER",
    name: "Booking moved (provider)",
    subject: "Rescheduled: {{customerName}}",
    bodyHtml: `<p>{{customerName}}'s {{serviceName}} booking ({{bookingNumber}}) is now on <strong>{{date}} at {{time}}</strong>.</p>${link("Open this booking")}`,
  },
  {
    key: "STAFF_INVITE",
    audience: "STAFF",
    name: "Staff/provider invitation",
    subject: "Your login for {{orgName}}",
    bodyHtml: `<p>Hi {{inviteeName}},</p><p>An account has been created for you on <strong>{{orgName}}</strong>{{#if roleLabel}} as {{roleLabel}}{{/if}} on the ShifaWorks booking system. Sign in with these details:</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e4e4e7;border-radius:8px"><tr><td style="padding:16px 20px"><p style="margin:0 0 8px"><span style="color:#71717a">Email</span><br><strong>{{email}}</strong></p><p style="margin:0"><span style="color:#71717a">Password</span><br><strong>{{password}}</strong></p></td></tr></table><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#934AA6"><a href="{{loginUrl}}" style="display:inline-block;padding:12px 24px;color:#FFFFFF;font-weight:bold;text-decoration:none;border-radius:6px">Sign in</a></td></tr></table><p style="font-size:13px;color:#71717a">For your security, please sign in and change this password as soon as you can.</p>{{#if supportEmail}}<p>Questions? Email us at {{supportEmail}}.</p>{{/if}}`,
  },
];
