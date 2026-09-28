import { z } from "zod";

/** Everything an administrator can configure in Admin → Settings. */
export interface SettingsDto {
  organization: {
    name: string;
    slug: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    timezone: string;
    currency: string;
    locale: string;
    logo: { id: string; url: string } | null;
  };
  booking: {
    holdMinutes: number;
    cancellationCutoffHours: number;
    rescheduleCutoffHours: number;
    autoConfirmPaid: boolean;
    maxSlotSearchDays: number;
  };
  notifications: { adminEmails: string[] };
  invoices: { defaultDueDays: number; footer: string };
  updatedAt: string | null;
}

const optionalContact = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const updateOrganizationSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: optionalContact(200).refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email"),
    phone: optionalContact(40),
    website: optionalContact(200).refine((v) => !v || /^https?:\/\/\S+\.\S+/.test(v), "Start with http:// or https://"),
    /** IANA zone, e.g. Asia/Karachi. Verified on the server. */
    timezone: z.string().trim().min(3).max(64).optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. PKR")
      .optional(),
    locale: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "e.g. en-PK")
      .optional(),
    logoFileId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>;

export const updateBookingSettingsSchema = z
  .object({
    holdMinutes: z.coerce.number().int().min(5).max(240).optional(),
    cancellationCutoffHours: z.coerce.number().int().min(0).max(720).optional(),
    rescheduleCutoffHours: z.coerce.number().int().min(0).max(720).optional(),
    autoConfirmPaid: z.boolean().optional(),
    maxSlotSearchDays: z.coerce.number().int().min(7).max(92).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateBookingSettingsInput = z.infer<typeof updateBookingSettingsSchema>;

export const updateNotificationSettingsSchema = z.object({
  adminEmails: z.array(z.string().trim().toLowerCase().pipe(z.email("Enter valid email addresses"))).max(20),
});
export type UpdateNotificationSettingsInput = z.infer<typeof updateNotificationSettingsSchema>;

export const updateInvoiceSettingsSchema = z
  .object({
    defaultDueDays: z.coerce.number().int().min(0).max(365).optional(),
    footer: z.string().trim().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateInvoiceSettingsInput = z.infer<typeof updateInvoiceSettingsSchema>;
