import type {
  AdminUser,
  DashboardData,
  JitterSlot,
  PostItem,
  ScheduleSettings,
  SystemEvent,
  SystemStatus,
  ThreadsAccount
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number = 500) {
    super(message);
    this.name = "ApiError";
  }
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("admin_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}/${endpoint.replace(/^\//, "")}`;
  const headers = {
    ...getAuthHeader(),
    ...(options.headers ?? {}),
  } as Record<string, string>;

  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? `Сетевая ошибка: ${err.message}` : "Сетевая ошибка", 0);
  }

  if (response.status === 401) {
    localStorage.removeItem("admin_token");
    window.dispatchEvent(new CustomEvent("auth:expired"));
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new ApiError(json.error?.message ?? `Ошибка сервера HTTP ${response.status}`, response.status);
  }

  return json as T;
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<{ token: string; user: AdminUser }> {
    const res = await request<{ token: string; user: AdminUser }>("auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem("admin_token", res.token);
    return res;
  },

  async getMe(): Promise<{ user: AdminUser }> {
    return request<{ user: AdminUser }>("auth/me");
  },

  async logout(): Promise<void> {
    try {
      await request("auth/logout", { method: "POST" });
    } finally {
      localStorage.removeItem("admin_token");
    }
  },

  // Accounts
  async getAccounts(): Promise<ThreadsAccount[]> {
    const res = await request<{ accounts: ThreadsAccount[] }>("accounts");
    return res.accounts;
  },

  async addManualAccount(accessToken: string, username?: string): Promise<ThreadsAccount> {
    const res = await request<{ account: ThreadsAccount }>("accounts/manual", {
      method: "POST",
      body: JSON.stringify({ access_token: accessToken, username }),
    });
    return res.account;
  },

  async toggleAccount(id: string): Promise<ThreadsAccount> {
    const res = await request<{ account: ThreadsAccount }>(`accounts/${id}/toggle`, {
      method: "POST",
    });
    return res.account;
  },

  async refreshAccount(id: string): Promise<{ success: boolean; token_expires_at: string }> {
    return request<{ success: boolean; token_expires_at: string }>(`accounts/${id}/refresh`, {
      method: "POST",
    });
  },

  async deleteAccount(id: string): Promise<void> {
    await request(`accounts/${id}`, { method: "DELETE" });
  },

  async getOAuthStartUrl(): Promise<string> {
    const res = await request<{ authorization_url: string }>("accounts/oauth/start");
    return res.authorization_url;
  },

  // Posts
  async getPosts(params: { status?: string; account_id?: string; limit?: number; offset?: number } = {}): Promise<{ posts: PostItem[]; total: number }> {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.account_id) query.set("account_id", params.account_id);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    return request<{ posts: PostItem[]; total: number }>(`posts?${query.toString()}`);
  },

  async createPost(post: {
    text: string;
    image_filename: string;
    image_url: string;
    account_id?: string | null;
    scheduled_at: string;
    alt_text?: string | null;
    topic_tag?: string | null;
  }): Promise<{ post?: PostItem; posts?: PostItem[] }> {
    return request<{ post?: PostItem; posts?: PostItem[] }>("posts", {
      method: "POST",
      body: JSON.stringify(post),
    });
  },

  async publishPostNow(id: string): Promise<{ success: boolean; permalink: string | null; threadsMediaId: string }> {
    return request<{ success: boolean; permalink: string | null; threadsMediaId: string }>(`posts/${id}/publish-now`, {
      method: "POST",
    });
  },

  async togglePostPause(id: string): Promise<{ status: string }> {
    return request<{ status: string }>(`posts/${id}/toggle-pause`, {
      method: "POST",
    });
  },

  async deletePost(id: string): Promise<void> {
    await request(`posts/${id}`, { method: "DELETE" });
  },

  // Upload image
  async uploadImage(file: File): Promise<{ filename: string; url: string; size_bytes: number; mime_type: string }> {
    const formData = new FormData();
    formData.append("image", file);
    return request<{ filename: string; url: string; size_bytes: number; mime_type: string }>("upload", {
      method: "POST",
      body: formData,
    });
  },

  // Schedule settings & jitter preview
  async getScheduleSettings(): Promise<ScheduleSettings> {
    const res = await request<{ settings: ScheduleSettings }>("schedule/settings");
    return res.settings;
  },

  async updateScheduleSettings(settings: Partial<ScheduleSettings>): Promise<ScheduleSettings> {
    const res = await request<{ settings: ScheduleSettings }>("schedule/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    return res.settings;
  },

  async getSchedulePreview(accountCount?: number): Promise<JitterSlot[]> {
    const res = await request<{ slots: JitterSlot[] }>("schedule/preview", {
      method: "POST",
      body: JSON.stringify({ account_count: accountCount }),
    });
    return res.slots;
  },

  // Logs & History
  async getHistory(): Promise<PostItem[]> {
    const res = await request<{ history: PostItem[] }>("logs/history");
    return res.history;
  },

  async getLogs(params: { level?: string; category?: string; limit?: number } = {}): Promise<SystemEvent[]> {
    const query = new URLSearchParams();
    if (params.level) query.set("level", params.level);
    if (params.category) query.set("category", params.category);
    if (params.limit) query.set("limit", String(params.limit));
    const res = await request<{ events: SystemEvent[] }>(`logs?${query.toString()}`);
    return res.events;
  },

  // System
  async getSystemStatus(): Promise<SystemStatus> {
    const res = await request<{ status: SystemStatus }>("system/status");
    return res.status;
  },

  async getDashboard(): Promise<DashboardData> {
    const res = await request<{ dashboard: DashboardData }>("system/dashboard");
    return res.dashboard;
  },
};
