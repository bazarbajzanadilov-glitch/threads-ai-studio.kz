import { Router, type Request, type Response } from "express";
import { getDb } from "../db/index.js";

export const logsRouter = Router();

logsRouter.get("/", (req: Request, res: Response) => {
  const db = getDb();
  const { level, category, limit = "50", offset = "0" } = req.query;

  let query = "SELECT * FROM events WHERE 1=1";
  const params: unknown[] = [];

  if (level && level !== "all") {
    query += " AND level = ?";
    params.push(level);
  }

  if (category && category !== "all") {
    query += " AND category = ?";
    params.push(category);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(Number.parseInt(String(limit), 10), Number.parseInt(String(offset), 10));

  const events = db.prepare(query).all(...params);
  res.json({ events });
});

// History endpoint for publication timeline with permalinks
logsRouter.get("/history", (req: Request, res: Response) => {
  const db = getDb();
  const { limit = "50", offset = "0" } = req.query;

  const history = db.prepare(`
    SELECT p.id, p.text, p.image_url, p.image_filename, p.status,
           p.permalink, p.threads_media_id, p.published_at, p.error_message,
           p.scheduled_at, p.created_at,
           a.username as account_username, a.profile_picture_url as account_avatar
    FROM posts p
    LEFT JOIN platform_accounts a ON p.account_id = a.id
    WHERE p.status IN ('published', 'failed')
    ORDER BY COALESCE(p.published_at, p.updated_at) DESC
    LIMIT ? OFFSET ?
  `).all(Number.parseInt(String(limit), 10), Number.parseInt(String(offset), 10));

  res.json({ history });
});
