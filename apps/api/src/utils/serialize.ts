import type { Prisma } from "../generated/prisma/client.js";

type DecimalLike = Prisma.Decimal | { toFixed(digits: number): string };

/** Decimal → "5000.00". Money never travels as a JS float. */
export function money(value: DecimalLike): string {
  return value.toFixed(2);
}

export function moneyOrNull(value: DecimalLike | null | undefined): string | null {
  return value == null ? null : money(value);
}

/** @db.Date column → "YYYY-MM-DD" (dates are stored at UTC midnight). */
export function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** "YYYY-MM-DD" → Date at UTC midnight for @db.Date columns. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Removes keys whose value is undefined so Prisma leaves those columns untouched. */
export function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
