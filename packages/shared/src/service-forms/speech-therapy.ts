import { z } from "zod";
import { optionalText } from "../validation.js";
import { bookingSchema, checklistWithOther, deliveryModeField } from "./common.js";

export const THERAPY_RECIPIENTS = ["SELF", "CHILD", "OTHER"] as const;
export type TherapyRecipient = (typeof THERAPY_RECIPIENTS)[number];
export const THERAPY_RECIPIENT_LABELS: Record<TherapyRecipient, string> = {
  SELF: "Myself",
  CHILD: "My child",
  OTHER: "Someone else",
};

export const SPEECH_CONCERNS = [
  "STUTTERING",
  "ARTICULATION",
  "LANGUAGE_DELAY",
  "VOICE",
  "SOCIAL_COMMUNICATION",
  "OTHER",
] as const;
export type SpeechConcern = (typeof SPEECH_CONCERNS)[number];
export const SPEECH_CONCERN_LABELS: Record<SpeechConcern, string> = {
  STUTTERING: "Stuttering",
  ARTICULATION: "Articulation / pronunciation",
  LANGUAGE_DELAY: "Language delay",
  VOICE: "Voice",
  SOCIAL_COMMUNICATION: "Social communication",
  OTHER: "Other",
};

export const speechTherapyDetailsSchema = z
  .object({
    forWhom: z.enum(THERAPY_RECIPIENTS, "Select an option"),
    personName: optionalText(80),
    // Not z.coerce: the web input uses valueAsNumber so input and output types match,
    // which keeps every service's booking schema usable with a single form-value type.
    personAge: z.number().int().min(0).max(120).nullable().optional(),
    concerns: checklistWithOther(SPEECH_CONCERNS),
    deliveryMode: deliveryModeField,
  })
  .refine((v) => v.forWhom === "SELF" || Boolean(v.personName?.trim()), {
    path: ["personName"],
    message: "Enter their name",
  })
  .refine((v) => v.forWhom === "SELF" || (v.personAge !== null && v.personAge !== undefined), {
    path: ["personAge"],
    message: "Enter their age",
  });
export type SpeechTherapyDetailsInput = z.infer<typeof speechTherapyDetailsSchema>;

export const speechTherapyBookingSchema = bookingSchema("speech-therapy", speechTherapyDetailsSchema);
export type SpeechTherapyBookingInput = z.infer<typeof speechTherapyBookingSchema>;
