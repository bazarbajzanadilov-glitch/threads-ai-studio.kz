import { getDb, logEvent } from "../db/index.js";
import {
  createMediaContainer,
  getPostPermalink,
  pollContainerStatus,
  publishContainer,
  type ThreadsAccountRecord
} from "../threads/api.js";

export interface PostRecord {
  id: string;
  account_id: string | null;
  text: string;
  image_filename: string;
  image_url: string;
  alt_text?: string | null;
  topic_tag?: string | null;
  status: "draft" | "scheduled" | "publishing" | "published" | "paused" | "failed";
  scheduled_at: string;
  published_at?: string | null;
  container_id?: string | null;
  threads_media_id?: string | null;
  permalink?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export async function publishSinglePost(
  post: PostRecord,
  account: ThreadsAccountRecord
): Promise<{ permalink: string | null; threadsMediaId: string }> {
  const db = getDb();

  // 1. Mark as publishing
  db.prepare(`
    UPDATE posts
    SET status = 'publishing', error_message = NULL, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), post.id);

  try {
    logEvent({
      level: "info",
      category: "publish",
      message: `Starting publication for post ${post.id} to Threads @${account.username}`,
      postId: post.id,
      accountId: account.id
    });

    // 2. Create container
    const containerId = await createMediaContainer(account.access_token, {
      text: post.text,
      imageUrl: post.image_url,
      altText: post.alt_text,
      topicTag: post.topic_tag
    });

    db.prepare(`
      UPDATE posts
      SET container_id = ?, updated_at = ?
      WHERE id = ?
    `).run(containerId, new Date().toISOString(), post.id);

    // 3. Poll container readiness
    await pollContainerStatus(account.access_token, containerId);

    // 4. Publish container
    const publishRes = await publishContainer(account.access_token, containerId);

    // 5. Fetch permalink
    const permalink = await getPostPermalink(account.access_token, publishRes.id);

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE posts
      SET status = 'published',
          published_at = ?,
          threads_media_id = ?,
          permalink = ?,
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(nowIso, publishRes.id, permalink, nowIso, post.id);

    logEvent({
      level: "info",
      category: "publish",
      message: `Successfully published to Threads @${account.username}! Permalink: ${permalink ?? "N/A"}`,
      postId: post.id,
      accountId: account.id,
      details: { permalink, threads_media_id: publishRes.id }
    });

    return { permalink, threadsMediaId: publishRes.id };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE posts
      SET status = 'failed',
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `).run(errorMsg, nowIso, post.id);

    logEvent({
      level: "error",
      category: "publish",
      message: `Failed to publish post ${post.id} to @${account.username}: ${errorMsg}`,
      postId: post.id,
      accountId: account.id,
      details: { error: errorMsg }
    });

    throw err;
  }
}

export async function publishPostById(postId: string): Promise<{ permalink: string | null; threadsMediaId: string }> {
  const db = getDb();
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId) as PostRecord | undefined;
  if (!post) {
    throw new Error(`Post ${postId} not found`);
  }

  let account: ThreadsAccountRecord | undefined;
  if (post.account_id) {
    account = db.prepare(`
      SELECT * FROM platform_accounts WHERE id = ?
    `).get(post.account_id) as ThreadsAccountRecord | undefined;
  } else {
    // Pick the first active account if not specified
    account = db.prepare(`
      SELECT * FROM platform_accounts WHERE status = 'active' AND is_active = 1 LIMIT 1
    `).get() as ThreadsAccountRecord | undefined;
  }

  if (!account) {
    throw new Error("No active Threads account available to publish this post");
  }

  return publishSinglePost(post, account);
}

let isProcessing = false;

export async function processDuePosts(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const db = getDb();
    const settings = db.prepare("SELECT daily_enabled FROM schedule_settings WHERE id = 1").get() as { daily_enabled?: number } | undefined;
    if (settings && settings.daily_enabled === 0) {
      // Automatic daily publishing is paused by admin in settings
      return;
    }

    const nowIso = new Date().toISOString();

    // Query pending/scheduled posts due for publishing
    const duePosts = db.prepare(`
      SELECT * FROM posts
      WHERE status = 'scheduled' AND scheduled_at <= ?
      ORDER BY scheduled_at ASC
      LIMIT 10
    `).all(nowIso) as PostRecord[];

    for (let i = 0; i < duePosts.length; i++) {
      const post = duePosts[i]!;
      let account: ThreadsAccountRecord | undefined;
      if (post.account_id) {
        account = db.prepare(`
          SELECT * FROM platform_accounts WHERE id = ? AND status = 'active' AND is_active = 1
        `).get(post.account_id) as ThreadsAccountRecord | undefined;
      } else {
        account = db.prepare(`
          SELECT * FROM platform_accounts WHERE status = 'active' AND is_active = 1 ORDER BY RANDOM() LIMIT 1
        `).get() as ThreadsAccountRecord | undefined;
      }

      if (!account) {
        db.prepare(`
          UPDATE posts
          SET status = 'failed', error_message = 'No active Threads account found for scheduled post', updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), post.id);

        logEvent({
          level: "warn",
          category: "publish",
          message: `Post ${post.id} could not be published: no active account available`,
          postId: post.id
        });
        continue;
      }

      try {
        await publishSinglePost(post, account);
      } catch (err) {
        console.error(`Error publishing due post ${post.id}:`, err);
      }

      // Small pacing pause between sequential publishes to avoid bursts
      if (i < duePosts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  } catch (err) {
    console.error("Error in processDuePosts scheduler loop:", err);
  } finally {
    isProcessing = false;
  }
}

let publisherInterval: NodeJS.Timeout | null = null;

export function startPublisherDaemon(): void {
  // Check every 20 seconds
  publisherInterval = setInterval(() => {
    void processDuePosts();
  }, 20_000);
}

export function stopPublisherDaemon(): void {
  if (publisherInterval) {
    clearInterval(publisherInterval);
    publisherInterval = null;
  }
}
