import { describe, expect, it } from "vitest";
import { centsToInput, centsToYuan, formatMoney, parseYuanToCents } from "./format";

describe("formatMoney", () => {
  it("rounds to whole yuan", () => {
    expect(formatMoney(6_000_000)).toBe("¥60,000");
    expect(formatMoney(123_456)).toBe("¥1,235");
    expect(formatMoney(-123_456)).toBe("-¥1,235");
    expect(formatMoney(0)).toBe("¥0");
    expect(formatMoney(0, { zeroDash: true })).toBe("—");
  });

  it("keeps explicit signs for positive values", () => {
    expect(formatMoney(100, { signed: true })).toBe("+¥1");
    expect(formatMoney(-100, { signed: true })).toBe("-¥1");
  });
});

describe("yuan input parsing", () => {
  it("rounds input to whole yuan and returns cents", () => {
    expect(parseYuanToCents("1,234")).toBe(123_400);
    expect(parseYuanToCents("1234.4")).toBe(123_400);
    expect(parseYuanToCents("1234.5")).toBe(123_500);
    expect(parseYuanToCents("-2.5")).toBe(-300);
  });

  it("rejects empty and invalid input", () => {
    expect(parseYuanToCents("")).toBeNull();
    expect(parseYuanToCents("-")).toBeNull();
    expect(parseYuanToCents("abc")).toBeNull();
  });

  it("formats input values as integers", () => {
    expect(centsToYuan(123_456)).toBe(1235);
    expect(centsToInput(123_456)).toBe("1235");
    expect(centsToInput(-2_250)).toBe("-23");
  });
});
