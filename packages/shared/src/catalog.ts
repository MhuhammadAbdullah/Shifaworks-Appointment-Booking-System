import { z } from "zod";
import { GENDERS, PROVIDER_TYPES, type Gender, type ProviderType, type UserStatus } from "./enums.js";
import { passwordSchema } from "./auth.js";
import {
  emailSchema,
  moneySchema,
  optionalText,
  paginationQuerySchema,
  percentSchema,
  phoneSchema,
  queryBoolean,
  slugSchema,
  timezoneSchema,
  type MoneyString,
} from "./validation.js";

// ---------------------------------------------------------------------------
// Services (the fixed five; admins open/close them and tune timing, but never
// create or delete them — each one has a developer-defined booking form)
// ---------------------------------------------------------------------------

export interface PackageDto {
  id: string;
  serviceId: string;
  name: string;
  description: string | null;
  points: number | null;
  /** null => the service's default duration */
  durationMinutes: number | null;
  effectiveDurationMinutes: number;
  price: MoneyString;
  discountEnabled: boolean;
  discountPercent: number | null;
  /** price after the discount, or == price when no discount applies */
  discountedPrice: MoneyString;
  isActive: boolean;
  sortOrder: number;
}

export interface ServiceProviderSummary {
  id: string;
  displayName: string;
  providerType: ProviderType;
  gender: Gender;
  isActive: boolean;
  /** link active on this service */
  linkActive: boolean;
}

export interface ConcernOptionDto {
  id: string;
  serviceId: string;
  code: string;
  label: string;
  isActive: boolean;
  sortOrder: number;
}

export interface ServiceDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
  bookingEnabled: boolean;
  /** The public form accepts bookings only when both flags are on. */
  open: boolean;
  /** Whether the "In person or online" question shows on this service's form. Meaningless for services with no such field (e.g. Hijama Therapy). */
  deliveryModeVisible: boolean;
  providerType: ProviderType | null;
  defaultDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIntervalMinutes: number | null;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  currency: string;
  sortOrder: number;
  packages: PackageDto[];
  providers: ServiceProviderSummary[];
  concernOptions: ConcernOptionDto[];
}

const minutes = (max: number) => z.coerce.number().int().min(0).max(max);

export const updateServiceSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: optionalText(2000),
    isActive: z.boolean(),
    bookingEnabled: z.boolean(),
    deliveryModeVisible: z.boolean(),
    defaultDurationMinutes: z.coerce.number().int().min(5, "At least 5 minutes").max(8 * 60),
    bufferBeforeMinutes: minutes(240),
    bufferAfterMinutes: minutes(240),
    slotIntervalMinutes: z.coerce.number().int().min(5).max(8 * 60).nullable(),
    minNoticeMinutes: minutes(60 * 24 * 30),
    maxAdvanceDays: z.coerce.number().int().min(1).max(365),
    sortOrder: z.coerce.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

const packageFields = {
  name: z.string().trim().min(2, "Required").max(120),
  description: optionalText(1000),
  points: z.coerce.number().int().min(1).max(100).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(8 * 60).nullable().optional(),
  price: moneySchema,
  discountEnabled: z.boolean().optional(),
  discountPercent: percentSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
};
export const createPackageSchema = z.object(packageFields);
export type CreatePackageInput = z.infer<typeof createPackageSchema>;
export const updatePackageSchema = z
  .object(packageFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;

export const setServiceProvidersSchema = z.object({
  providers: z.array(z.object({ providerId: z.uuid(), isActive: z.boolean().default(true) })).max(100),
});
export type SetServiceProvidersInput = z.infer<typeof setServiceProvidersSchema>;

// "Areas of concern" style checklist options (clinical/faith-based counseling, life coaching) --------

const concernOptionFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,49}$/, "Use CAPS_WITH_UNDERSCORES, letters/numbers only")
    .refine((v) => v !== "OTHER", { message: `"OTHER" is reserved` }),
  label: z.string().trim().min(1, "Required").max(120),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
};
export const createConcernOptionSchema = z.object(concernOptionFields);
export type CreateConcernOptionInput = z.infer<typeof createConcernOptionSchema>;
export const updateConcernOptionSchema = z
  .object(concernOptionFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateConcernOptionInput = z.infer<typeof updateConcernOptionSchema>;

// ---------------------------------------------------------------------------
// Providers (therapists & counsellors)
// ---------------------------------------------------------------------------

export interface ProviderDto {
  id: string;
  providerType: ProviderType;
  slug: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  gender: Gender;
  designation: string | null;
  bio: string | null;
  profileImageId: string | null;
  profileImageUrl: string | null;
  experienceYears: number;
  /** "4.8" or null */
  rating: string | null;
  specializations: string[];
  acceptsMale: boolean;
  acceptsFemale: boolean;
  timezone: string | null;
  calendarColor: string | null;
  isActive: boolean;
  sortOrder: number;
  services: { id: string; slug: string; name: string; linkActive: boolean }[];
  /** The dashboard login, once invited. */
  account: { userId: string; email: string | null; status: UserStatus; hasLogin: boolean } | null;
}

const tagList = z.array(z.string().trim().min(1).max(80)).max(30);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2563eb");
const ratingSchema = z.coerce
  .number()
  .min(0)
  .max(5)
  .refine((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-6, "One decimal place");

/** Fields a provider may edit on their own profile (the public card). */
const ownProviderFields = {
  designation: optionalText(120),
  bio: optionalText(3000),
  specializations: tagList.optional(),
  profileImageId: z.uuid().nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  calendarColor: hexColor.nullable().optional(),
};

const acceptsSomeone = (v: { acceptsMale?: boolean | undefined; acceptsFemale?: boolean | undefined }) =>
  v.acceptsMale !== false || v.acceptsFemale !== false;
const acceptsMessage = { path: ["acceptsFemale"], message: "Accept at least one gender" };

const adminProviderFields = {
  ...ownProviderFields,
  displayName: z.string().trim().min(2, "Required").max(120),
  slug: slugSchema.optional(),
  email: emailSchema.nullable().optional(),
  gender: z.enum(GENDERS),
  experienceYears: z.coerce.number().int().min(0).max(80).optional(),
  rating: ratingSchema.nullable().optional(),
  acceptsMale: z.boolean().optional(),
  acceptsFemale: z.boolean().optional(),
  timezone: timezoneSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
};

export const createProviderSchema = z
  .object({ ...adminProviderFields, providerType: z.enum(PROVIDER_TYPES), serviceIds: z.array(z.uuid()).max(20).optional() })
  .refine(acceptsSomeone, acceptsMessage);
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderSchema = z
  .object(adminProviderFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")
  .refine(acceptsSomeone, acceptsMessage);
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

export const updateOwnProviderSchema = z
  .object(ownProviderFields)
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateOwnProviderInput = z.infer<typeof updateOwnProviderSchema>;

export const setProviderServicesSchema = z.object({ serviceIds: z.array(z.uuid()).max(20) });
export type SetProviderServicesInput = z.infer<typeof setProviderServicesSchema>;

/**
 * Creates (or re-sends) the provider's dashboard login. `password` is only
 * used the first time (an existing login gets a fresh system-generated one
 * on resend, emailed to them — see users.service.ts::sendInvite).
 */
export const inviteProviderSchema = z.object({
  /** Defaults to the provider's email. */
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
});
export type InviteProviderInput = z.infer<typeof inviteProviderSchema>;

export const listProvidersQuerySchema = paginationQuerySchema.extend({
  type: z.enum(PROVIDER_TYPES).optional(),
  active: queryBoolean.optional(),
  serviceId: z.uuid().optional(),
  /** Only providers who accept customers of this gender (backend filtering). */
  gender: z.enum(GENDERS).optional(),
});
export type ListProvidersQuery = z.infer<typeof listProvidersQuerySchema>;

/** Which providers may serve a customer of this gender. */
export function providerAcceptsGender(p: { acceptsMale: boolean; acceptsFemale: boolean }, gender: Gender): boolean {
  return gender === "MALE" ? p.acceptsMale : p.acceptsFemale;
}

// ---------------------------------------------------------------------------
// Files (public images: provider photos)
// ---------------------------------------------------------------------------

export interface FileDto {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_MB = 5;
