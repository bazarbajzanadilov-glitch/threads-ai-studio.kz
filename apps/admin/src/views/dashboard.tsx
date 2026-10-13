import { useCallback, useEffect, useState } from "preact/hooks";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  HardDrive,
  ImageIcon,
  PlusCircle,
  RefreshCw,
  Send,
  Sliders,
  Sparkles,
  Users
} from "lucide-preact";
import { api } from "../api";
import type { DashboardData } from "../types";
import { formatBytes, formatDateTime, relativeTime } from "../utils";

interface DashboardProps {
  notify: (msg: string, tone?: "success" | "error" | "info") => void;
  onNavigate: (tab: "accounts" | "queue" | "schedule" | "logs") => void;
}

export function DashboardView({ notify, onNavigate }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await api.getDashboard();
      setData(res);
      if (isManual) notify("Данные дашборда обновлены", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Не удалось загрузить данные дашборда", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div class="view-loading" style={{ minHeight: "50vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
        <div class="spinner" style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent-indigo)" }} />
        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>Загрузка центра управления Threads...</p>
      </div>
    );
  }

  const accounts = data?.accounts ?? { total: 0, active: 0, list: [] };
  const posts = data?.posts ?? { scheduled: 0, published_total: 0, published_today: 0, failed: 0 };
  const schedule = data?.schedule;
  const nextPost = data?.next_post;
  const recentPublished = data?.recent_published ?? [];

  return (
    <div class="view dashboard-view">
      {/* View Header with quick refresh and create button */}
      <header class="view-header" style={{ marginBottom: "1.25rem" }}>
        <div>
          <span class="eyebrow" style={{ display: "block", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--accent-indigo)", fontWeight: 700, marginBottom: "0.25rem" }}>
            Центр управления автопубликацией
          </span>
          <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 3.5vw, 2.2rem)", fontWeight: 800, letterSpacing: "-0.03em" }}>
            Главная Панель
          </h1>
        </div>
        <div class="view-actions" style={{ display: "flex", gap: "0.6rem" }}>
          <button
            class="btn btn-secondary"
            onClick={() => load(true)}
            disabled={refreshing}
            title="Обновить данные"
            style={{ padding: "0.55rem 1rem" }}
          >
            <RefreshCw class={refreshing ? "spin" : ""} size={16} />
            <span>Обновить</span>
          </button>
          <button class="btn btn-primary" onClick={() => onNavigate("queue")} style={{ padding: "0.55rem 1.25rem" }}>
            <PlusCircle size={16} />
            <span>Создать пост</span>
          </button>
        </div>
      </header>

      {/* 1. HERO BALANCE CARD (Reference 1: Sara Fintech) */}
      <div class="hero-balance-card">
        <div class="hero-card-header">
          <span class="hero-balance-label">Threads Автопилот</span>
          <div class="hero-status-pill">
            <div
              class="hero-pulse-dot"
              style={{
                backgroundColor: schedule?.daily_enabled ? "var(--accent-mint)" : "#ef4444",
                boxShadow: schedule?.daily_enabled ? "0 0 10px rgba(52, 211, 153, 0.8)" : "none"
              }}
            />
            <span>{schedule?.daily_enabled ? "Автопостинг Threads: ВКЛЮЧЕН" : "Автопостинг Threads: НА ПАУЗЕ"}</span>
          </div>
        </div>

        <div class="hero-balance-value">
          {accounts.active}
          <span>/ {accounts.total} аккаунтов</span>
        </div>

        <div class="hero-chips-row">
          <div class="hero-stat-chip" onClick={() => onNavigate("queue")} style={{ cursor: "pointer" }}>
            <Clock size={14} color="var(--accent-amber)" />
            <span>В очереди: <strong>{posts.scheduled}</strong></span>
          </div>

          <div class="hero-stat-chip" onClick={() => onNavigate("logs")} style={{ cursor: "pointer" }}>
            <CheckCircle2 size={14} color="var(--accent-mint)" />
            <span>Сегодня: <strong>{posts.published_today}</strong></span>
          </div>

          <div class="hero-stat-chip" onClick={() => onNavigate("schedule")} style={{ cursor: "pointer" }}>
            <Sliders size={14} color="var(--accent-indigo)" />
            <span>Окно: <strong>{schedule?.window_start ?? "12:00"}–{schedule?.window_end ?? "21:00"}</strong></span>
          </div>

          <div class="hero-stat-chip" onClick={() => onNavigate("schedule")} style={{ cursor: "pointer" }}>
            <Sparkles size={14} color="#f472b6" />
            <span>Джиттер: <strong>{schedule?.min_delay_minutes ?? 15}–{schedule?.max_delay_minutes ?? 45}м</strong></span>
          </div>

          <div class="hero-stat-chip">
            <HardDrive size={14} color="#38bdf8" />
            <span>Медиа: <strong>{formatBytes(data?.storage.used_bytes ?? 0)}</strong></span>
          </div>
        </div>
      </div>

      {/* 2. QUICK ACTIONS 4-CIRCLE GRID (Reference 1: Agregar Gasto / Ingreso) */}
      <div class="quick-actions-grid">
        <button class="action-card" onClick={() => onNavigate("queue")}>
          <div class="action-icon-circle" style={{ background: "rgba(52, 211, 153, 0.12)", color: "var(--accent-mint)" }}>
            <PlusCircle size={22} />
          </div>
          <span class="action-label">+ Пост</span>
        </button>

        <button class="action-card" onClick={() => onNavigate("accounts")}>
          <div class="action-icon-circle" style={{ background: "rgba(129, 140, 248, 0.12)", color: "var(--accent-indigo)" }}>
            <Users size={22} />
          </div>
          <span class="action-label">+ Аккаунт</span>
        </button>

        <button class="action-card" onClick={() => onNavigate("schedule")}>
          <div class="action-icon-circle" style={{ background: "rgba(251, 191, 36, 0.12)", color: "var(--accent-amber)" }}>
            <Sliders size={22} />
          </div>
          <span class="action-label">График</span>
        </button>

        <button class="action-card" onClick={() => onNavigate("logs")}>
          <div class="action-icon-circle" style={{ background: "rgba(244, 114, 182, 0.12)", color: "#f472b6" }}>
            <Send size={22} />
          </div>
          <span class="action-label">Журнал</span>
        </button>
      </div>

      {/* 3. TIMELINE PROGRESS BAR (Reference 1 & 3: Segmented timeline) */}
      <div class="card timeline-card">
        <div class="timeline-header">
          <div>
            <div class="timeline-title">График публикации на сегодня</div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
              Asia/Almaty (UTC+5) • Рандомизированные задержки между аккаунтами
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onClick={() => onNavigate("schedule")}>
            <Sliders size={14} />
            <span>Настроить</span>
          </button>
        </div>

        <div class="timeline-track-wrap">
          <div class="timeline-track">
            <div
              class="timeline-fill"
              style={{
                width: `${Math.min(100, Math.max(accounts.active > 0 ? (posts.published_today / accounts.active) * 100 : 0, posts.published_today > 0 ? 10 : 0))}%`
              }}
            />
          </div>
          <div class="timeline-markers">
            <span>{schedule?.window_start ?? "12:00"} Старт</span>
            <span style={{ color: "var(--accent-mint)", fontWeight: 700 }}>
              Выполнено: {posts.published_today} из {accounts.active} постов
            </span>
            <span>{schedule?.window_end ?? "21:00"} Финиш</span>
          </div>
        </div>
      </div>

      {/* 4. ACCOUNTS CAROUSEL ROW (Reference 2: Cardy Pay horizontal recipients) */}
      <div class="card accounts-row-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>Подключенные аккаунты</h3>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {accounts.active} активных из {accounts.total} в ротации
            </span>
          </div>
          <button class="btn btn-secondary btn-sm" onClick={() => onNavigate("accounts")}>
            <span>Все {accounts.total}</span>
            <ChevronRight size={14} />
          </button>
        </div>

        <div class="accounts-scroll-row">
          {/* Add Account Shortcut */}
          <div
            class="account-avatar-pill"
            onClick={() => onNavigate("accounts")}
            title="Добавить новый аккаунт"
          >
            <div
              class="avatar-wrapper"
              style={{
                border: "2px dashed rgba(255, 255, 255, 0.25)",
                background: "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Users size={20} color="var(--accent-indigo)" />
            </div>
            <span class="avatar-name-label" style={{ color: "var(--accent-indigo)" }}>+ Добавить</span>
          </div>

          {accounts.list.map((acc) => (
            <div
              key={acc.id}
              class="account-avatar-pill"
              onClick={() => onNavigate("accounts")}
              title={`@${acc.username} (${acc.is_active ? "Активен" : "На паузе"})`}
            >
              <div class="avatar-wrapper">
                {acc.profile_picture_url ? (
                  <img src={acc.profile_picture_url} alt={`@${acc.username}`} />
                ) : (
                  <div class="avatar-initial">
                    {(acc.username[0] || "@").toUpperCase()}
                  </div>
                )}
                <div
                  class={`avatar-badge-dot ${
                    acc.is_active ? "avatar-badge-dot--active" : "avatar-badge-dot--paused"
                  }`}
                />
              </div>
              <span class="avatar-name-label">@{acc.username}</span>
            </div>
          ))}

          {accounts.list.length === 0 && (
            <div style={{ padding: "0.5rem 0", color: "var(--text-muted)", fontSize: "0.85rem" }}>
              Аккаунты еще не подключены. Нажмите «+ Добавить», чтобы привязать первый аккаунт Threads.
            </div>
          )}
        </div>
      </div>

      {/* 5. NEXT PUBLICATION HERO WIDGET (Reference 1: Mis metas de ahorro) */}
      <div class="card next-post-hero">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
            Ближайшая публикация
          </span>
          {nextPost && <span class="badge badge-warning">В очереди</span>}
        </div>

        {nextPost ? (
          <div class="next-post-layout">
            {nextPost.image_url ? (
              <img src={nextPost.image_url} alt="Превью" class="next-post-thumb" />
            ) : (
              <div
                class="next-post-thumb"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255, 255, 255, 0.05)"
                }}
              >
                <ImageIcon size={32} color="var(--text-muted)" />
              </div>
            )}
            <div class="next-post-info">
              <div class="next-post-target">
                <Send size={13} />
                <span>@{nextPost.account_username ?? "Любой свободный аккаунт"} • {formatDateTime(nextPost.scheduled_at)}</span>
              </div>
              <div class="next-post-text">
                {nextPost.text || "(Текст отсутствует, только изображение)"}
              </div>
              <div class="next-post-countdown">
                <Clock size={14} />
                <span>Запуск: {relativeTime(nextPost.scheduled_at)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: "1.25rem 0", textAlign: "center", color: "var(--text-muted)" }}>
            <Clock size={36} style={{ opacity: 0.4, marginBottom: "0.5rem" }} />
            <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.92rem" }}>Сейчас нет постов, ожидающих публикации</p>
            <button class="btn btn-secondary btn-sm" onClick={() => onNavigate("queue")}>
              <PlusCircle size={15} />
              <span>Добавить пост в очередь</span>
            </button>
          </div>
        )}
      </div>

      {/* 6. RECENT PUBLICATIONS FEED (Reference 2: Cardy Pay transaction feed) */}
      <div class="card posts-feed-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Недавние публикации Threads</h3>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Успешно размещены в социальной сети Threads
            </span>
          </div>
          <button class="btn btn-secondary btn-sm" onClick={() => onNavigate("logs")}>
            <span>Все посты</span>
            <ChevronRight size={14} />
          </button>
        </div>

        {recentPublished.length > 0 ? (
          <div>
            {recentPublished.slice(0, 5).map((post) => (
              <div key={post.id} class="post-row-item">
                {post.image_url ? (
                  <img src={post.image_url} alt="" class="post-row-thumb" />
                ) : (
                  <div
                    class="post-row-thumb"
                    style={{
                      background: "rgba(255, 255, 255, 0.05)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    <ImageIcon size={20} color="var(--text-muted)" />
                  </div>
                )}

                <div class="post-row-center">
                  <div class="post-row-account">
                    @{post.account_username ?? "Threads"}
                  </div>
                  <div class="post-row-snippet">
                    {post.text || "(Публикация с фото)"}
                  </div>
                </div>

                <div class="post-row-right">
                  <span class="post-row-time">
                    {post.published_at ? relativeTime(post.published_at) : ""}
                  </span>
                  {post.permalink ? (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="btn btn-secondary btn-sm"
                      style={{ padding: "0.3rem 0.75rem", fontSize: "0.78rem", gap: "0.35rem", minHeight: "32px" }}
                    >
                      <ExternalLink size={12} />
                      <span>Threads ↗</span>
                    </a>
                  ) : (
                    <span class="badge badge-success" style={{ fontSize: "0.75rem" }}>
                      Опубликован
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "1.5rem 0", textAlign: "center", color: "var(--text-muted)" }}>
            <p style={{ margin: 0 }}>Пока нет опубликованных постов в этой сессии</p>
          </div>
        )}
      </div>
    </div>
  );
}

