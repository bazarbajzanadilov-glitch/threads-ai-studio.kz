export type Platform = "threads";

export type ContentFormat = "image";

export type ContentState =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "paused"
  | "failed";

export interface ThreadsAccount {
  id: string;
  threads_user_id: string;
  username: string;
  display_name?: string | null;
  profile_picture_url?: string | null;
  status: "active" | "paused" | "expiring" | "revoked";
  is_active: boolean;
  token_expires_at: string | null;
  days_remaining?: number | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostItem {
  id: string;
  account_id: string | null;
  account_username?: string | null;
  account_avatar?: string | null;
  text: string;
  image_filename: string;
  image_url: string;
  alt_text?: string | null;
  topic_tag?: string | null;
  status: ContentState;
  scheduled_at: string;
  published_at?: string | null;
  container_id?: string | null;
  threads_media_id?: string | null;
  permalink?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleSettings {
  window_start: string;
  window_end: string;
  timezone: string;
  min_delay_minutes: number;
  max_delay_minutes: number;
  randomize_delay: boolean | number;
  daily_enabled: boolean | number;
  updated_at: string;
}

export interface JitterSlot {
  index: number;
  scheduledAt: string;
  timeFormatted: string;
  delayMinutes: number;
  account_username?: string;
}

export interface SystemEvent {
  id: number;
  level: "info" | "warn" | "error";
  category: string;
  message: string;
  details_json?: string | null;
  post_id?: string | null;
  account_id?: string | null;
  created_at: string;
}

export interface SystemStatus {
  uptime_seconds: number;
  server_time: string;
  accounts: {
    total: number;
    active: number;
  };
  posts: {
    scheduled: number;
    published: number;
    failed: number;
  };
  storage: {
    used_bytes: number;
    limit_bytes: number;
  };
}

export interface AdminUser {
  email: string;
  role: string;
}

export interface DashboardData {
  uptime_seconds: number;
  server_time: string;
  accounts: {
    total: number;
    active: number;
    list: Array<{
      id: string;
      username: string;
      status: string;
      is_active: number;
      profile_picture_url?: string | null;
      token_expires_at?: string | null;
    }>;
  };
  posts: {
    scheduled: number;
    published_total: number;
    published_today: number;
    failed: number;
  };
  next_post?: PostItem | null;
  recent_published: PostItem[];
  schedule: ScheduleSettings;
  storage: {
    used_bytes: number;
    limit_bytes: number;
  };
}
