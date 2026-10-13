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
});

