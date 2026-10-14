import type { ReadonlyURLSearchParams } from "next/navigation";

/**
 * Choices carried into a booking form by a link from the WordPress team page
 * (`/hijama-therapy?provider=<slug>&package=<uuid>&start=<ISO instant>`).
 * Every value is untrusted URL input: anything malformed is dropped, and the
 * API still re-validates provider, package and slot when the form is submitted.
 */
export interface BookingPrefill {
  providerSlug: string | null;
  packageId: string | null;
  startsAt: string | null;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The provider a team-page link named, if the (gender-filtered) list contains them. */
export function matchPreselectedProvider<T extends { slug: string }>(providers: readonly T[] | undefined, slug: string | null): T | null {
  if (!slug || !providers) return null;
  return providers.find((p) => p.slug === slug) ?? null;
}

/** Whether a chosen start time is still among the times the API offers (compared as exact UTC instants). */
export function isSlotOffered(slots: readonly { startsAt: string }[], startsAt: string): boolean {
  return slots.some((s) => s.startsAt === startsAt);
}

/**
 * The calendar day (YYYY-MM-DD) of an instant in an IANA zone. Not `startsAt.slice(0, 10)`: that is the
 * UTC day, which for a 03:00 slot in Asia/Karachi (UTC+5) is the previous day.
 */
export function zonedDate(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startsAt));
}

export function parseBookingPrefill(params: URLSearchParams | ReadonlyURLSearchParams): BookingPrefill {
  const provider = params.get("provider");
  const pkg = params.get("package");
  const start = params.get("start");
  const startMs = start ? Date.parse(start) : NaN;
  return {
    providerSlug: provider && provider.length <= 100 && SLUG.test(provider) ? provider : null,
    packageId: pkg && UUID.test(pkg) ? pkg : null,
    // Normalised to the exact string the slots endpoint returns (UTC, millisecond precision), so it
    // can be compared against offered slots with plain equality.
    startsAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
  };
}
