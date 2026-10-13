import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "./index.js";
import { initDb, getDb } from "./db/index.js";
import { ADMIN_EMAIL, SECOND_ADMIN_EMAIL, SESSION_SECRET } from "./config.js";
import { processDuePosts } from "./scheduler/publisher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.resolve(__dirname, "../../../data/test_threads.db");

describe("Server API Integration Tests", () => {
  let app: any;
  let adminToken: string;

  beforeAll(() => {
    initDb(testDbPath);
    const db = getDb();
    db.exec(`
      DELETE FROM posts;
      DELETE FROM platform_accounts;
      DELETE FROM events;
      UPDATE schedule_settings
      SET window_start = '11:00', window_end = '21:00', min_delay_minutes = 15, max_delay_minutes = 40
      WHERE id = 1;
    `);
    app = createApp(testDbPath);
  });

  afterAll(() => {
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    } catch {}
  });

  describe("Authentication", () => {
    it("rejects login with wrong password", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: ADMIN_EMAIL, password: "wrong_password" });
      expect(res.status).toBe(401);
    });

    it("rejects login with unauthorized email", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "hacker@example.com", password: SESSION_SECRET });
      expect(res.status).toBe(401);
    });

    it("authenticates primary admin and returns token + cookie", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: ADMIN_EMAIL, password: SESSION_SECRET });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(ADMIN_EMAIL);
      adminToken = res.body.token;
    });

    it("authenticates secondary admin successfully", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: SECOND_ADMIN_EMAIL, password: SESSION_SECRET });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(SECOND_ADMIN_EMAIL);
    });

    it("verifies authenticated /api/auth/me", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(ADMIN_EMAIL);
    });
  });

  describe("Schedule and Delays Settings", () => {
    it("gets current schedule settings", async () => {
      const res = await request(app)
        .get("/api/schedule/settings")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.settings.window_start).toBe("12:00");
      expect(res.body.settings.window_end).toBe("21:00");
      expect(res.body.settings.min_delay_minutes).toBe(15);
      expect(res.body.settings.max_delay_minutes).toBe(45);
    });

    it("updates schedule settings with validation", async () => {
      const updateRes = await request(app)
        .put("/api/schedule/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          window_start: "10:00",
          window_end: "20:00",
          min_delay_minutes: 20,
          max_delay_minutes: 45,
          randomize_delay: 1
        });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.settings.window_start).toBe("10:00");
      expect(updateRes.body.settings.min_delay_minutes).toBe(20);
    });

    it("generates jitter preview slots", async () => {
      const res = await request(app)
        .post("/api/schedule/preview")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ account_count: 5 });
      expect(res.status).toBe(200);
      expect(res.body.slots).toHaveLength(5);
    });
  });

  describe("Accounts Management", () => {
    it("returns empty accounts list initially", async () => {
      const res = await request(app)
        .get("/api/accounts")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.accounts)).toBe(true);
    });

    it("adds mock active accounts directly into database for testing", () => {
      const db = getDb();
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 50 * 86400 * 1000).toISOString();

      db.prepare(`
        INSERT INTO platform_accounts (
          id, threads_user_id, username, display_name, profile_picture_url,
          access_token, token_expires_at, status, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
      `).run("acc_test_1", "1001", "brand_kazakhstan", "Brand KZ", "https://example.com/pic1.jpg", "token_123", expiresAt, nowIso, nowIso);

      db.prepare(`
        INSERT INTO platform_accounts (
          id, threads_user_id, username, display_name, profile_picture_url,
          access_token, token_expires_at, status, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
      `).run("acc_test_2", "1002", "tech_studio_almaty", "Tech Studio", "https://example.com/pic2.jpg", "token_456", expiresAt, nowIso, nowIso);

      const count = (db.prepare("SELECT COUNT(*) as c FROM platform_accounts").get() as any).c;
      expect(count).toBe(2);
    });

    it("lists the accounts with calculated days remaining", async () => {
      const res = await request(app)
        .get("/api/accounts")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.accounts).toHaveLength(2);
      expect(res.body.accounts[0].username).toBe("brand_kazakhstan");
      expect(res.body.accounts[0].days_remaining).toBeGreaterThanOrEqual(48);
    });

    it("toggles active/paused state on an account", async () => {
      const toggleRes = await request(app)
        .post("/api/accounts/acc_test_1/toggle")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.account.is_active).toBe(false);
      expect(toggleRes.body.account.status).toBe("paused");

      // Toggle back to active
      const backRes = await request(app)
        .post("/api/accounts/acc_test_1/toggle")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(backRes.status).toBe(200);
      expect(backRes.body.account.is_active).toBe(true);
    });

    it("allows public OAuth callback without auth header and handles errors gracefully", async () => {
      const res = await request(app)
        .get("/api/accounts/oauth/callback?error=access_denied&error_description=User+declined");
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("/#/accounts?error=");
    });

    it("connects account via manual token entry with provided username", async () => {
      const res = await request(app)
        .post("/api/accounts/manual")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          access_token: "mock_long_lived_token_789",
          username: "influencer_astana"
        });
      expect(res.status).toBe(201);
      expect(res.body.account.username).toBe("influencer_astana");
      expect(res.body.account.status).toBe("active");
    });
  });

  describe("Image Uploads", () => {
    it("uploads valid JPEG image and returns public URL", async () => {
      const dummyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      const res = await request(app)
        .post("/api/upload")
        .set("Authorization", `Bearer ${adminToken}`)
        .attach("image", dummyJpeg, "test-photo.jpg");
      expect(res.status).toBe(201);
      expect(res.body.filename).toContain(".jpg");
      expect(res.body.url).toContain("https://thread.ai-studio.kz/uploads/");
    });

    it("rejects non-image upload with HTTP 400", async () => {
      const res = await request(app)
        .post("/api/upload")
        .set("Authorization", `Bearer ${adminToken}`)
        .attach("image", Buffer.from("console.log('not an image')"), "script.js");
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("JPG, PNG, and WebP");
    });
  });

  describe("Posts and Queue", () => {
    it("creates a scheduled post for a specific account (Text + 1 Image)", async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          account_id: "acc_test_1",
          text: "First Threads publication!",
          image_filename: "image1.jpg",
          image_url: "https://thread.ai-studio.kz/uploads/image1.jpg",
          scheduled_at: "2026-10-15T15:00:00+05:00"
        });
      expect(res.status).toBe(201);
      expect(res.body.post.text).toBe("First Threads publication!");
      expect(res.body.post.image_filename).toBe("image1.jpg");
      expect(res.body.post.status).toBe("scheduled");
    });

    it("rejects post with missing image", async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          account_id: "acc_test_1",
          text: "Post without image",
          scheduled_at: "2026-10-15T15:00:00+05:00"
        });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("image_url is required");
    });

    it("rejects post exceeding 500 characters", async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          account_id: "acc_test_1",
          text: "x".repeat(501),
          image_filename: "pic.jpg",
          image_url: "https://thread.ai-studio.kz/uploads/pic.jpg",
          scheduled_at: "2026-10-15T15:00:00+05:00"
        });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("500 characters");
    });

    it("creates distributed posts across all active accounts with jitter", async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          account_id: "all",
          text: "Universal broadcast post to all active accounts",
          image_filename: "broadcast.png",
          image_url: "https://thread.ai-studio.kz/uploads/broadcast.png",
          scheduled_at: "2026-10-16T12:00:00+05:00"
        });
      expect(res.status).toBe(201);
      expect(res.body.posts.length).toBeGreaterThanOrEqual(2);
    });

    it("lists scheduled posts and accurately computes total count when filtered by account_id", async () => {
      const res = await request(app)
        .get("/api/posts?account_id=acc_test_1")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.posts.every((p: any) => p.account_id === "acc_test_1")).toBe(true);
      expect(res.body.total).toBe(res.body.posts.length);
    });

    it("toggles pause on a scheduled post", async () => {
      const listRes = await request(app)
        .get("/api/posts")
        .set("Authorization", `Bearer ${adminToken}`);
      const targetPost = listRes.body.posts[0];

      const toggleRes = await request(app)
        .post(`/api/posts/${targetPost.id}/toggle-pause`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.status).toBe("paused");

      // Toggle back
      const backRes = await request(app)
        .post(`/api/posts/${targetPost.id}/toggle-pause`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(backRes.status).toBe(200);
      expect(backRes.body.status).toBe("scheduled");
    });

    it("deletes a post", async () => {
      const createRes = await request(app)
        .post("/api/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          account_id: "acc_test_1",
          text: "Post to be deleted",
          image_filename: "del.jpg",
          image_url: "https://thread.ai-studio.kz/uploads/del.jpg",
          scheduled_at: "2026-10-15T15:00:00+05:00"
        });
      const postId = createRes.body.post.id;

      const deleteRes = await request(app)
        .delete(`/api/posts/${postId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      const checkRes = await request(app)
        .get(`/api/posts/${postId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(checkRes.status).toBe(404);
    });
  });

  describe("System and Logs", () => {
    it("returns system status", async () => {
      const res = await request(app)
        .get("/api/system/status")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status.accounts.total).toBeGreaterThanOrEqual(2);
      expect(res.body.status.posts.scheduled).toBeGreaterThanOrEqual(2);
    });

    it("returns event logs", async () => {
      const res = await request(app)
        .get("/api/logs")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);
    });

    it("returns publication history", async () => {
      const res = await request(app)
        .get("/api/logs/history")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.history)).toBe(true);
    });

    it("respects daily_enabled setting and does not publish when disabled", async () => {
      const db = getDb();
      // Set daily_enabled to 0
      db.prepare("UPDATE schedule_settings SET daily_enabled = 0 WHERE id = 1").run();

      // Insert a past-due post
      const dueId = "post_due_test";
      db.prepare(`
        INSERT INTO posts (
          id, account_id, text, image_filename, image_url, status, scheduled_at, created_at, updated_at
        ) VALUES (?, 'acc_test_1', 'Due post while paused', 'due.jpg', 'https://thread.ai-studio.kz/uploads/due.jpg', 'scheduled', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
      `).run(dueId);

      // Run publisher loop
      await processDuePosts();

      // Post status should still be 'scheduled', not attempted or failed
      const post = db.prepare("SELECT status FROM posts WHERE id = ?").get(dueId) as { status: string };
      expect(post.status).toBe("scheduled");

      // Restore daily_enabled
      db.prepare("UPDATE schedule_settings SET daily_enabled = 1 WHERE id = 1").run();
      db.prepare("DELETE FROM posts WHERE id = ?").run(dueId);
    });

    it("returns rich dashboard data via /api/system/dashboard", async () => {
      const res = await request(app)
        .get("/api/system/dashboard")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.dashboard).toBeDefined();
      expect(res.body.dashboard.accounts).toBeDefined();
      expect(res.body.dashboard.posts).toBeDefined();
      expect(res.body.dashboard.schedule.window_start).toBeDefined();
      expect(res.body.dashboard.schedule.max_delay_minutes).toBeDefined();
    });
  });
});

