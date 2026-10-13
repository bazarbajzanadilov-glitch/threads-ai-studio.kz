import { describe, expect, it } from "vitest";
import {
  acceptedMediaTypes,
  canAddMedia,
  mediaCountProblem,
  usablePublishingAccount,
} from "./content-ui";

describe("threads content form contracts", () => {
  it("uses only active, unexpired accounts for scheduling", () => {
    const base = { is_active: true, status: "active" };
    expect(usablePublishingAccount(base, Date.parse("2026-10-12T00:00:00Z"))).toBe(true);
    expect(usablePublishingAccount({ ...base, status: "expiring", token_expires_at: "2026-10-20T00:00:00Z" }, Date.parse("2026-10-12T00:00:00Z"))).toBe(true);
    expect(usablePublishingAccount({ ...base, status: "revoked" })).toBe(false);
    expect(usablePublishingAccount({ ...base, is_active: false })).toBe(false);
    expect(usablePublishingAccount({ ...base, status: "active", token_expires_at: "2026-10-10T00:00:00Z" }, Date.parse("2026-10-12T00:00:00Z"))).toBe(false);
  });

  it("strictly enforces exactly 1 image (JPG, PNG, WebP) for Threads", () => {
    expect(acceptedMediaTypes("threads", "image")).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(canAddMedia("threads", "image", 0)).toBe(true);
    expect(canAddMedia("threads", "image", 1)).toBe(false);
    expect(mediaCountProblem("threads", "image", 1)).toBeNull();
    expect(mediaCountProblem("threads", "image", 0)).toContain("exactly one image");
    expect(mediaCountProblem("threads", "image", 2)).toContain("exactly one image");
  });
});
