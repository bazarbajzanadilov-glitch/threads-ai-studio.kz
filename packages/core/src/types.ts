export const PLATFORMS = ["threads"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CONTENT_FORMATS = ["image"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CONTENT_STATES = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "paused",
  "failed"
] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

export const MEDIA_STATUSES = ["uploaded", "ready", "deleted"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export interface MediaAsset {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  created_at: string;
}

export interface ContentItem {
  id: string;
  account_id: string | null; // null means assigned to all active accounts / pool
  account_username?: string | null;
  platform: Platform;
  format: ContentFormat;
  scheduled_at: string;
  text: string;
  image_filename: string;
  image_url: string;
  alt_text?: string | null;
  topic_tag?: string | null;
  state: ContentState;
  container_id?: string | null;
  threads_media_id?: string | null;
  permalink?: string | null;
  last_error?: string | null;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentInput {
  account_id?: string | null;
  text: string;
  image_filename: string;
  image_url: string;
  alt_text?: string | null;
  topic_tag?: string | null;
  scheduled_at: string;
}

export interface ContentPatch {
  account_id?: string | null;
  text?: string;
  image_filename?: string;
  image_url?: string;
  alt_text?: string | null;
  topic_tag?: string | null;
  scheduled_at?: string;
  state?: ContentState;
}

export interface PlatformAccount {
  id: string;
  platform: Platform;
  threads_user_id: string;
  username: string;
  display_name?: string | null;
  profile_picture_url?: string | null;
  token_expires_at: string | null;
  status: "active" | "paused" | "expiring" | "revoked";
  is_active: boolean;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleSettings {
  window_start: string; // "11:00"
  window_end: string;   // "21:00"
  timezone: string;     // "Asia/Almaty"
  min_delay_minutes: number; // 15
  max_delay_minutes: number; // 40
  randomize_delay: boolean;  // true
  daily_enabled: boolean;    // true
  updated_at: string;
}

export interface SystemLog {
  id: number;
  level: "info" | "warn" | "error";
  category: string;
  message: string;
  details?: Record<string, unknown> | null;
  post_id?: string | null;
  account_id?: string | null;
  created_at: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
