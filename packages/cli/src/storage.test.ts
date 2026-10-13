import { describe, expect, it } from "vitest";
import { summarizeStorage } from "./storage.js";

describe("storage forecast", () => {
  it("deduplicates by sha/size and prices decimal GB above the 10 GB-month allowance", () => {
    const gb = 1_000_000_000;
    const result = summarizeStorage([
      { path: "a.mp4", bytes: 6 * gb, sha256: "a".repeat(64) },
      { path: "copy.mp4", bytes: 6 * gb, sha256: "a".repeat(64) },
      { path: "b.mp4", bytes: 5 * gb, sha256: "b".repeat(64) }
    ]);
    expect(result.input_files).toBe(3);
    expect(result.unique_objects).toBe(2);
    expect(result.duplicate_files).toBe(1);
    expect(result.free_tier_bytes).toBe(10_000_000_000);
    expect(result.extra_gb).toBe(1);
    expect(result.billed_gb).toBe(1);
    expect(result.projected_usd).toBe(0.015);
  });

  it("rounds a fractional overage up to a billed GB for a conservative forecast", () => {
    const result = summarizeStorage([
      { path: "just-over.mp4", bytes: 10_000_000_001, sha256: "a".repeat(64) }
    ]);
    expect(result.extra_gb).toBe(1e-9);
    expect(result.billed_gb).toBe(1);
    expect(result.projected_usd).toBe(0.015);
  });
});
