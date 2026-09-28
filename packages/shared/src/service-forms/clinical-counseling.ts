import { z } from "zod";
import { optionalText, phoneSchema } from "../validation.js";
import { personNameSchema } from "../auth.js";
import { bookingSchema, checklistWithOtherDynamic, deliveryModeField } from "./common.js";

/** Seed data only — the live checklist options are admin-managed per service (see ServiceConcernOption). */
export const CLINICAL_CONCERNS = [
  "ANXIETY",
  "DEPRESSION",
  "TRAUMA",
  "OCD",
  "ADDICTION",
  "RELATIONSHIPS",
  "OTHER",
] as const;
export type ClinicalConcern = (typeof CLINICAL_CONCERNS)[number];
export const CLINICAL_CONCERN_LABELS: Record<ClinicalConcern, string> = {
  ANXIETY: "Anxiety",
  DEPRESSION: "Depression",
  TRAUMA: "Trauma",
  OCD: "OCD",
  ADDICTION: "Addiction",
  RELATIONSHIPS: "Relationships",
  OTHER: "Other",
};

/** This form is not monitored in real time; the web page shows a crisis notice (emergency: 1122). */
export const clinicalCounselingDetailsSchema = z
  .object({
    areasOfConcern: checklistWithOtherDynamic(),
    previousDiagnosis: z.boolean(),
    previousDiagnosisDetails: optionalText(500),
    currentMedication: optionalText(500),
    emergencyContactName: personNameSchema,
    emergencyContactPhone: phoneSchema,
    deliveryMode: deliveryModeField,
  })
  .refine((v) => !v.previousDiagnosis || Boolean(v.previousDiagnosisDetails?.trim()), {
    path: ["previousDiagnosisDetails"],
    message: "Please give a few details",
  });
export type ClinicalCounselingDetailsInput = z.infer<typeof clinicalCounselingDetailsSchema>;

export const clinicalCounselingBookingSchema = bookingSchema("clinical-counseling", clinicalCounselingDetailsSchema);
export type ClinicalCounselingBookingInput = z.infer<typeof clinicalCounselingBookingSchema>;
