import { describe, expect, it } from "vitest";
import { D, invoiceStatus, priceLine, sumLines } from "./money.js";

describe("invoiceStatus", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("derives issued / partial / paid / overdue but never touches draft or void", () => {
    expect(invoiceStatus("ISSUED", D(100), D(0), null, now)).toBe("ISSUED");
    expect(invoiceStatus("ISSUED", D(100), D(40), null, now)).toBe("PARTIALLY_PAID");
    expect(invoiceStatus("PARTIALLY_PAID", D(100), D(100), null, now)).toBe("PAID");
    expect(invoiceStatus("ISSUED", D(100), D(40), new Date("2026-10-01T00:00:00Z"), now)).toBe("OVERDUE");
    expect(invoiceStatus("ISSUED", D(100), D(0), new Date("2026-10-10T00:00:00Z"), now)).toBe("ISSUED"); // due today
    expect(invoiceStatus("DRAFT", D(100), D(100), null, now)).toBe("DRAFT");
    expect(invoiceStatus("VOID", D(100), D(0), null, now)).toBe("VOID");
  });
});

describe("priceLine", () => {
  it("applies discount before tax and rounds half-up to paisa", () => {
    const l = priceLine({ quantity: 3, unitPrice: "333.33", discountAmount: "0.99", taxRatePercent: "16" });
    expect(l.gross.toFixed(2)).toBe("999.99");
    expect(l.tax.toFixed(2)).toBe("159.84"); // 999.00 × 16% = 159.84
    expect(l.total.toFixed(2)).toBe("1158.84");
  });

  it("never lets a discount exceed the line and sums exactly", () => {
    const a = priceLine({ quantity: 1, unitPrice: 100, discountAmount: 500 });
    expect(a.total.toFixed(2)).toBe("0.00");
    const t = sumLines([priceLine({ quantity: 1, unitPrice: "0.10" }), priceLine({ quantity: 1, unitPrice: "0.20" })]);
    expect(t.total.toFixed(2)).toBe("0.30"); // not 0.30000000000000004
  });
});
