import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, UPLOADS_DIR } from "../config.js";

let dbInstance: Database.Database | null = null;

export function initDb(customPath?: string): Database.Database {
  const targetPath = customPath ?? DB_PATH;
  const targetDir = path.dirname(targetPath);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const db = new Database(targetPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_accounts (
      id TEXT PRIMARY KEY,
      threads_user_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      display_name TEXT,
      profile_picture_url TEXT,
      access_token TEXT NOT NULL,
      token_expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expiring', 'revoked')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      text TEXT NOT NULL,
      image_filename TEXT NOT NULL,
      image_url TEXT NOT NULL,
      alt_text TEXT,
      topic_tag TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'paused', 'failed')),
      scheduled_at TEXT NOT NULL,
      published_at TEXT,
      container_id TEXT,
      threads_media_id TEXT,
      permalink TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      window_start TEXT NOT NULL DEFAULT '12:00',
      window_end TEXT NOT NULL DEFAULT '21:00',
      timezone TEXT NOT NULL DEFAULT 'Asia/Almaty',
      min_delay_minutes INTEGER NOT NULL DEFAULT 15,
      max_delay_minutes INTEGER NOT NULL DEFAULT 45,
      randomize_delay INTEGER NOT NULL DEFAULT 1 CHECK (randomize_delay IN (0, 1)),
      daily_enabled INTEGER NOT NULL DEFAULT 1 CHECK (daily_enabled IN (0, 1)),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT,
      post_id TEXT,
      account_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_schedule ON posts(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_posts_account ON posts(account_id, status);
    CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);
  `);

  // Default schedule settings
  const existingSettings = db.prepare("SELECT id FROM schedule_settings WHERE id = 1").get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO schedule_settings (
        id, window_start, window_end, timezone, min_delay_minutes, max_delay_minutes, randomize_delay, daily_enabled, updated_at
      ) VALUES (1, '12:00', '21:00', 'Asia/Almaty', 15, 45, 1, 1, ?)
    `).run(new Date().toISOString());
  } else {
    // Update existing settings to align with user preference
    db.prepare(`
      UPDATE schedule_settings
      SET window_start = '12:00', window_end = '21:00', min_delay_minutes = 15, max_delay_minutes = 45
      WHERE id = 1
    `).run();
  }

  dbInstance = db;
  return db;
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = initDb();
  }
  return dbInstance;
}

export function logEvent(input: {
  level: "info" | "warn" | "error";
  category: string;
  message: string;
  details?: Record<string, unknown> | null;
  postId?: string | null;
  accountId?: string | null;
}): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO events (level, category, message, details_json, post_id, account_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.level,
      input.category,
      input.message,
      input.details ? JSON.stringify(input.details) : null,
      input.postId ?? null,
      input.accountId ?? null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error("Failed to log event to DB:", err);
  }
}
