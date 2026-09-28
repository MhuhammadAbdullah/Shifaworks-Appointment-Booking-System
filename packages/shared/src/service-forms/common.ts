import { z } from "zod";
import { GENDERS } from "../enums.js";
import { emailSchema, optionalText, phoneSchema } from "../validation.js";
import { personNameSchema } from "../auth.js";
import type { ServiceSlug } from "./index.js";

/**
 * Fields shared by every service form's first two steps. Each service then
 * adds its own "Service details" step (see the sibling files) before the
 * shared review step. Nothing here is admin-configurable — this is the one
 * fixed shape per booking, not a form builder.
 */

const isoDate = z.iso.date("Use YYYY-MM-DD");
const notFuture = (v: string) => v <= new Date().toISOString().slice(0, 10);

export const personalDetailsSchema = z.object({
  firstName: personNameSchema,
  lastName: optionalText(80),
  phone: phoneSchema,
  email: emailSchema,
  dateOfBirth: isoDate.refine(notFuture, "Date of birth cannot be in the future").nullable().optional(),
  gender: z.enum(GENDERS, "Select an option"),
});
export type PersonalDetailsInput = z.infer<typeof personalDetailsSchema>;

export const locationDetailsSchema = z.object({
  city: z.string().trim().min(1, "Required").max(100),
  province: optionalText(100),
});
export type LocationDetailsInput = z.infer<typeof locationDetailsSchema>;

// "In person or online" and "preferred language" are asked by every service
// except Hijama Therapy (in-clinic only).
export const DELIVERY_MODES = ["IN_PERSON", "ONLINE"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];
export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = { IN_PERSON: "In person", ONLINE: "Online" };

/** "In person or online" — asked by every service but Hijama, and admin-hideable per service (Service.deliveryModeVisible). */
export const deliveryModeField = z.enum(DELIVERY_MODES, "Select an option").optional();

/** Multi-select with a required free-text answer when "Other" is ticked. */
export function checklistWithOther<const V extends readonly [string, ...string[]]>(values: V) {
  return z
    .object({
      selected: z.array(z.enum(values)).min(1, "Choose at least one"),
      otherDetail: optionalText(200),
    })
    .refine((v) => !(v.selected as readonly string[]).includes("OTHER") || Boolean(v.otherDetail?.trim()), {
      path: ["otherDetail"],
      message: "Please describe",
    });
}

/**
 * Same shape as `checklistWithOther`, but for a checklist whose OPTIONS are
 * admin-managed per service (see ServiceConcernOption) rather than fixed in
 * code — so the codes can't be statically enum-checked here. The API
 * re-validates each selected code against the service's current active
 * options at submission time. "Other" always stays available regardless.
 */
export function checklistWithOtherDynamic() {
  return z
    .object({
      selected: z.array(z.string().trim().min(1)).min(1, "Choose at least one"),
      otherDetail: optionalText(200),
    })
    .refine((v) => !v.selected.includes("OTHER") || Boolean(v.otherDetail?.trim()), {
      path: ["otherDetail"],
      message: "Please describe",
    });
}

export const reviewSchema = z.object({
  termsAccepted: z.boolean().refine((v) => v === true, "You must accept the Terms & Conditions"),
  /** Honeypot: must stay empty. A filled value means the submitter is a bot. */
  website: z.string().max(0).optional(),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

/**
 * Assembles one service's full submission schema:
 * personal + location + provider/package/time + service details + review.
 * `service` is a literal so the API can route the body to the right schema.
 */
export function bookingSchema<S extends ServiceSlug, D extends z.ZodType>(slug: S, details: D) {
  return z.object({
    service: z.literal(slug),
    providerId: z.uuid("Choose a provider"),
    packageId: z.uuid("Choose an option"),
    startsAt: z.iso.datetime({ offset: true, error: "Choose a date and time" }),
    personal: personalDetailsSchema,
    location: locationDetailsSchema,
    details,
    /** Set when the customer attached a payment receipt at submission (POST /public/bookings/receipt first). */
    receiptFileId: z.uuid().optional(),
    ...reviewSchema.shape,
  });
}
