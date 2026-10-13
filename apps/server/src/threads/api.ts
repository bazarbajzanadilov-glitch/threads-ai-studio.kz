import {
  THREADS_API_VERSION,
  THREADS_GRAPH_BASE_URL
} from "../config.js";

export interface ThreadsAccountRecord {
  id: string;
  threads_user_id: string;
  username: string;
  display_name?: string | null;
  profile_picture_url?: string | null;
  access_token: string;
  token_expires_at?: string | null;
  status: "active" | "paused" | "expiring" | "revoked";
  is_active: number;
}

export class ThreadsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
    public readonly fbtrace_id?: string
  ) {
    super(message);
    this.name = "ThreadsApiError";
  }
}

async function requestGraph<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${THREADS_GRAPH_BASE_URL}/${THREADS_API_VERSION}/${endpoint.replace(/^\//, "")}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(30_000)
    });
  } catch (err) {
    throw new ThreadsApiError(
      err instanceof Error ? `Network error calling Meta: ${err.message}` : "Network error calling Meta",
      0
    );
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || json.error) {
    const errorMsg = json.error?.message ?? `Meta Threads API returned HTTP ${response.status}`;
    const fbtrace = json.error?.fbtrace_id;
    throw new ThreadsApiError(errorMsg, response.status, fbtrace);
  }

  return json as T;
}

export async function fetchProfile(accessToken: string): Promise<{
  id: string;
  username: string;
  threads_profile_picture_url?: string | null;
}> {
  const url = `${THREADS_GRAPH_BASE_URL}/${THREADS_API_VERSION}/me?fields=id,username,threads_profile_picture_url&access_token=${encodeURIComponent(accessToken)}`;
  return requestGraph(url, { method: "GET" });
}

export async function createMediaContainer(
  accessToken: string,
  post: {
    text: string;
    imageUrl: string;
    altText?: string | null;
    topicTag?: string | null;
  }
): Promise<string> {
  const body = new URLSearchParams({
    media_type: "IMAGE",
    image_url: post.imageUrl,
    text: post.text
  });

  if (post.altText) {
    body.set("alt_text", post.altText);
  }
  if (post.topicTag) {
    body.set("topic_tag", post.topicTag);
  }

  const result = await requestGraph<{ id: string }>("me/threads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!result.id) {
    throw new ThreadsApiError("Meta did not return a container ID");
  }
  return result.id;
}

export async function pollContainerStatus(
  accessToken: string,
  containerId: string,
  maxAttempts = 15,
  intervalMs = 2500
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await requestGraph<{ id: string; status?: string; error_message?: string }>(
      `${containerId}?fields=id,status,error_message`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    const status = (result.status ?? "").toUpperCase();
    if (status === "FINISHED" || status === "READY" || status === "PUBLISHED") {
      return;
    }
    if (status === "ERROR") {
      throw new ThreadsApiError(
        result.error_message ?? "Threads container processing failed"
      );
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  // If timeout, proceed anyway as container may be ready to publish
}

export async function publishContainer(
  accessToken: string,
  containerId: string
): Promise<{ id: string }> {
  const body = new URLSearchParams({
    creation_id: containerId
  });

  const result = await requestGraph<{ id: string }>("me/threads_publish", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!result.id) {
    throw new ThreadsApiError("Meta did not return a thread publication ID");
  }
  return result;
}

export async function getPostPermalink(
  accessToken: string,
  threadsMediaId: string
): Promise<string | null> {
  try {
    const result = await requestGraph<{ id: string; permalink?: string }>(
      `${threadsMediaId}?fields=permalink`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    return result.permalink ?? null;
  } catch (err) {
    console.warn(`Could not fetch permalink for ${threadsMediaId}:`, err);
    return null;
  }
}

export async function refreshLongLivedToken(
  currentAccessToken: string
): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const url = `${THREADS_GRAPH_BASE_URL}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(currentAccessToken)}`;
  return requestGraph(url, { method: "GET" });
}

export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
  appId: string,
  appSecret: string
): Promise<{
  threads_user_id: string;
  username: string;
  profile_picture_url: string | null;
  access_token: string;
  expires_in: number;
}> {
  // 1. Exchange code for short-lived token
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code
  });

  const shortRes = await requestGraph<{ access_token: string; user_id: string }>(
    `${THREADS_GRAPH_BASE_URL}/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    }
  );

  // 2. Exchange short-lived token for long-lived token (60 days)
  const exchangeUrl = `${THREADS_GRAPH_BASE_URL}/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(shortRes.access_token)}`;
  const longRes = await requestGraph<{ access_token: string; expires_in: number }>(exchangeUrl, {
    method: "GET"
  });

  // 3. Fetch profile
  const profile = await fetchProfile(longRes.access_token);

  return {
    threads_user_id: String(profile.id || shortRes.user_id),
    username: profile.username,
    profile_picture_url: profile.threads_profile_picture_url ?? null,
    access_token: longRes.access_token,
    expires_in: longRes.expires_in ?? 5184000 // 60 days in seconds
  };
}
