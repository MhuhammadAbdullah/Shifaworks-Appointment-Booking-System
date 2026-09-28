import { z } from "zod";
import { optionalText } from "../validation.js";
import { bookingSchema, checklistWithOtherDynamic, deliveryModeField } from "./common.js";

/** Seed data only — the live checklist options are admin-managed per service (see ServiceConcernOption). */
export const FAITH_COUNSELING_AREAS = [
  "ANXIETY_STRESS",
  "GRIEF",
  "RELATIONSHIPS",
  "FAMILY",
  "SPIRITUAL_STRUGGLES",
  "SELF_ESTEEM",
  "OTHER",
] as const;
export type FaithCounselingArea = (typeof FAITH_COUNSELING_AREAS)[number];
export const FAITH_COUNSELING_AREA_LABELS: Record<FaithCounselingArea, string> = {
  ANXIETY_STRESS: "Anxiety & stress",
  GRIEF: "Grief",
  RELATIONSHIPS: "Relationships",
  FAMILY: "Family",
  SPIRITUAL_STRUGGLES: "Spiritual struggles",
  SELF_ESTEEM: "Self-esteem",
  OTHER: "Other",
};

export const faithBasedCounselingDetailsSchema = z.object({
  areasOfConcern: checklistWithOtherDynamic(),
  previousCounselling: z.boolean(),
  anythingElse: optionalText(1000),
  deliveryMode: deliveryModeField,
});
export type FaithBasedCounselingDetailsInput = z.infer<typeof faithBasedCounselingDetailsSchema>;

export const faithBasedCounselingBookingSchema = bookingSchema("faith-based-counseling", faithBasedCounselingDetailsSchema);
export type FaithBasedCounselingBookingInput = z.infer<typeof faithBasedCounselingBookingSchema>;
