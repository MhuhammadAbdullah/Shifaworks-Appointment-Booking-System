/**
 * The five ShifaWorks services. Each slug is a public URL
 * (booking.shifaworks.com/<slug>) with its own developer-defined form — there
 * is no form builder. Admins can open/close a service and manage its packages
 * and providers, but not add services: a new service needs a new form here.
 *
 * Phase 4 adds one module per service next to this file with its Zod schema
 * (hijamaBookingSchema, speechTherapyBookingSchema, …) and step definitions.
 */
import type { z } from "zod";
import type { ProviderType } from "../enums.js";

export const SERVICE_SLUGS = ["hijama-therapy", "speech-therapy", "islamic-life-coaching", "faith-based-counseling", "clinical-counseling"] as const;
export type ServiceSlug = (typeof SERVICE_SLUGS)[number];

export interface ServiceDefinition {
  slug: ServiceSlug;
  name: string;
  description: string;
  providerType: ProviderType;
  /** Word used in the form for the provider ("therapist" / "counsellor" / "coach"). */
  providerNoun: string;
  /** Word used for the priced options ("package" / "session type"). */
  packageNoun: string;
  defaultDurationMinutes: number;
}

export const SERVICE_DEFINITIONS: Record<ServiceSlug, ServiceDefinition> = {
  "hijama-therapy": {
    slug: "hijama-therapy",
    name: "Hijama Therapy",
    description: "Sunnah-based cupping therapy with trained, gender-matched therapists.",
    providerType: "THERAPIST",
    providerNoun: "therapist",
    packageNoun: "package",
    defaultDurationMinutes: 60,
  },
  "speech-therapy": {
    slug: "speech-therapy",
    name: "Speech Therapy",
    description: "Assessment and therapy for speech, language and communication needs.",
    providerType: "THERAPIST",
    providerNoun: "therapist",
    packageNoun: "session type",
    defaultDurationMinutes: 45,
  },
  "islamic-life-coaching": {
    slug: "islamic-life-coaching",
    name: "Islamic Life Coaching",
    description: "Faith-centred coaching for personal growth, family and purpose.",
    providerType: "COUNSELLOR",
    providerNoun: "coach",
    packageNoun: "session type",
    defaultDurationMinutes: 60,
  },
  "faith-based-counseling": {
    slug: "faith-based-counseling",
    name: "Faith-Based Counseling",
    description: "Counselling that integrates Islamic values with evidence-based practice.",
    providerType: "COUNSELLOR",
    providerNoun: "counsellor",
    packageNoun: "session type",
    defaultDurationMinutes: 60,
  },
  "clinical-counseling": {
    slug: "clinical-counseling",
    name: "Clinical Counseling",
    description: "Professional counselling for mental health concerns with licensed clinicians.",
    providerType: "COUNSELLOR",
    providerNoun: "counsellor",
    packageNoun: "session type",
    defaultDurationMinutes: 60,
  },
};

export function isServiceSlug(value: string): value is ServiceSlug {
  return (SERVICE_SLUGS as readonly string[]).includes(value);
}

/**
 * Which services have an admin-manageable "Areas of concern" style checklist
 * (Services -> admin), and which `details` field of that service's booking
 * schema holds it. Services not listed here have no such field.
 */
export const CONCERN_CHECKLIST_FIELD: Partial<Record<ServiceSlug, string>> = {
  "clinical-counseling": "areasOfConcern",
  "faith-based-counseling": "areasOfConcern",
  "islamic-life-coaching": "coachingAreas",
};

/** Label shown above the checklist on the booking form and in the admin Services page. */
export const CONCERN_CHECKLIST_LABEL: Partial<Record<ServiceSlug, string>> = {
  "clinical-counseling": "Areas of concern",
  "faith-based-counseling": "Areas of concern",
  "islamic-life-coaching": "What would you like coaching on?",
};

// ---------------------------------------------------------------------------
// Per-service booking schemas (Phase 4). Shared step fields live in
// common.ts; each service file adds its own "Service details" step.
// ---------------------------------------------------------------------------

export * from "./common.js";
export * from "./hijama-therapy.js";
export * from "./speech-therapy.js";
export * from "./islamic-life-coaching.js";
export * from "./faith-based-counseling.js";
export * from "./clinical-counseling.js";

import { hijamaBookingSchema, type HijamaBookingInput } from "./hijama-therapy.js";
import { speechTherapyBookingSchema, type SpeechTherapyBookingInput } from "./speech-therapy.js";
import { islamicLifeCoachingBookingSchema, type IslamicLifeCoachingBookingInput } from "./islamic-life-coaching.js";
import { faithBasedCounselingBookingSchema, type FaithBasedCounselingBookingInput } from "./faith-based-counseling.js";
import { clinicalCounselingBookingSchema, type ClinicalCounselingBookingInput } from "./clinical-counseling.js";

/** Picks the right Zod schema for a submission by its `service` slug. */
export const SERVICE_BOOKING_SCHEMAS = {
  "hijama-therapy": hijamaBookingSchema,
  "speech-therapy": speechTherapyBookingSchema,
  "islamic-life-coaching": islamicLifeCoachingBookingSchema,
  "faith-based-counseling": faithBasedCounselingBookingSchema,
  "clinical-counseling": clinicalCounselingBookingSchema,
} as const satisfies Record<ServiceSlug, z.ZodType>;

export type AnyBookingInput =
  | HijamaBookingInput
  | SpeechTherapyBookingInput
  | IslamicLifeCoachingBookingInput
  | FaithBasedCounselingBookingInput
  | ClinicalCounselingBookingInput;
