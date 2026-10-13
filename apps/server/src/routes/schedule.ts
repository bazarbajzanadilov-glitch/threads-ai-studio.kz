import { Router, type Request, type Response } from "express";
import { calculateJitterSlots, validateScheduleSettings } from "@publisher/core";
import { getDb, logEvent } from "../db/index.js";
import type { ThreadsAccountRecord } from "../threads/api.js";

export const scheduleRouter = Router();

scheduleRouter.get("/settings", (_req: Request, res: Response) => {
  const db = getDb();
  const settings = db.prepare("SELECT * FROM schedule_settings WHERE id = 1").get();
  res.json({ settings });
});

scheduleRouter.put("/settings", (req: Request, res: Response) => {
  const db = getDb();
  const body = req.body ?? {};

  try {
    validateScheduleSettings(body);

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE schedule_settings
      SET window_start = COALESCE(?, window_start),
          window_end = COALESCE(?, window_end),
          timezone = COALESCE(?, timezone),
          min_delay_minutes = COALESCE(?, min_delay_minutes),
          max_delay_minutes = COALESCE(?, max_delay_minutes),
          randomize_delay = COALESCE(?, randomize_delay),
          daily_enabled = COALESCE(?, daily_enabled),
          updated_at = ?
      WHERE id = 1
    `).run(
      body.window_start,
      body.window_end,
      body.timezone,
      body.min_delay_minutes,
      body.max_delay_minutes,
      body.randomize_delay !== undefined ? (body.randomize_delay ? 1 : 0) : null,
      body.daily_enabled !== undefined ? (body.daily_enabled ? 1 : 0) : null,
      nowIso
    );

    logEvent({
      level: "info",
      category: "schedule",
      message: "Updated schedule and jitter delay settings",
      details: body
    });

    const updated = db.prepare("SELECT * FROM schedule_settings WHERE id = 1").get();
    res.json({ settings: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: { message } });
  }
});

scheduleRouter.post("/preview", (req: Request, res: Response) => {
  const db = getDb();
  const settings = (db.prepare("SELECT * FROM schedule_settings WHERE id = 1").get() ?? {}) as {
    window_start?: string;
    window_end?: string;
    min_delay_minutes?: number;
    max_delay_minutes?: number;
    randomize_delay?: number;
  };
  const accounts = db.prepare("SELECT username FROM platform_accounts WHERE status = 'active' AND is_active = 1").all() as Array<{ username: string }>;

  const accountCount = req.body?.account_count ?? Math.max(1, accounts.length);
  const randomize = req.body?.randomize !== undefined ? Boolean(req.body.randomize) : Boolean(settings.randomize_delay ?? 1);

  const slots = calculateJitterSlots({
    windowStart: req.body?.window_start ?? settings.window_start ?? "12:00",
    windowEnd: req.body?.window_end ?? settings.window_end ?? "21:00",
    minDelayMinutes: req.body?.min_delay_minutes ?? settings.min_delay_minutes ?? 15,
    maxDelayMinutes: req.body?.max_delay_minutes ?? settings.max_delay_minutes ?? 45,
    randomize,
    accountCount,
    baseDate: req.body?.date ? new Date(req.body.date) : new Date(),
    timezoneOffsetHours: 5 // Almaty UTC+5
  });

  const slotsWithAccounts = slots.map((slot, i) => ({
    ...slot,
    account_username: accounts[i]?.username ?? `Account ${i + 1}`
  }));

  res.json({ slots: slotsWithAccounts });
});
