import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type Platform = "threads";
export type ContentFormat = "reel" | "image" | "carousel" | "text" | "video";
export type LatePolicy = "publish_within_window" | "require_attention" | "skip";

export interface ContentInput {
  readonly external_id: string;
  readonly account_id: string;
  readonly platform: Platform;
  readonly format: ContentFormat;
  readonly scheduled_at?: string | null;
  readonly text?: string;
  readonly media_ids?: string[];
  readonly alt_texts?: string[];
  readonly topic_tag?: string | null;
  readonly location_id?: string | null;
  readonly share_to_feed?: boolean;
  readonly late_policy?: LatePolicy;
  readonly late_window_minutes?: number;
  readonly enabled?: boolean;
  readonly expected_revision?: number;
}

export interface ContentManifest {
  readonly version: 1;
  readonly items: readonly ContentInput[];
}

export interface ManifestIssue {
  readonly index?: number;
  readonly field?: string;
  readonly message: string;
}

export interface ManifestValidation {
  readonly valid: boolean;
  readonly manifest?: ContentManifest;
  readonly issues: readonly ManifestIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mediaIdArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return value as string[];
}

function altTextArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((entry) => typeof entry !== "string" || entry.length > 1_000)
  ) {
    return undefined;
  }
  return value as string[];
}

function parseItem(value: unknown, index: number, issues: ManifestIssue[]): ContentInput | undefined {
  if (!isRecord(value)) {
    issues.push({ index, message: "Item must be an object." });
    return undefined;
  }
  const required = ["external_id", "account_id", "platform", "format"] as const;
  for (const field of required) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) {
      issues.push({ index, field, message: `${field} is required.` });
    }
  }
  if (typeof value.external_id === "string" && value.external_id.trim().length > 160) {
    issues.push({ index, field: "external_id", message: "external_id must be at most 160 characters." });
  }
  if (typeof value.account_id === "string" && value.account_id.trim().length > 80) {
    issues.push({ index, field: "account_id", message: "account_id must be at most 80 characters." });
  }
  if (value.platform !== "threads") {
    issues.push({ index, field: "platform", message: "platform must be threads." });
  }
  if (!(["reel", "image", "carousel", "text", "video"] as unknown[]).includes(value.format)) {
    issues.push({ index, field: "format", message: "Unsupported content format." });
  }
  if (value.scheduled_at !== undefined && value.scheduled_at !== null) {
    if (
      typeof value.scheduled_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(value.scheduled_at) ||
      !Number.isFinite(Date.parse(value.scheduled_at))
    ) {
      issues.push({ index, field: "scheduled_at", message: "scheduled_at must be an ISO-8601 instant." });
    } else if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(value.scheduled_at)) {
      issues.push({ index, field: "scheduled_at", message: "scheduled_at must include Z or an explicit UTC offset." });
    }
  }
  const mediaIds = mediaIdArray(value.media_ids);
  if (value.media_ids !== undefined && mediaIds === undefined) {
    issues.push({ index, field: "media_ids", message: "media_ids must contain at most 20 unique non-empty strings." });
  }
  const altTexts = altTextArray(value.alt_texts);
  if (value.alt_texts !== undefined && altTexts === undefined) {
    issues.push({ index, field: "alt_texts", message: "alt_texts must contain at most 20 strings of at most 1000 characters." });
  }
  if (mediaIds && altTexts && altTexts.length > mediaIds.length) {
    issues.push({ index, field: "alt_texts", message: "alt_texts cannot contain more entries than media_ids." });
  }
  if (value.text !== undefined && typeof value.text !== "string") {
    issues.push({ index, field: "text", message: "text must be a string." });
  } else if (typeof value.text === "string") {
    const maximum = 500;
    if (value.text.trim().length > maximum) {
      issues.push({ index, field: "text", message: `threads text must be at most ${maximum} characters.` });
    }
  }
  if (value.format === "text" && (typeof value.text !== "string" || value.text.trim().length === 0)) {
    issues.push({ index, field: "text", message: "Text-only content requires non-empty text." });
  }
  if (value.format === "text" && mediaIds && mediaIds.length > 0) {
    issues.push({ index, field: "media_ids", message: "Text-only content cannot reference media." });
  }
  if (value.format !== "text" && (!mediaIds || mediaIds.length === 0)) {
    issues.push({ index, field: "media_ids", message: "This content format requires at least one media asset." });
  }
  if (["reel", "image", "video"].includes(String(value.format)) && mediaIds && mediaIds.length !== 1) {
    issues.push({ index, field: "media_ids", message: `${String(value.format)} content requires exactly one media asset.` });
  }
  if (value.format === "carousel" && mediaIds) {
    const maximum = 20;
    if (mediaIds.length < 2 || mediaIds.length > maximum) {
      issues.push({
        index,
        field: "media_ids",
        message: `A threads carousel must contain between 2 and ${maximum} media assets.`
      });
    }
  }
  if (value.late_policy !== undefined && !(["publish_within_window", "require_attention", "skip"] as unknown[]).includes(value.late_policy)) {
    issues.push({ index, field: "late_policy", message: "Unsupported late_policy." });
  }
  for (const [field, maximum] of [["topic_tag", 50], ["location_id", 128]] as const) {
    const optional = value[field];
    if (optional !== undefined && optional !== null && typeof optional !== "string") {
      issues.push({ index, field, message: `${field} must be a string or null.` });
    } else if (typeof optional === "string" && optional.trim().length > maximum) {
      issues.push({ index, field, message: `${field} must be at most ${maximum} characters.` });
    }
  }
  if (typeof value.location_id === "string" && value.location_id.trim().length > 0 && !/^\d+$/.test(value.location_id.trim())) {
    issues.push({ index, field: "location_id", message: "location_id must be a numeric Meta location ID." });
  }
  for (const field of ["share_to_feed", "enabled"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      issues.push({ index, field, message: `${field} must be a boolean.` });
    }
  }
  if (
    value.late_window_minutes !== undefined &&
    (typeof value.late_window_minutes !== "number" ||
      !Number.isInteger(value.late_window_minutes) ||
      value.late_window_minutes < 1 ||
      value.late_window_minutes > 10_080)
  ) {
    issues.push({ index, field: "late_window_minutes", message: "late_window_minutes must be an integer between 1 and 10080." });
  }
  if (
    value.expected_revision !== undefined &&
    (typeof value.expected_revision !== "number" ||
      !Number.isSafeInteger(value.expected_revision) ||
      value.expected_revision < 1)
  ) {
    issues.push({ index, field: "expected_revision", message: "expected_revision must be a positive safe integer." });
  }

  const itemIssues = issues.some((entry) => entry.index === index);
  if (itemIssues) return undefined;
  return value as unknown as ContentInput;
}

export function validateManifest(value: unknown): ManifestValidation {
  const issues: ManifestIssue[] = [];
  const root = Array.isArray(value) ? { version: 1, items: value } : value;
  if (!isRecord(root) || root.version !== 1 || !Array.isArray(root.items)) {
    return {
      valid: false,
      issues: [{ message: "Manifest must be {\"version\":1,\"items\":[...]} or an item array." }]
    };
  }
  const items = root.items
    .map((entry, index) => parseItem(entry, index, issues))
    .filter((entry): entry is ContentInput => entry !== undefined);
  const keys = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.platform}:${item.external_id.trim()}`;
    if (keys.has(key)) issues.push({ index, field: "external_id", message: `Duplicate manifest key ${key}.` });
    keys.add(key);
  });
  return {
    valid: issues.length === 0,
    ...(issues.length === 0 ? { manifest: { version: 1, items } } : {}),
    issues
  };
}

export async function loadManifest(path: string): Promise<ManifestValidation> {
  const absolutePath = resolve(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  } catch (error) {
    return { valid: false, issues: [{ message: `Cannot read JSON manifest: ${(error as Error).message}` }] };
  }
  return validateManifest(parsed);
}
