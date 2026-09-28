import { describe, expect, it } from "vitest";
import { TemplateError, emailLayout, htmlToText, renderTemplate, validateTemplate } from "./render.js";

describe("validateTemplate", () => {
  it("accepts known variables and {{#if}}/{{#unless}}", () => {
    expect(validateTemplate("Hi {{customerName}}, {{#if providerName}}with {{providerName}}{{/if}}.", "BOOKING_CONFIRMED")).toEqual([]);
  });

  it("rejects an unknown variable", () => {
    expect(validateTemplate("{{totallyUnknown}}", "BOOKING_CONFIRMED")).toEqual(["Unknown variable {{totallyUnknown}}"]);
  });

  it("rejects raw (unescaped) output", () => {
    expect(validateTemplate("{{{customerName}}}", "BOOKING_CONFIRMED")).toEqual(["Raw output ({{{ }}}) is not allowed; use {{ }}"]);
  });

  it("rejects helpers other than if/unless", () => {
    expect(validateTemplate("{{#each items}}{{/each}}", "BOOKING_CONFIRMED")).toEqual(["Only {{#if}} and {{#unless}} blocks are supported (found {{#each}})"]);
  });

  it("rejects a variable that belongs to a different template key", () => {
    // "reason" is valid on BOOKING_CANCELLED but not on BOOKING_RECEIVED.
    expect(validateTemplate("{{reason}}", "BOOKING_RECEIVED")).toEqual(["Unknown variable {{reason}}"]);
    expect(validateTemplate("{{reason}}", "BOOKING_CANCELLED")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("fills a variable that was not supplied with an empty string, not a literal {{var}}", () => {
    const out = renderTemplate("Hi {{customerName}}, reason: {{reason}}.", "BOOKING_CANCELLED", { customerName: "Ahmed" }, "html");
    expect(out).toBe("Hi Ahmed, reason: .");
  });

  it("escapes HTML in a value", () => {
    const out = renderTemplate("Hi {{customerName}}", "BOOKING_CONFIRMED", { customerName: "<script>alert(1)</script>" }, "html");
    expect(out).toBe("Hi &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not escape in text mode (used for the subject line)", () => {
    const out = renderTemplate("Booking {{bookingNumber}}", "BOOKING_CONFIRMED", { bookingNumber: "APT & CO" }, "text");
    expect(out).toBe("Booking APT & CO");
  });

  it("throws TemplateError for an unsafe template instead of rendering it", () => {
    expect(() => renderTemplate("{{{customerName}}}", "BOOKING_CONFIRMED", {}, "html")).toThrow(TemplateError);
  });
});

describe("htmlToText", () => {
  it("converts links, breaks and entities to plain text", () => {
    const html = `<p>Hi Ahmed,</p><p>See <a href="https://example.com/x">your booking</a>.</p>`;
    expect(htmlToText(html)).toBe("Hi Ahmed,\nSee your booking (https://example.com/x).");
  });
});

describe("emailLayout", () => {
  it("escapes the organisation name and wraps the body", () => {
    const html = emailLayout("Shifa & Works", "<p>Hello</p>");
    expect(html).toContain("Shifa &amp; Works");
    expect(html).toContain("<p>Hello</p>");
  });
});
