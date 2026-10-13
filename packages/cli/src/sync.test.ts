import { describe, expect, it } from "vitest";
import { canonicalSyncValue, syncContentPagePath, syncValuesEqual } from "./sync.js";

const local = {
  external_id: "thread-1",
  account_id: "account",
  platform: "threads",
  format: "video",
  scheduled_at: "2026-09-01T10:00:00+05:00",
  media_ids: ["media-1"],
  alt_texts: ["First"]
};

const remote = {
  ...local,
  scheduled_at: "2026-09-01T05:00:00.000Z",
  text: "",
  topic_tag: null,
  location_id: null,
  share_to_feed: true,
  late_policy: "publish_within_window",
  late_window_minutes: 240,
  enabled: true,
  media_ids: undefined,
  alt_texts: undefined,
  media: [{ id: "media-1", alt_text: "First" }]
};

describe("sync canonical values", () => {
  it("uses a content page size accepted by the Free-Worker API", () => {
    expect(syncContentPagePath()).toBe("/api/v1/content?limit=90");
    expect(syncContentPagePath("next/cursor")).toBe("/api/v1/content?limit=90&cursor=next%2Fcursor");
  });

  it("treats omitted local defaults and equivalent timestamp offsets as unchanged", () => {
    expect(syncValuesEqual(local, remote)).toBe(true);
  });

  it("detects a media-only change", () => {
    expect(syncValuesEqual({ ...local, media_ids: ["media-2"] }, remote)).toBe(false);
  });

  it("detects an alt-text-only change", () => {
    expect(syncValuesEqual({ ...local, alt_texts: ["Updated"] }, remote)).toBe(false);
  });

  it("pads omitted alt text exactly like the API", () => {
    expect(canonicalSyncValue({ ...local, media_ids: ["one", "two"], alt_texts: ["One"] })).toMatchObject({
      media_ids: ["one", "two"],
      alt_texts: ["One", ""]
    });
  });
});
