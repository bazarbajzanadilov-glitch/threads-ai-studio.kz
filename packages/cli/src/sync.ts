function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export const SYNC_PAGE_SIZE = 90;

export function syncContentPagePath(cursor?: string): string {
  const query = new URLSearchParams({ limit: String(SYNC_PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  return `/api/v1/content?${query}`;
}

function normalizedNullableString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function normalizedInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : value;
}

/** Matches the defaults and media representation used by the API's editable-value comparison. */
export function canonicalSyncValue(value: Record<string, unknown>): Record<string, unknown> {
  const remoteMedia = Array.isArray(value.media)
    ? value.media.map(record).filter((item): item is Record<string, unknown> => item !== undefined)
    : undefined;
  const mediaIds = Array.isArray(value.media_ids)
    ? value.media_ids
    : (remoteMedia ?? []).map((item) => item.id);
  const suppliedAltTexts = Array.isArray(value.alt_texts)
    ? value.alt_texts
    : (remoteMedia ?? []).map((item) => item.alt_text ?? "");
  const altTexts = mediaIds.map((_, index) =>
    typeof suppliedAltTexts[index] === "string" ? suppliedAltTexts[index] : ""
  );

  return {
    account_id: typeof value.account_id === "string" ? value.account_id.trim() : value.account_id,
    format: value.format,
    scheduled_at: normalizedInstant(value.scheduled_at),
    text: typeof value.text === "string" ? value.text.trim() : "",
    topic_tag: normalizedNullableString(value.topic_tag),
    location_id: normalizedNullableString(value.location_id),
    share_to_feed: value.share_to_feed === undefined ? true : Boolean(value.share_to_feed),
    late_policy: value.late_policy ?? "publish_within_window",
    late_window_minutes: value.late_window_minutes ?? 240,
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    media_ids: mediaIds,
    alt_texts: altTexts
  };
}

export function syncValuesEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(canonicalSyncValue(left)) === JSON.stringify(canonicalSyncValue(right));
}
