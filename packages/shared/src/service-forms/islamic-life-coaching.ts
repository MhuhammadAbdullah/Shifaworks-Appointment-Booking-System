import { z } from "zod";
import { bookingSchema, checklistWithOtherDynamic, deliveryModeField } from "./common.js";

/** Seed data only — the live checklist options are admin-managed per service (see ServiceConcernOption). */
export const COACHING_AREAS = [
  "PERSONAL_GROWTH",
  "SPIRITUAL_DEVELOPMENT",
  "MARRIAGE_FAMILY",
  "CAREER_PRODUCTIVITY",
  "EMOTIONAL_WELLBEING",
  "OTHER",
] as const;
export type CoachingArea = (typeof COACHING_AREAS)[number];
export const COACHING_AREA_LABELS: Record<CoachingArea, string> = {
  PERSONAL_GROWTH: "Personal growth",
  SPIRITUAL_DEVELOPMENT: "Spiritual development",
  MARRIAGE_FAMILY: "Marriage & family",
  CAREER_PRODUCTIVITY: "Career & productivity",
  EMOTIONAL_WELLBEING: "Emotional wellbeing",
  OTHER: "Other",
};

export const islamicLifeCoachingDetailsSchema = z.object({
  coachingAreas: checklistWithOtherDynamic(),
  goals: z.string().trim().min(10, "Tell us a little more (at least 10 characters)").max(1000),
  deliveryMode: deliveryModeField,
});
export type IslamicLifeCoachingDetailsInput = z.infer<typeof islamicLifeCoachingDetailsSchema>;

export const islamicLifeCoachingBookingSchema = bookingSchema("islamic-life-coaching", islamicLifeCoachingDetailsSchema);
export type IslamicLifeCoachingBookingInput = z.infer<typeof islamicLifeCoachingBookingSchema>;
