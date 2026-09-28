import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./api.js";

/** Reusable field validators shared by API request schemas and web forms. */

export const emailSchema = z.email("Enter a valid email").trim().toLowerCase().max(254);

// E.164-ish: optional +, 7-15 digits; spaces/dashes stripped.
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, "Enter a valid phone number"));

export const timezoneSchema = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone");

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "At least 2 characters")
  .max(80)
  .regex(SLUG_PATTERN, "Lowercase letters, numbers and single hyphens only");

/** "Hijama & Cupping — Advanced" → "hijama-cupping-advanced" */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Money input: accepts number or numeric string, max 2 decimals. */
export const moneySchema = z.coerce
  .number({ error: "Enter an amount" })
  .min(0, "Cannot be negative")
  .max(100_000_000)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "At most 2 decimal places");

export const percentSchema = z.coerce.number().min(0).max(100)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "At most 2 decimal places");

/** Money in responses is a decimal string ("5000.00") to avoid float drift. */
export type MoneyString = string;

export const RECORD_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().trim().max(100).optional(),
});

/** Query-string boolean: "true"/"false"/"1"/"0". */
export const queryBoolean = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

/** Query-string multi-select: "A,B,C" -> ["A","B"] validated against `values`, for status filters that accept more than one value at once. */
export const multiEnumQuery = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === "string" && v ? v.split(",") : v), z.array(z.enum(values)).optional());
