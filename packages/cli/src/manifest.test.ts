import { describe, expect, it } from "vitest";
import { validateManifest } from "./manifest.js";

const base = {
  external_id: "sept-001",
  account_id: "account-1",
  platform: "threads",
  format: "reel",
  scheduled_at: "2026-09-01T09:00:00+05:00",
  media_ids: ["asset-1"]
};

describe("validateManifest", () => {
  it("accepts a valid versioned manifest", () => {
    const result = validateManifest({ version: 1, items: [base] });
    expect(result.valid).toBe(true);
    expect(result.manifest?.items).toHaveLength(1);
  });

  it("requires a numeric Meta location ID", () => {
    expect(validateManifest({ version: 1, items: [{ ...base, location_id: "123456" }] }).valid).toBe(true);
    const invalid = validateManifest({ version: 1, items: [{ ...base, location_id: "Almaty" }] });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues).toContainEqual(expect.objectContaining({
      field: "location_id",
      message: expect.stringContaining("numeric Meta location ID")
    }));
  });

  it("rejects local timestamps, duplicate keys, and missing media", () => {
    const result = validateManifest({
      version: 1,
      items: [
        { ...base, scheduled_at: "2026-09-01T09:00:00", media_ids: [] },
        { ...base, media_ids: [] }
      ]
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.message).join(" ")).toMatch(/UTC offset/);
    expect(result.issues.map((entry) => entry.message).join(" ")).toMatch(/requires at least one media/);
  });

  it("does not allow a destructive text/media mismatch", () => {
    const result = validateManifest({
      version: 1,
      items: [{ ...base, platform: "threads", format: "text", media_ids: ["asset-1"] }]
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.field === "media_ids")).toBe(true);
  });

  it("enforces platform carousel limits, single-media formats, and non-empty text", () => {
    const result = validateManifest({
      version: 1,
      items: [
        { ...base, media_ids: ["asset-1", "asset-2"] },
        {
          ...base,
          external_id: "carousel-too-small",
          format: "carousel",
          media_ids: ["asset-1"]
        },
        {
          ...base,
          external_id: "blank-thread",
          platform: "threads",
          format: "text",
          text: "   ",
          media_ids: []
        }
      ]
    });
    expect(result.valid).toBe(false);
    const messages = result.issues.map((entry) => entry.message).join(" ");
    expect(messages).toMatch(/exactly one/);
    expect(messages).toMatch(/between 2 and 20/);
    expect(messages).toMatch(/non-empty text/);
  });

  it("round-trips empty/duplicate alt text and rejects a zero late window", () => {
    const valid = validateManifest({
      version: 1,
      items: [
        {
          ...base,
          external_id: "carousel-alt",
          format: "carousel",
          media_ids: ["asset-1", "asset-2"],
          alt_texts: ["", "same"]
        }
      ]
    });
    expect(valid.valid).toBe(true);
    expect(valid.manifest?.items[0]?.alt_texts).toEqual(["", "same"]);

    const invalid = validateManifest({
      version: 1,
      items: [{ ...base, late_window_minutes: 0 }]
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.some((issue) => issue.field === "late_window_minutes")).toBe(true);
  });

  it("rejects duplicate media IDs and locally enforces backend scalar limits", () => {
    const result = validateManifest({
      version: 1,
      items: [
        {
          ...base,
          external_id: "x".repeat(161),
          account_id: "a".repeat(81),
          platform: "threads",
          text: "t".repeat(501),
          media_ids: ["duplicate", "duplicate"],
          topic_tag: "t".repeat(51),
          location_id: "l".repeat(129),
          share_to_feed: 1,
          enabled: "yes",
          expected_revision: 0
        }
      ]
    });
    expect(result.valid).toBe(false);
    const fields = new Set(result.issues.map((issue) => issue.field));
    for (const field of [
      "external_id",
      "account_id",
      "text",
      "media_ids",
      "topic_tag",
      "location_id",
      "share_to_feed",
      "enabled",
      "expected_revision"
    ]) expect(fields).toContain(field);
  });

  it("rejects non-string text even for media content", () => {
    const result = validateManifest({ version: 1, items: [{ ...base, text: 123 }] });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: "text" }));
  });

  it("detects manifest keys that collide after backend trimming", () => {
    const result = validateManifest({
      version: 1,
      items: [base, { ...base, external_id: ` ${base.external_id} ` }]
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("Duplicate manifest key"))).toBe(true);
  });
});
