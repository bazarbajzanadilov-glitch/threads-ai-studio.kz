import { getDb, logEvent } from "../db/index.js";
import { refreshLongLivedToken, type ThreadsAccountRecord } from "../threads/api.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function checkAndRefreshExpiringTokens(): Promise<void> {
  const db = getDb();
  const accounts = db.prepare(`
    SELECT * FROM platform_accounts
    WHERE status = 'active' AND is_active = 1
  `).all() as ThreadsAccountRecord[];

  const now = Date.now();

  for (const account of accounts) {
    if (!account.token_expires_at) continue;
    const expiresAtMs = Date.parse(account.token_expires_at);

    // If token expires in less than 30 days, refresh it
    if (expiresAtMs - now < THIRTY_DAYS_MS) {
      try {
        logEvent({
          level: "info",
          category: "token_refresh",
          message: `Refreshing long-lived token for @${account.username} (expires in ${Math.round((expiresAtMs - now) / 86400000)} days)`,
          accountId: account.id
        });

        const refreshed = await refreshLongLivedToken(account.access_token);
        const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

        db.prepare(`
          UPDATE platform_accounts
          SET updated_at = ?, access_token = ?, token_expires_at = ?, status = 'active'
          WHERE id = ?
        `).run(new Date().toISOString(), refreshed.access_token, newExpiresAt, account.id);

        logEvent({
          level: "info",
          category: "token_refresh",
          message: `Successfully refreshed token for @${account.username}. New expiry: ${newExpiresAt}`,
          accountId: account.id
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logEvent({
          level: "warn",
          category: "token_refresh",
          message: `Failed to refresh token for @${account.username}: ${errorMsg}`,
          accountId: account.id
        });

        // Mark as expiring or revoked if permanent
        if (errorMsg.includes("expired") || errorMsg.includes("revoked") || errorMsg.includes("invalid")) {
          const isRevoked = errorMsg.includes("revoked");
          const newStatus = isRevoked ? "revoked" : "expiring";
          db.prepare(`
            UPDATE platform_accounts
            SET status = ?, is_active = 0, last_error = ?, updated_at = ?
            WHERE id = ?
          `).run(newStatus, errorMsg, new Date().toISOString(), account.id);
        }
      }
    }
  }
}

let refresherInterval: NodeJS.Timeout | null = null;

export function startTokenRefresherDaemon(): void {
  // Run on startup
  void checkAndRefreshExpiringTokens();

  // Run every 12 hours
  refresherInterval = setInterval(() => {
    void checkAndRefreshExpiringTokens();
  }, 12 * 60 * 60 * 1000);
}

export function stopTokenRefresherDaemon(): void {
  if (refresherInterval) {
    clearInterval(refresherInterval);
    refresherInterval = null;
  }
}
