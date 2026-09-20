import { describe, expect, it } from "vitest";
import { centsToYuanInput, formatYuan, parseYuanToCents, sumCents } from "@shared/domain";

describe("parseYuanToCents", () => {
  it("parses plain and decimal amounts", () => {
    expect(parseYuanToCents("12")).toBe(1200);
    expect(parseYuanToCents("12.3")).toBe(1230);
    expect(parseYuanToCents("12.34")).toBe(1234);
    expect(parseYuanToCents(" 1,234.50 ")).toBe(123450);
    expect(parseYuanToCents("¥99.99")).toBe(9999);
    expect(parseYuanToCents("0.01")).toBe(1);
  });

  it("rejects invalid input", () => {
    expect(parseYuanToCents("")).toBeNull();
    expect(parseYuanToCents("abc")).toBeNull();
    expect(parseYuanToCents("-5")).toBeNull();
    expect(parseYuanToCents("1.234")).toBeNull();
    expect(parseYuanToCents("1.2.3")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats cents as yuan", () => {
    expect(centsToYuanInput(1234)).toBe("12.34");
    expect(centsToYuanInput(5)).toBe("0.05");
    expect(formatYuan(123456)).toBe("¥1,234.56");
    expect(formatYuan(-123456)).toBe("-¥1,234.56");
    expect(sumCents([100, 200, 1])).toBe(301);
  });
});
