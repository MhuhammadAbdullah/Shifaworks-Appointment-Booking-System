import { describe, expect, it } from "vitest";
import { backoffMs } from "./dispatcher.js";

describe("backoffMs", () => {
  it("doubles per attempt, starting at 1 minute, capped at 60", () => {
    const MIN = 60_000;
    expect(backoffMs(1)).toBe(1 * MIN);
    expect(backoffMs(2)).toBe(2 * MIN);
    expect(backoffMs(3)).toBe(4 * MIN);
    expect(backoffMs(4)).toBe(8 * MIN);
    expect(backoffMs(5)).toBe(16 * MIN);
    expect(backoffMs(10)).toBe(60 * MIN); // capped
  });

  it("never returns a negative delay for attempt 0", () => {
    expect(backoffMs(0)).toBe(60_000);
  });
});
