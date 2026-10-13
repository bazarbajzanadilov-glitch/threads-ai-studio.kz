import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { getDb } from "../db/index.js";
import { UPLOADS_DIR } from "../config.js";

export const systemRouter = Router();

function getDirectorySizeBytes(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const files = fs.readdirSync(dirPath);
    let total = 0;
    for (const file of files) {
      const full = path.join(dirPath, file);
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        total += stat.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

systemRouter.get("/status", (_req: Request, res: Response) => {
  const db = getDb();

  const accountsTotal = (db.prepare("SELECT COUNT(*) as count FROM platform_accounts").get() as any)?.count ?? 0;
  const accountsActive = (db.prepare("SELECT COUNT(*) as count FROM platform_accounts WHERE status = 'active' AND is_active = 1").get() as any)?.count ?? 0;

  const postsScheduled = (db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'scheduled'").get() as any)?.count ?? 0;
  const postsPublished = (db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'published'").get() as any)?.count ?? 0;
  const postsFailed = (db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'failed'").get() as any)?.count ?? 0;

  const storageUsedBytes = getDirectorySizeBytes(UPLOADS_DIR);

  res.json({
    status: {
      uptime_seconds: Math.floor(process.uptime()),
      server_time: new Date().toISOString(),
      accounts: {
        total: accountsTotal,
        active: accountsActive
      },
      posts: {
        scheduled: postsScheduled,
        published: postsPublished,
        failed: postsFailed
      },
      storage: {
        used_bytes: storageUsedBytes,
        limit_bytes: 10 * 1024 * 1024 * 1024 // 10 GB
      }
    }
  });
});

systemRouter.get("/dashboard", (_req: Request, res: Response) => {
  const db = getDb();

  const accountsTotal = (db.prepare("SELECT COUNT(*) as count FROM platform_accounts").get() as any)?.count ?? 0;
  const accountsActive = (db.prepare("SELECT COUNT(*) as count FROM platform_accounts WHERE status = 'active' AND is_active = 1").get() as any)?.count ?? 0;
  const accountsList = db.prepare("SELECT id, username, status, is_active, profile_picture_url, token_expires_at FROM platform_accounts ORDER BY is_active DESC, username ASC LIMIT 10").all();

  const postsScheduled = (db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'scheduled'").get() as any)?.count ?? 0;
  const postsPublishedTotal = (db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'published'").get() as any)?.count ?? 0;
  
  const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const postsPublishedToday = (db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'published' AND published_at >= ?").get(yesterdayIso) as any)?.count ?? 0;
  const postsFailed = (db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'failed'").get() as any)?.count ?? 0;

  const nextPost = db.prepare(`
    SELECT p.*, a.username as account_username, a.profile_picture_url as account_avatar
    FROM posts p
    LEFT JOIN platform_accounts a ON p.account_id = a.id
    WHERE p.status = 'scheduled'
    ORDER BY p.scheduled_at ASC
    LIMIT 1
  `).get();

  const recentPublished = db.prepare(`
    SELECT p.*, a.username as account_username, a.profile_picture_url as account_avatar
    FROM posts p
    LEFT JOIN platform_accounts a ON p.account_id = a.id
    WHERE p.status = 'published'
    ORDER BY p.published_at DESC
    LIMIT 6
  `).all();

  const scheduleSettings = db.prepare("SELECT * FROM schedule_settings WHERE id = 1").get();
  const storageUsedBytes = getDirectorySizeBytes(UPLOADS_DIR);

  res.json({
    dashboard: {
      uptime_seconds: Math.floor(process.uptime()),
      server_time: new Date().toISOString(),
      accounts: {
        total: accountsTotal,
        active: accountsActive,
        list: accountsList
      },
      posts: {
        scheduled: postsScheduled,
        published_total: postsPublishedTotal,
        published_today: postsPublishedToday,
        failed: postsFailed
      },
      next_post: nextPost ?? null,
      recent_published: recentPublished,
      schedule: scheduleSettings,
      storage: {
        used_bytes: storageUsedBytes,
        limit_bytes: 10 * 1024 * 1024 * 1024
      }
    }
  });
});

