import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { calculateJitterSlots, parseContentInput, parseContentPatch } from "@publisher/core";
import { getDb, logEvent } from "../db/index.js";
import { publishPostById, type PostRecord } from "../scheduler/publisher.js";
import type { ThreadsAccountRecord } from "../threads/api.js";

export const postsRouter = Router();

postsRouter.get("/", (req: Request, res: Response) => {
  const db = getDb();
  const { status, account_id, limit = "100", offset = "0" } = req.query;

  let query = `
    SELECT p.*, a.username as account_username, a.profile_picture_url as account_avatar
    FROM posts p
    LEFT JOIN platform_accounts a ON p.account_id = a.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (status && status !== "all") {
    query += " AND p.status = ?";
    params.push(status);
  }

  if (account_id && account_id !== "all") {
    query += " AND p.account_id = ?";
    params.push(account_id);
  }

  query += " ORDER BY p.scheduled_at DESC LIMIT ? OFFSET ?";
  params.push(Number.parseInt(String(limit), 10), Number.parseInt(String(offset), 10));

  const posts = db.prepare(query).all(...params);

  let countQuery = "SELECT COUNT(*) as total FROM posts WHERE 1=1";
  const countParams: unknown[] = [];
  if (status && status !== "all") {
    countQuery += " AND status = ?";
    countParams.push(status);
  }
  if (account_id && account_id !== "all") {
    countQuery += " AND account_id = ?";
    countParams.push(account_id);
  }

  const countRow = db.prepare(countQuery).get(...countParams) as { total: number };

  res.json({ posts, total: countRow.total });
});

postsRouter.post("/", async (req: Request, res: Response) => {
  const db = getDb();
  const body = req.body ?? {};

  try {
    const validated = parseContentInput(body);
    const targetAccountId = validated.account_id;
    const nowIso = new Date().toISOString();

    // If targetAccountId is null or "all" (distribute across all active accounts with jitter)
    if (!targetAccountId || targetAccountId === "all") {
      const activeAccounts = db.prepare(`
        SELECT * FROM platform_accounts WHERE status = 'active' AND is_active = 1
      `).all() as ThreadsAccountRecord[];

      if (activeAccounts.length === 0) {
        res.status(400).json({ error: { message: "No active Threads accounts found to assign post" } });
        return;
      }

      const settings = db.prepare("SELECT * FROM schedule_settings WHERE id = 1").get() as {
        window_start?: string;
        window_end?: string;
        min_delay_minutes?: number;
        max_delay_minutes?: number;
        randomize_delay?: number;
      } | undefined;
      const scheduledBaseDate = new Date(validated.scheduled_at);
      const isScheduledNow = Math.abs(scheduledBaseDate.getTime() - Date.now()) < 5 * 60 * 1000;
      const slots = calculateJitterSlots({
        windowStart: settings?.window_start ?? "12:00",
        windowEnd: settings?.window_end ?? "21:00",
        minDelayMinutes: settings?.min_delay_minutes ?? 15,
        maxDelayMinutes: settings?.max_delay_minutes ?? 45,
        randomize: Boolean(settings?.randomize_delay ?? 1),
        accountCount: activeAccounts.length,
        baseDate: scheduledBaseDate,
        timezoneOffsetHours: 5,
        startFromBaseTime: isScheduledNow || scheduledBaseDate.getTime() >= Date.now()
      });

      const createdPosts: PostRecord[] = [];
      const insertStmt = db.prepare(`
        INSERT INTO posts (
          id, account_id, text, image_filename, image_url, alt_text, topic_tag,
          status, scheduled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)
      `);

      for (let i = 0; i < activeAccounts.length; i++) {
        const acc = activeAccounts[i]!;
        const slot = slots[i]!;
        const postId = `post_${crypto.randomBytes(8).toString("hex")}`;
        const scheduledTime = slot.scheduledAt;

        insertStmt.run(
          postId,
          acc.id,
          validated.text,
          validated.image_filename,
          validated.image_url,
          validated.alt_text ?? null,
          validated.topic_tag ?? null,
          scheduledTime,
          nowIso,
          nowIso
        );

        createdPosts.push({
          id: postId,
          account_id: acc.id,
          text: validated.text,
          image_filename: validated.image_filename,
          image_url: validated.image_url,
          alt_text: validated.alt_text,
          topic_tag: validated.topic_tag,
          status: "scheduled",
          scheduled_at: scheduledTime,
          created_at: nowIso,
          updated_at: nowIso
        });
      }

      logEvent({
        level: "info",
        category: "publish",
        message: `Scheduled ${createdPosts.length} posts across all active accounts with randomized jitter`
      });

      res.status(201).json({ posts: createdPosts });
      return;
    }

    // Single account post
    const postId = `post_${crypto.randomBytes(8).toString("hex")}`;
    db.prepare(`
      INSERT INTO posts (
        id, account_id, text, image_filename, image_url, alt_text, topic_tag,
        status, scheduled_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)
    `).run(
      postId,
      targetAccountId,
      validated.text,
      validated.image_filename,
      validated.image_url,
      validated.alt_text ?? null,
      validated.topic_tag ?? null,
      validated.scheduled_at,
      nowIso,
      nowIso
    );

    const created = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
    res.status(201).json({ post: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: { message } });
  }
});

postsRouter.get("/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const db = getDb();
  const post = db.prepare(`
    SELECT p.*, a.username as account_username, a.profile_picture_url as account_avatar
    FROM posts p
    LEFT JOIN platform_accounts a ON p.account_id = a.id
    WHERE p.id = ?
  `).get(id);

  if (!post) {
    res.status(404).json({ error: { message: "Post not found" } });
    return;
  }
  res.json({ post });
});

postsRouter.patch("/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const db = getDb();

  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRecord | undefined;
  if (!post) {
    res.status(404).json({ error: { message: "Post not found" } });
    return;
  }

  if (["published", "publishing"].includes(post.status)) {
    res.status(400).json({ error: { message: "Cannot edit a published or currently publishing post" } });
    return;
  }

  try {
    const patch = parseContentPatch(req.body);
    const updates: string[] = ["updated_at = ?"];
    const params: unknown[] = [new Date().toISOString()];

    if (patch.text !== undefined) {
      updates.push("text = ?");
      params.push(patch.text);
    }
    if (patch.image_filename !== undefined) {
      updates.push("image_filename = ?");
      params.push(patch.image_filename);
    }
    if (patch.image_url !== undefined) {
      updates.push("image_url = ?");
      params.push(patch.image_url);
    }
    if (patch.alt_text !== undefined) {
      updates.push("alt_text = ?");
      params.push(patch.alt_text);
    }
    if (patch.topic_tag !== undefined) {
      updates.push("topic_tag = ?");
      params.push(patch.topic_tag);
    }
    if (patch.scheduled_at !== undefined) {
      updates.push("scheduled_at = ?");
      params.push(patch.scheduled_at);
    }
    if (patch.account_id !== undefined) {
      updates.push("account_id = ?");
      params.push(patch.account_id);
    }

    params.push(id);
    db.prepare(`UPDATE posts SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    const updated = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
    res.json({ post: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: { message } });
  }
});

// Publish now
postsRouter.post("/:id/publish-now", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const result = await publishPostById(id);
    res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: { message } });
  }
});

// Toggle pause
postsRouter.post("/:id/toggle-pause", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const db = getDb();

  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRecord | undefined;
  if (!post) {
    res.status(404).json({ error: { message: "Post not found" } });
    return;
  }

  const newStatus = post.status === "paused" ? "scheduled" : "paused";
  db.prepare(`
    UPDATE posts SET status = ?, updated_at = ? WHERE id = ?
  `).run(newStatus, new Date().toISOString(), id);

  res.json({ status: newStatus });
});

// Delete post
postsRouter.delete("/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const db = getDb();
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  res.json({ success: true });
});
