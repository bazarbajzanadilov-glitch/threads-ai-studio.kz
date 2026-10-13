import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getDb, logEvent } from "../db/index.js";
import {
  exchangeOAuthCode,
  fetchProfile,
  refreshLongLivedToken,
  type ThreadsAccountRecord
} from "../threads/api.js";
import {
  BASE_URL,
  THREADS_APP_ID,
  THREADS_APP_SECRET
} from "../config.js";

export const accountsRouter = Router();

accountsRouter.get("/", (_req: Request, res: Response) => {
  const db = getDb();
  const accounts = db.prepare(`
    SELECT id, threads_user_id, username, display_name, profile_picture_url,
           status, is_active, token_expires_at, last_error, created_at, updated_at
    FROM platform_accounts
    ORDER BY created_at ASC
  `).all() as Omit<ThreadsAccountRecord, "access_token">[];

  const now = Date.now();
  const enhanced = accounts.map((account) => {
    let daysRemaining = null;
    if (account.token_expires_at) {
      const expMs = Date.parse(account.token_expires_at);
      daysRemaining = Math.max(0, Math.round((expMs - now) / (24 * 60 * 60 * 1000)));
    }
    return {
      ...account,
      days_remaining: daysRemaining,
      is_active: Boolean(account.is_active)
    };
  });

  res.json({ accounts: enhanced });
});

// Manual token addition
accountsRouter.post("/manual", async (req: Request, res: Response) => {
  const { access_token, username: manualUsername } = req.body ?? {};

  if (!access_token || typeof access_token !== "string" || !access_token.trim()) {
    res.status(400).json({ error: { message: "access_token is required" } });
    return;
  }

  const token = access_token.trim();
  const db = getDb();

  try {
    let threadsUserId = "";
    let finalUsername = manualUsername || "";
    let avatar: string | null = null;

    try {
      // Verify token with Meta Threads and get real username + profile
      const profile = await fetchProfile(token);
      threadsUserId = String(profile.id);
      finalUsername = profile.username || manualUsername || `user_${threadsUserId.slice(-6)}`;
      avatar = profile.threads_profile_picture_url ?? null;
    } catch (profileErr) {
      if (manualUsername && typeof manualUsername === "string" && manualUsername.trim()) {
        threadsUserId = `user_${crypto.createHash("sha256").update(token).digest("hex").slice(0, 12)}`;
        finalUsername = manualUsername.trim();
      } else {
        throw profileErr;
      }
    }

    const id = `acc_${crypto.randomBytes(6).toString("hex")}`;
    const nowIso = new Date().toISOString();
    // Default 60-day expiry for Threads long-lived token
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO platform_accounts (
        id, threads_user_id, username, display_name, profile_picture_url,
        access_token, token_expires_at, status, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
      ON CONFLICT(threads_user_id) DO UPDATE SET
        username = excluded.username,
        profile_picture_url = excluded.profile_picture_url,
        access_token = excluded.access_token,
        token_expires_at = excluded.token_expires_at,
        status = 'active',
        is_active = 1,
        last_error = NULL,
        updated_at = excluded.updated_at
    `).run(id, threadsUserId, finalUsername, finalUsername, avatar, token, expiresAt, nowIso, nowIso);

    logEvent({
      level: "info",
      category: "account",
      message: `Connected Threads account @${finalUsername} (ID: ${threadsUserId})`,
      accountId: id
    });

    const saved = db.prepare(`
      SELECT id, threads_user_id, username, display_name, profile_picture_url,
             status, is_active, token_expires_at, created_at, updated_at
      FROM platform_accounts WHERE threads_user_id = ?
    `).get(threadsUserId);

    res.status(201).json({ account: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: { message: `Failed to verify Threads token: ${message}` } });
  }
});

// Active / Paused toggle
accountsRouter.post("/:id/toggle", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const db = getDb();

  const account = db.prepare("SELECT * FROM platform_accounts WHERE id = ?").get(id) as ThreadsAccountRecord | undefined;
  if (!account) {
    res.status(404).json({ error: { message: "Account not found" } });
    return;
  }

  const newIsActive = account.is_active ? 0 : 1;
  const newStatus = newIsActive ? "active" : "paused";
  const nowIso = new Date().toISOString();

  db.prepare(`
    UPDATE platform_accounts
    SET is_active = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(newIsActive, newStatus, nowIso, id);

  logEvent({
    level: "info",
    category: "account",
    message: `${newIsActive ? "Activated" : "Paused"} account @${account.username}`,
    accountId: id
  });

  res.json({
    account: {
      ...account,
      is_active: Boolean(newIsActive),
      status: newStatus
    }
  });
});

// Refresh long-lived token
accountsRouter.post("/:id/refresh", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const db = getDb();

  const account = db.prepare("SELECT * FROM platform_accounts WHERE id = ?").get(id) as ThreadsAccountRecord | undefined;
  if (!account) {
    res.status(404).json({ error: { message: "Account not found" } });
    return;
  }

  try {
    const refreshed = await refreshLongLivedToken(account.access_token);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE platform_accounts
      SET access_token = ?, token_expires_at = ?, status = 'active', last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(refreshed.access_token, newExpiresAt, nowIso, id);

    logEvent({
      level: "info",
      category: "token_refresh",
      message: `Manually refreshed token for @${account.username}`,
      accountId: id
    });

    res.json({ success: true, token_expires_at: newExpiresAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: { message: `Token refresh failed: ${message}` } });
  }
});

// Delete account
accountsRouter.delete("/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const db = getDb();

  const account = db.prepare("SELECT username FROM platform_accounts WHERE id = ?").get(id) as { username: string } | undefined;
  if (!account) {
    res.status(404).json({ error: { message: "Account not found" } });
    return;
  }

  db.prepare("DELETE FROM platform_accounts WHERE id = ?").run(id);

  logEvent({
    level: "info",
    category: "account",
    message: `Deleted account @${account.username}`,
    accountId: id
  });

  res.json({ success: true });
});

// OAuth start
accountsRouter.get("/oauth/start", (_req: Request, res: Response) => {
  if (!THREADS_APP_ID) {
    res.status(400).json({
      error: { message: "THREADS_APP_ID is not configured in .env. You can still use manual token entry!" }
    });
    return;
  }

  const redirectUri = `${BASE_URL}/api/accounts/oauth/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const url = new URL("https://threads.net/oauth/authorize");
  url.searchParams.set("client_id", THREADS_APP_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "threads_basic,threads_content_publish");
  url.searchParams.set("state", state);

  res.json({ authorization_url: url.toString(), state });
});

// OAuth callback handler
export async function oauthCallbackHandler(req: Request, res: Response): Promise<void> {
  const { code, error, error_description } = req.query;

  if (error) {
    res.redirect(`/#/accounts?error=${encodeURIComponent(String(error_description || error))}`);
    return;
  }

  if (!code || typeof code !== "string") {
    res.redirect("/#/accounts?error=No_code_provided");
    return;
  }

  try {
    const redirectUri = `${BASE_URL}/api/accounts/oauth/callback`;
    const oauthRes = await exchangeOAuthCode(code, redirectUri, THREADS_APP_ID, THREADS_APP_SECRET);

    const db = getDb();
    const id = `acc_${crypto.randomBytes(6).toString("hex")}`;
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + oauthRes.expires_in * 1000).toISOString();

    db.prepare(`
      INSERT INTO platform_accounts (
        id, threads_user_id, username, display_name, profile_picture_url,
        access_token, token_expires_at, status, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
      ON CONFLICT(threads_user_id) DO UPDATE SET
        username = excluded.username,
        profile_picture_url = excluded.profile_picture_url,
        access_token = excluded.access_token,
        token_expires_at = excluded.token_expires_at,
        status = 'active',
        is_active = 1,
        last_error = NULL,
        updated_at = excluded.updated_at
    `).run(
      id,
      oauthRes.threads_user_id,
      oauthRes.username,
      oauthRes.username,
      oauthRes.profile_picture_url,
      oauthRes.access_token,
      expiresAt,
      nowIso,
      nowIso
    );

    logEvent({
      level: "info",
      category: "account",
      message: `Connected Threads account via OAuth: @${oauthRes.username}`,
      accountId: id
    });

    res.redirect("/#/accounts?connected=1");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.redirect(`/#/accounts?error=${encodeURIComponent(message)}`);
  }
}

accountsRouter.get("/oauth/callback", oauthCallbackHandler);
