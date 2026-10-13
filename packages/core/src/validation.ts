import {
  type ContentFormat,
  type ContentInput,
  type ContentPatch,
  type Platform,
  type ScheduleSettings
} from "./types.js";
import { isIsoInstant } from "./time.js";

export class ValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export function contentMediaLimits(_platform: Platform = "threads", _format: ContentFormat = "image"): { min: number; max: number } {
  return { min: 1, max: 1 };
}

export function validateThreadsText(text: unknown): string {
  if (typeof text !== "string") {
    throw new ValidationError(["Text must be a string"]);
  }
  const trimmed = text.trim();
  if (trimmed.length > 500) {
    throw new ValidationError([`Threads text exceeds maximum limit of 500 characters (length: ${trimmed.length})`]);
  }
  return text;
}

export function validateImage(url: unknown, filename: unknown): { url: string; filename: string } {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    throw new ValidationError(["Image URL must be a valid HTTP or HTTPS URL"]);
  }
  if (typeof filename !== "string" || filename.trim().length === 0) {
    throw new ValidationError(["Image filename is required"]);
  }
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext || !["jpg", "jpeg", "png", "webp"].includes(ext)) {
    throw new ValidationError(["Only JPG, PNG, and WebP images are supported"]);
  }
  return { url: url.trim(), filename: filename.trim() };
}

export function validateIsoScheduledAt(value: unknown): string {
  if (typeof value !== "string" || !isIsoInstant(value)) {
    throw new ValidationError(["scheduled_at must be a valid ISO 8601 timestamp with timezone"]);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(["scheduled_at is an invalid date"]);
  }
  return date.toISOString();
}

export function parseContentInput(value: unknown): ContentInput {
  if (!value || typeof value !== "object") {
    throw new ValidationError(["Body must be an object"]);
  }
  const body = value as Record<string, unknown>;
  const issues: string[] = [];

  const text = typeof body.text === "string" ? body.text : "";
  if (text.length > 500) {
    issues.push("Threads text exceeds 500 characters");
  }

  const imageUrl = typeof body.image_url === "string" ? body.image_url.trim() : "";
  const imageFilename = typeof body.image_filename === "string" ? body.image_filename.trim() : "";
  if (!imageUrl) {
    issues.push("image_url is required (Threads strictly supports Text + 1 Image)");
  }
  if (!imageFilename) {
    issues.push("image_filename is required");
  }

  let scheduledAt = "";
  if (typeof body.scheduled_at === "string" && isIsoInstant(body.scheduled_at)) {
    scheduledAt = new Date(body.scheduled_at).toISOString();
  } else {
    issues.push("scheduled_at must be a valid ISO 8601 timestamp with timezone");
  }

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }

  return {
    account_id: typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null,
    text,
    image_url: imageUrl,
    image_filename: imageFilename,
    alt_text: typeof body.alt_text === "string" ? body.alt_text.slice(0, 1000) : null,
    topic_tag: typeof body.topic_tag === "string" ? body.topic_tag.slice(0, 50) : null,
    scheduled_at: scheduledAt
  };
}

export function parseContentPatch(value: unknown): ContentPatch {
  if (!value || typeof value !== "object") {
    throw new ValidationError(["Patch must be an object"]);
  }
  const body = value as Record<string, unknown>;
  const patch: ContentPatch = {};

  if ("account_id" in body) {
    patch.account_id = typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null;
  }
  if ("text" in body) {
    if (typeof body.text !== "string") throw new ValidationError(["text must be a string"]);
    if (body.text.length > 500) throw new ValidationError(["Threads text exceeds 500 characters"]);
    patch.text = body.text;
  }
  if ("image_url" in body) {
    if (typeof body.image_url !== "string" || !body.image_url.trim()) throw new ValidationError(["image_url must be non-empty string"]);
    patch.image_url = body.image_url.trim();
  }
  if ("image_filename" in body) {
    if (typeof body.image_filename !== "string" || !body.image_filename.trim()) throw new ValidationError(["image_filename must be non-empty string"]);
    patch.image_filename = body.image_filename.trim();
  }
  if ("scheduled_at" in body) {
    if (typeof body.scheduled_at !== "string" || !isIsoInstant(body.scheduled_at)) {
      throw new ValidationError(["scheduled_at must be an ISO 8601 timestamp"]);
    }
    patch.scheduled_at = new Date(body.scheduled_at).toISOString();
  }
  if ("alt_text" in body) {
    patch.alt_text = typeof body.alt_text === "string" ? body.alt_text.slice(0, 1000) : null;
  }
  if ("topic_tag" in body) {
    patch.topic_tag = typeof body.topic_tag === "string" ? body.topic_tag.slice(0, 50) : null;
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError(["Patch cannot be empty"]);
  }
  return patch;
}

export function validateScheduleSettings(input: Partial<ScheduleSettings>): void {
  const issues: string[] = [];
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (input.window_start !== undefined && !timeRegex.test(input.window_start)) {
    issues.push("window_start must be in HH:mm format (e.g. 11:00)");
  }
  if (input.window_end !== undefined && !timeRegex.test(input.window_end)) {
    issues.push("window_end must be in HH:mm format (e.g. 21:00)");
  }
  if (input.min_delay_minutes !== undefined && (!Number.isInteger(input.min_delay_minutes) || input.min_delay_minutes < 1)) {
    issues.push("min_delay_minutes must be an integer >= 1");
  }
  if (input.max_delay_minutes !== undefined && (!Number.isInteger(input.max_delay_minutes) || input.max_delay_minutes < 1)) {
    issues.push("max_delay_minutes must be an integer >= 1");
  }
  if (
    input.min_delay_minutes !== undefined &&
    input.max_delay_minutes !== undefined &&
    input.min_delay_minutes > input.max_delay_minutes
  ) {
    issues.push("min_delay_minutes cannot be greater than max_delay_minutes");
  }
  if (issues.length > 0) {
    throw new ValidationError(issues);
  }
}
