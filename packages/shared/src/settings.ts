/**
 * Every admin-configurable setting (stored in system_settings as key → JSON).
 * One definition per key: default value, group and description. The seed,
 * the API's typed accessor and the settings page all read this list, so a
 * setting cannot exist in one place and be missing in another.
 *
 * Organisation name, timezone and currency live on the organizations row.
 * Payment details are never hardcoded: they come from here at send time.
 */
import { z } from "zod";
import { emailSchema, phoneSchema, timezoneSchema } from "./validation.js";

export const SETTING_GROUPS = ["support", "payment", "email", "booking", "cancellation", "invoice"] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

interface Def<T> {
  key: string;
  group: SettingGroup;
  default: T;
  description: string;
}

const def = <T>(key: string, group: SettingGroup, dflt: T, description: string): Def<T> => ({ key, group, default: dflt, description });

export const SETTINGS = {
  supportEmail: def("support.email", "support", "", "Support email shown to customers"),
  supportPhone: def("support.phone", "support", "", "Support phone number shown to customers"),
  whatsappNumber: def("support.whatsapp", "support", "", "WhatsApp support number (international format, e.g. +923001234567)"),

  paymentBankName: def("payment.bankName", "payment", "", "Bank name"),
  paymentAccountTitle: def("payment.accountTitle", "payment", "", "Account title"),
  paymentAccountNumber: def("payment.accountNumber", "payment", "", "Account number"),
  paymentIban: def("payment.iban", "payment", "", "IBAN"),
  paymentJazzcash: def("payment.jazzcash", "payment", "", "JazzCash number and account name"),
  paymentEasypaisa: def("payment.easypaisa", "payment", "", "Easypaisa number and account name"),
  paymentInstructions: def(
    "payment.instructions",
    "payment",
    "Please complete your payment using the details below and send your payment screenshot with your booking reference to our support team on WhatsApp.",
    "Instructions shown with the payment details",
  ),

  adminEmails: def<string[]>("email.adminEmails", "email", [], "Addresses that receive new booking requests"),
  emailFromName: def("email.fromName", "email", "ShifaWorks", "Sender name on outgoing emails"),

  defaultDurationMinutes: def("booking.defaultDurationMinutes", "booking", 60, "Default appointment duration for new services and packages"),
  termsUrl: def("booking.termsUrl", "booking", "https://shifaworks.com/terms-conditions", "Terms & Conditions page linked from every form"),
  autoConfirmOnVerify: def("booking.autoConfirmOnVerify", "booking", true, "Verifying a payment confirms the booking immediately"),
  paymentWindowHours: def("booking.paymentWindowHours", "booking", 0, "Cancel unpaid bookings after this many hours (0 = never)"),

  cancellationPolicy: def("cancellation.policy", "cancellation", "", "Cancellation policy text shown in confirmation emails"),
  cancellationCutoffHours: def("cancellation.cutoffHours", "cancellation", 24, "Minimum notice for cancellations, for staff reference"),

  invoiceDefaultDueDays: def("invoice.defaultDueDays", "invoice", 7, "Days until an issued invoice is due"),
  invoiceFooter: def("invoice.footer", "invoice", "Thank you for choosing ShifaWorks.", "Printed at the bottom of invoices"),
} as const;

export type SettingName = keyof typeof SETTINGS;
export type OrgSettings = { -readonly [K in SettingName]: (typeof SETTINGS)[K]["default"] extends string[] ? string[] : (typeof SETTINGS)[K]["default"] extends boolean ? boolean : (typeof SETTINGS)[K]["default"] extends number ? number : string };

export const SETTING_DEFAULTS: OrgSettings = Object.fromEntries(Object.entries(SETTINGS).map(([name, d]) => [name, d.default])) as OrgSettings;

/** One schema per setting, shaped from its default value — new settings need no new validator. */
function schemaForDefault(dflt: unknown) {
  if (Array.isArray(dflt)) return z.array(z.string().trim().min(1).max(300)).max(50);
  if (typeof dflt === "boolean") return z.boolean();
  if (typeof dflt === "number") return z.coerce.number().finite();
  return z.string().trim().max(4000);
}

export const updateSettingsValuesSchema = z.object(
  Object.fromEntries(Object.entries(SETTINGS).map(([name, d]) => [name, schemaForDefault(d.default).optional()])) as unknown as {
    [K in SettingName]: z.ZodOptional<z.ZodType<OrgSettings[K]>>;
  },
);
export type UpdateSettingsValuesInput = z.infer<typeof updateSettingsValuesSchema>;

// ---------------------------------------------------------------------------
// Organization (identity fields, not stored in system_settings)
// ---------------------------------------------------------------------------

export interface OrganizationDto {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  locale: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
}

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(150).optional(),
  timezone: timezoneSchema.optional(),
  currency: z.string().trim().length(3, "3-letter currency code").toUpperCase().optional(),
  locale: z.string().trim().min(2).max(20).optional(),
  email: emailSchema.nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  website: z.union([z.url().max(300), z.literal("")]).nullable().optional(),
  logoFileId: z.uuid().nullable().optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export interface SettingsPageDto {
  organization: OrganizationDto;
  settings: OrgSettings;
}

export const updateSettingsSchema = z.object({
  organization: updateOrganizationSchema.optional(),
  settings: updateSettingsValuesSchema.optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
