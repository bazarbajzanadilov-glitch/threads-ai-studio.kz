import { describe, expect, it } from "vitest";
import {
  base64UrlEncode,
  calculateJitterSlots,
  canTransition,
  contentMediaLimits,
  contentStateCapabilities,
  decryptSecret,
  encryptSecret,
  parseContentInput,
  parseContentPatch,
  sha256Hex,
  timingSafeEqual,
  validateScheduleSettings,
  validateThreadsText,
  validateImage
} from "./index.js";

describe("threads content validation", () => {
  it("normalizes a valid Threads post with text + 1 image", () => {
    const input = parseContentInput({
      text: "Hello Threads from Almaty!",
      image_filename: "photo.jpg",
      image_url: "https://thread.ai-studio.kz/uploads/photo.jpg",
      scheduled_at: "2026-10-12T14:00:00+05:00",
      topic_tag: "tech"
    });
    expect(input.text).toBe("Hello Threads from Almaty!");
    expect(input.image_filename).toBe("photo.jpg");
    expect(input.image_url).toBe("https://thread.ai-studio.kz/uploads/photo.jpg");
    expect(input.scheduled_at).toBe("2026-10-12T09:00:00.000Z");
    expect(input.topic_tag).toBe("tech");
  });

  it("strictly enforces max 500 characters limit for Threads", () => {
    const longText = "a".repeat(501);
    expect(() => validateThreadsText(longText)).toThrow("exceeds maximum limit of 500");
    expect(() => parseContentInput({
      text: longText,
      image_filename: "photo.png",
      image_url: "https://thread.ai-studio.kz/uploads/photo.png",
      scheduled_at: "2026-10-12T14:00:00Z"
    })).toThrow("exceeds 500 characters");

    const validText = "a".repeat(500);
    expect(validateThreadsText(validText)).toBe(validText);
  });

  it("strictly enforces exactly 1 image requirement", () => {
    expect(() => parseContentInput({
      text: "No image",
      scheduled_at: "2026-10-12T14:00:00Z"
    })).toThrow("image_url is required");

    expect(contentMediaLimits("threads", "image")).toEqual({ min: 1, max: 1 });
  });

  it("validates image format and url", () => {
    expect(() => validateImage("not-a-url", "pic.jpg")).toThrow("valid HTTP or HTTPS URL");
    expect(() => validateImage("https://example.com/pic.gif", "pic.gif")).toThrow("Only JPG, PNG, and WebP");
    expect(validateImage("https://example.com/pic.jpg", "pic.jpg")).toEqual({
      url: "https://example.com/pic.jpg",
      filename: "pic.jpg"
    });
  });

  it("rejects invalid timezone or empty patch", () => {
    expect(() => parseContentInput({
      text: "post",
      image_filename: "pic.jpg",
      image_url: "https://example.com/pic.jpg",
      scheduled_at: "invalid-date"
    })).toThrow("scheduled_at");

    expect(() => parseContentPatch({})).toThrow("Patch cannot be empty");
  });
});

describe("jitter and schedule settings", () => {
  it("calculates jitter slots for 10 accounts across window", () => {
    const slots = calculateJitterSlots({
      windowStart: "11:00",
      windowEnd: "21:00",
      minDelayMinutes: 15,
      maxDelayMinutes: 40,
      randomize: false,
      accountCount: 10,
      baseDate: new Date("2026-10-12T00:00:00Z"),
      timezoneOffsetHours: 5
    });

    expect(slots).toHaveLength(10);
    expect(slots[0]?.timeFormatted).toBe("11:00");
    // Verify strictly ascending order
    for (let i = 1; i < slots.length; i++) {
      const prev = Date.parse(slots[i - 1]!.scheduledAt);
      const curr = Date.parse(slots[i]!.scheduledAt);
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("calculates randomized jitter slots within delay bounds", () => {
    const slots = calculateJitterSlots({
      windowStart: "11:00",
      windowEnd: "21:00",
      minDelayMinutes: 15,
      maxDelayMinutes: 40,
      randomize: true,
      accountCount: 5,
      baseDate: new Date("2026-10-12T00:00:00Z"),
      timezoneOffsetHours: 5
    });

    expect(slots).toHaveLength(5);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.delayMinutes).toBeGreaterThanOrEqual(15);
      expect(slots[i]!.delayMinutes).toBeLessThanOrEqual(40);
    }
  });

  it("calculates slots starting from current time within window when requested", () => {
    // 14:30 in Almaty is 09:30 UTC
    const slots = calculateJitterSlots({
      windowStart: "11:00",
      windowEnd: "21:00",
      minDelayMinutes: 15,
      maxDelayMinutes: 30,
      randomize: false,
      accountCount: 3,
      baseDate: new Date("2026-10-12T09:30:00Z"),
      timezoneOffsetHours: 5,
      startFromBaseTime: true
    });

    expect(slots).toHaveLength(3);
    expect(slots[0]?.timeFormatted).toBe("14:30");
    expect(slots[0]?.scheduledAt).toBe("2026-10-12T09:30:00.000Z");
  });

  it("rolls over to next day when start time is after window end", () => {
    // 22:00 in Almaty (17:00 UTC) is after 21:00 window end
    const slots = calculateJitterSlots({
      windowStart: "11:00",
      windowEnd: "21:00",
      minDelayMinutes: 20,
      maxDelayMinutes: 40,
      randomize: false,
      accountCount: 2,
      baseDate: new Date("2026-10-12T17:00:00Z"),
      timezoneOffsetHours: 5,
      startFromBaseTime: true
    });

    expect(slots).toHaveLength(2);
    expect(slots[0]?.timeFormatted).toBe("11:00");
    // Next day: Oct 13 11:00 Almaty (06:00 UTC)
    expect(slots[0]?.scheduledAt).toBe("2026-10-13T06:00:00.000Z");
  });

  it("validates schedule settings", () => {
    expect(() => validateScheduleSettings({ window_start: "25:00" })).toThrow("HH:mm");
    expect(() => validateScheduleSettings({ min_delay_minutes: 50, max_delay_minutes: 20 })).toThrow("cannot be greater");
    expect(() => validateScheduleSettings({
      window_start: "11:00",
      window_end: "21:00",
      min_delay_minutes: 15,
      max_delay_minutes: 40
    })).not.toThrow();
  });
});

describe("state machine and capabilities", () => {
  it("governs Threads post transitions", () => {
    expect(canTransition("draft", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "publishing")).toBe(true);
    expect(canTransition("publishing", "published")).toBe(true);
    expect(canTransition("published", "scheduled")).toBe(false);
  });

  it("evaluates capabilities correctly", () => {
    const scheduledCaps = contentStateCapabilities("scheduled");
    expect(scheduledCaps.canEdit).toBe(true);
    expect(scheduledCaps.canPause).toBe(true);
    expect(scheduledCaps.canPublishNow).toBe(true);

    const publishedCaps = contentStateCapabilities("published");
    expect(publishedCaps.canEdit).toBe(false);
    expect(publishedCaps.canPause).toBe(false);
    expect(publishedCaps.canPublishNow).toBe(false);
  });
});

describe("crypto and secrets", () => {
  const secretKey = base64UrlEncode(new Uint8Array(32).fill(7));

  it("encrypts and decrypts access tokens symmetrically", async () => {
    const token = "TH_ACCESS_TOKEN_ABC123";
    const encrypted = await encryptSecret(token, secretKey);
    expect(encrypted).not.toBe(token);
    const decrypted = await decryptSecret(encrypted, secretKey);
    expect(decrypted).toBe(token);
  });

  it("hashes with sha256Hex and checks timingSafeEqual", async () => {
    const hash = await sha256Hex("hello");
    expect(hash).toHaveLength(64);
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "xyz")).toBe(false);
  });
});
