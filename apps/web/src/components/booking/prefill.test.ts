import { describe, expect, it } from "vitest";
import { isSlotOffered, matchPreselectedProvider, parseBookingPrefill, zonedDate } from "./prefill";

const PKG = "22222222-2222-4222-8222-222222222222";
const parse = (qs: string) => parseBookingPrefill(new URLSearchParams(qs));

describe("parseBookingPrefill", () => {
  it("accepts a complete, well-formed link and normalises the instant", () => {
    const p = parse(`provider=hk-hayyan-marfani&package=${PKG}&start=2026-11-02T04:00:00Z`);
    expect(p).toEqual({ providerSlug: "hk-hayyan-marfani", packageId: PKG, startsAt: "2026-11-02T04:00:00.000Z" });
  });

  it("treats a missing query string as no prefill at all", () => {
    expect(parse("")).toEqual({ providerSlug: null, packageId: null, startsAt: null });
  });

  it("drops each malformed value independently instead of failing the page", () => {
    expect(parse(`provider=Not A Slug&package=${PKG}`)).toMatchObject({ providerSlug: null, packageId: PKG });
    expect(parse("provider=ok-slug&package=not-a-uuid")).toMatchObject({ providerSlug: "ok-slug", packageId: null });
    expect(parse("start=tomorrow")).toMatchObject({ startsAt: null });
    expect(parse("start=")).toMatchObject({ startsAt: null });
  });

  it("rejects slugs that are not lowercase letters, digits and single hyphens", () => {
    for (const bad of ["UPPER", "a_b", "-lead", "trail-", "a--b", "a b", "../etc", "<script>", "a".repeat(101)]) {
      expect(parse(`provider=${encodeURIComponent(bad)}`).providerSlug, bad).toBeNull();
    }
  });

  it("ignores unrelated parameters and takes the first value of a repeated one", () => {
    expect(parse(`foo=bar&provider=first&provider=second&package=${PKG}`)).toMatchObject({ providerSlug: "first", packageId: PKG });
  });
});

describe("matchPreselectedProvider (runs after the visitor picks a gender)", () => {
  const list = [
    { id: "a", slug: "dr-one" },
    { id: "b", slug: "dr-two" },
  ];
  it("finds the linked provider in the gender-filtered list", () => {
    expect(matchPreselectedProvider(list, "dr-two")?.id).toBe("b");
  });
  it("returns null when that provider does not accept this gender (absent from the list)", () => {
    expect(matchPreselectedProvider([{ id: "a", slug: "dr-one" }], "dr-two")).toBeNull();
  });
  it("returns null with no slug, no list yet, or an empty list", () => {
    expect(matchPreselectedProvider(list, null)).toBeNull();
    expect(matchPreselectedProvider(undefined, "dr-one")).toBeNull();
    expect(matchPreselectedProvider([], "dr-one")).toBeNull();
  });
});

describe("isSlotOffered (stale slots)", () => {
  const offered = [{ startsAt: "2026-11-02T04:00:00.000Z" }, { startsAt: "2026-11-02T09:15:00.000Z" }];
  it("is true only for an exact offered instant", () => {
    expect(isSlotOffered(offered, "2026-11-02T04:00:00.000Z")).toBe(true);
  });
  it("is false once someone else took it, or for an off-grid time", () => {
    expect(isSlotOffered(offered.slice(1), "2026-11-02T04:00:00.000Z")).toBe(false);
    expect(isSlotOffered(offered, "2026-11-02T04:05:00.000Z")).toBe(false);
    expect(isSlotOffered([], "2026-11-02T04:00:00.000Z")).toBe(false);
  });
  it("matches a link's start value after normalisation (no milliseconds in the URL)", () => {
    const { startsAt } = parse("start=2026-11-02T04:00:00Z");
    expect(isSlotOffered(offered, startsAt!)).toBe(true);
  });
});

describe("zonedDate (timezone handling)", () => {
  it("uses the clinic's calendar day, not the UTC day, for early-morning slots east of UTC", () => {
    // 02:00 on 3 Nov in Karachi (UTC+5) is 21:00 UTC on 2 Nov
    expect(zonedDate("2026-11-02T21:00:00.000Z", "Asia/Karachi")).toBe("2026-11-03");
    expect("2026-11-02T21:00:00.000Z".slice(0, 10)).toBe("2026-11-02"); // what the old code produced
  });
  it("agrees with UTC when the slot is later in the day", () => {
    expect(zonedDate("2026-11-02T09:15:00.000Z", "Asia/Karachi")).toBe("2026-11-02");
  });
  it("handles zones west of UTC and DST changes", () => {
    expect(zonedDate("2026-11-02T03:00:00.000Z", "America/New_York")).toBe("2026-11-01");
    expect(zonedDate("2026-03-08T07:30:00.000Z", "America/New_York")).toBe("2026-03-08");
  });
});
