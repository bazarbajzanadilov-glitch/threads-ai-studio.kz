import { render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { AccountsView } from "./accounts";
import { ScheduleView } from "./schedule";
import { api } from "../api";

describe("Admin Views Rendering", () => {
  it("renders AccountsView with empty state when no accounts connected", async () => {
    vi.spyOn(api, "getAccounts").mockResolvedValueOnce([]);
    const notify = vi.fn();

    render(<AccountsView notify={notify} />);

    expect(await screen.findByText("Подключенные аккаунты Threads")).toBeTruthy();
    expect(await screen.findByText("Нет подключенных аккаунтов")).toBeTruthy();
  });

  it("renders ScheduleView with posting window and jitter controls", async () => {
    vi.spyOn(api, "getScheduleSettings").mockResolvedValueOnce({
      window_start: "11:00",
      window_end: "21:00",
      timezone: "Asia/Almaty",
      min_delay_minutes: 15,
      max_delay_minutes: 40,
      randomize_delay: 1,
      daily_enabled: 1,
      updated_at: new Date().toISOString(),
    });
    vi.spyOn(api, "getSchedulePreview").mockResolvedValueOnce([
      { index: 0, timeFormatted: "11:00", delayMinutes: 0, scheduledAt: "2026-10-12T06:00:00Z", account_username: "brand_kz" }
    ]);

    const notify = vi.fn();
    render(<ScheduleView notify={notify} />);

    expect(await screen.findByText("Расписание и Задержки (Jitter)")).toBeTruthy();
    expect(await screen.findByText("Дневное окно публикаций")).toBeTruthy();
    const matches = await screen.findAllByText("11:00");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders DashboardView with stats and auto-posting status", async () => {
    vi.spyOn(api, "getDashboard").mockResolvedValueOnce({
      uptime_seconds: 3600,
      server_time: new Date().toISOString(),
      accounts: { total: 10, active: 10, list: [] },
      posts: { scheduled: 5, published_total: 20, published_today: 4, failed: 0 },
      next_post: null,
      recent_published: [],
      schedule: {
        window_start: "12:00",
        window_end: "21:00",
        timezone: "Asia/Almaty",
        min_delay_minutes: 15,
        max_delay_minutes: 45,
        randomize_delay: 1,
        daily_enabled: 1,
        updated_at: new Date().toISOString(),
      },
      storage: { used_bytes: 1048576, limit_bytes: 10737418240 },
    });

    const notify = vi.fn();
    const onNavigate = vi.fn();
    const { DashboardView } = await import("./dashboard");
    render(<DashboardView notify={notify} onNavigate={onNavigate} />);

    expect(await screen.findByText("Главная Панель")).toBeTruthy();
    expect(await screen.findByText(/Автопостинг Threads: ВКЛЮЧЕН/)).toBeTruthy();
  });

  it("renders Threads Studio luxury minimalist dashboard without any banking/crypto dummy items", async () => {
    vi.spyOn(api, "getDashboard").mockResolvedValueOnce({
      uptime_seconds: 3600,
      server_time: new Date().toISOString(),
      accounts: {
        total: 4,
        active: 4,
        list: [
          {
            id: "acc_1",
            username: "bazarbay_kz",
            status: "active",
            is_active: 1,
            profile_picture_url: null,
            token_expires_at: null,
          }
        ]
      },
      posts: { scheduled: 2, published_total: 15, published_today: 3, failed: 0 },
      next_post: {
        id: "post_next",
        account_id: "acc_1",
        account_username: "bazarbay_kz",
        text: "Анонс нового релиза в Threads Studio!",
        image_filename: "next.jpg",
        image_url: "https://example.com/next.jpg",
        status: "scheduled",
        scheduled_at: new Date(Date.now() + 1800000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      recent_published: [
        {
          id: "post_pub1",
          account_id: "acc_1",
          account_username: "bazarbay_kz",
          text: "Успешная публикация через автопилот",
          image_filename: "pub1.jpg",
          image_url: "https://example.com/pub1.jpg",
          status: "published",
          scheduled_at: new Date(Date.now() - 3600000).toISOString(),
          published_at: new Date(Date.now() - 3000000).toISOString(),
          permalink: "https://www.threads.net/@bazarbay_kz/post/test123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      ],
      schedule: {
        window_start: "12:00",
        window_end: "21:00",
        timezone: "Asia/Almaty",
        min_delay_minutes: 15,
        max_delay_minutes: 45,
        randomize_delay: 1,
        daily_enabled: 1,
        updated_at: new Date().toISOString(),
      },
      storage: { used_bytes: 1048576, limit_bytes: 10737418240 },
    });

    const notify = vi.fn();
    const onNavigate = vi.fn();
    const { DashboardView } = await import("./dashboard");
    render(<DashboardView notify={notify} onNavigate={onNavigate} />);

    // 1. Header elements
    expect(await screen.findByText("Hey, Bazarbay! 👋")).toBeTruthy();
    expect(await screen.findByText("Threads Studio")).toBeTruthy();

    // 2. Metric tags
    expect(await screen.findByText("4 / 4 Активны")).toBeTruthy();
    expect(await screen.findByText("Постов сегодня")).toBeTruthy();
    expect(await screen.findByText("Следующий пост")).toBeTruthy();

    // 3. Two Trantor Pill Buttons
    const createMatches = await screen.findAllByText("+ Создать пост");
    expect(createMatches.length).toBeGreaterThanOrEqual(1);

    const accountMatches = await screen.findAllByText("+ Аккаунт");
    expect(accountMatches.length).toBeGreaterThanOrEqual(1);

    // 4. Connected Accounts and Recent Publications
    expect(await screen.findByText("Подключенные аккаунты")).toBeTruthy();
    const usernameMatches = await screen.findAllByText("@bazarbay_kz");
    expect(usernameMatches.length).toBeGreaterThanOrEqual(1);

    expect(await screen.findByText("Недавние публикации")).toBeTruthy();
    expect(await screen.findByText("Успешная публикация через автопилот")).toBeTruthy();
    expect(await screen.findByText("Threads")).toBeTruthy();

    // 5. CRITICAL: Strictly NO banking / crypto dummy artifacts
    expect(screen.queryByText("Cardy Pay")).toBeNull();
    expect(screen.queryByText("Welcome, John!")).toBeNull();
    expect(screen.queryByText("$ 13,553.00")).toBeNull();
    expect(screen.queryByText("Wine Shop")).toBeNull();
    expect(screen.queryByText("Token Bonus")).toBeNull();
    expect(screen.queryByText("Tokens To Buy")).toBeNull();
    expect(screen.queryByText("8990TB")).toBeNull();
    expect(screen.queryByText("Cash >")).toBeNull();
    expect(screen.queryByText("Positions >")).toBeNull();
    expect(screen.queryByText("Food")).toBeNull();
    expect(screen.queryByText("Al-Bank")).toBeNull();
  });
});
