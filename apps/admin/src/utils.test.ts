import { describe, expect, it } from "vitest";
import {
  almatyInputToUtc,
  formatBytes,
  localInputValue,
  truncate,
} from "./utils";

describe("date conversion", () => {
  it("converts an Almaty wall-clock value to UTC without browser timezone assumptions", () => {
    expect(almatyInputToUtc("2026-09-01T10:30")).toBe("2026-09-01T05:30:00.000Z");
  });

  it("round-trips a UTC timestamp through the Almaty input representation", () => {
    const source = "2026-12-12T18:45:00.000Z";
    expect(almatyInputToUtc(localInputValue(source))).toBe(source);
  });
});

describe("display helpers", () => {
  it("formats storage units for the Russian UI", () => {
    expect(formatBytes(10_000_000_000)).toBe("10 ГБ");
    expect(formatBytes(0)).toBe("0 Б");
  });

  it("truncates cleanly after collapsing whitespace", () => {
    expect(truncate("  Один   два   три  ", 12)).toBe("Один два три");
    expect(truncate("Слишком длинная строка", 12)).toBe("Слишком дли…");
  });
});
