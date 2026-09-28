import { describe, expect, it } from "vitest";
import {
  createCustomerSchema,
  createServiceSchema,
  moneySchema,
  slugify,
  updateOwnProviderSchema,
  updateServiceSchema,
} from "@booking/shared";
import { sniffImage } from "./files/image-sniff.js";
import { resolveSlug } from "../utils/slug.js";
import { AppError } from "../utils/app-error.js";

describe("sniffImage", () => {
  it("detects JPEG, PNG and WebP by magic bytes", () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe("image/jpeg");
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))?.mime).toBe("image/webp");
  });

  it("rejects HTML/SVG disguised as images and truncated input", () => {
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<!doctype html><script>"))).toBeNull();
    expect(sniffImage(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WAVE"))).toBeNull();
  });
});

describe("slugify / resolveSlug", () => {
  it("produces URL-safe slugs", () => {
    expect(slugify("Hijama & Cupping — Advanced")).toBe("hijama-and-cupping-advanced");
    expect(slugify("  Café Séance  ")).toBe("cafe-seance");
  });

  it("suffixes generated slugs until free", async () => {
    const taken = new Set(["therapy", "therapy-2"]);
    await expect(resolveSlug(undefined, "Therapy", async (s) => taken.has(s))).resolves.toBe("therapy-3");
  });

  it("rejects an explicit slug that is taken", async () => {
    await expect(resolveSlug("therapy", "x", async () => true)).rejects.toBeInstanceOf(AppError);
  });
});

describe("money", () => {
  it("accepts numbers and numeric strings with up to 2 decimals", () => {
    expect(moneySchema.parse("1500")).toBe(1500);
    expect(moneySchema.parse(0.1 + 0.2 - 0.3 + 99.99)).toBeCloseTo(99.99);
  });
  it("rejects negatives and 3-decimal amounts", () => {
    expect(moneySchema.safeParse(-1).success).toBe(false);
    expect(moneySchema.safeParse(10.005).success).toBe(false);
  });
});

describe("service schemas", () => {
  const base = { name: "Therapy Session", durationMinutes: 60, price: 5000 };

  it("accepts a minimal service", () => {
    expect(createServiceSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a discount larger than the price", () => {
    const r = createServiceSchema.safeParse({ ...base, discountAmount: 6000 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["discountAmount"]);
  });
  it("rejects durations under 5 minutes and empty updates", () => {
    expect(createServiceSchema.safeParse({ ...base, durationMinutes: 3 }).success).toBe(false);
    expect(updateServiceSchema.safeParse({}).success).toBe(false);
  });
});

describe("people schemas", () => {
  it("customers need an email or phone, and an email to be invited", () => {
    expect(createCustomerSchema.safeParse({ firstName: "Sara" }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ firstName: "Sara", phone: "+92 300 1234567" }).success).toBe(true);
    expect(createCustomerSchema.safeParse({ firstName: "Sara", phone: "03001234567", sendInvite: true }).success).toBe(false);
  });

  it("rejects a future date of birth", () => {
    const r = createCustomerSchema.safeParse({ firstName: "A", phone: "03001234567", dateOfBirth: "2999-01-01" });
    expect(r.success).toBe(false);
  });

  it("providers cannot set admin-only fields on their own profile", () => {
    const parsed = updateOwnProviderSchema.parse({ bio: "Hello", isBookable: true, status: "ACTIVE" } as never);
    expect(parsed).toEqual({ bio: "Hello" });
  });
});
