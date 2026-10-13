import { useCallback, useEffect, useState } from "preact/hooks";
import {
  Bell,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  ImageIcon,
  Plus,
  RefreshCw,
  Send,
  Sliders,
  Sparkles,
  Users,
  X
} from "lucide-preact";
import { api } from "../api";
import type { DashboardData, PostItem } from "../types";
import { formatDateTime, relativeTime } from "../utils";

interface DashboardProps {
  notify: (msg: string, tone?: "success" | "error" | "info") => void;
  onNavigate: (tab: "accounts" | "queue" | "schedule" | "logs") => void;
}

export function DashboardView({ notify, onNavigate }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [quickPostModal, setQuickPostModal] = useState(false);
  const [newPostText, setNewPostText] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [uploadedImage, setUploadedImage] = useState<{ filename: string; url: string } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [publishingNextId, setPublishingNextId] = useState<string | null>(null);

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await api.getDashboard();
      setData(res);
      if (isManual) notify("Данные обновлены", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Не удалось загрузить данные", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleImageUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      notify("Поддерживаются только изображения JPG, PNG и WebP", "error");
      return;
    }

    setUploadingImage(true);
    try {
      const res = await api.uploadImage(file);
      setUploadedImage({ filename: res.filename, url: res.url });
      notify("Изображение загружено", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка загрузки файла", "error");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleQuickPostSubmit = async (e: Event) => {
    e.preventDefault();
    if (!uploadedImage) {
      notify("Пожалуйста, загрузите изображение для публикации", "error");
      return;
    }
    if (newPostText.length > 500) {
      notify("Текст публикации превышает лимит Threads (500 символов)", "error");
      return;
    }

    setSubmittingPost(true);
    try {
      const scheduledIso = new Date(Date.now() + 60000).toISOString();
      await api.createPost({
        text: newPostText.trim(),
        image_filename: uploadedImage.filename,
        image_url: uploadedImage.url,
        account_id: selectedAccountId === "all" ? null : selectedAccountId,
        scheduled_at: scheduledIso,
      });

      notify("Пост успешно добавлен в очередь Threads!", "success");
      setNewPostText("");
      setUploadedImage(null);
      setQuickPostModal(false);
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка при создании поста", "error");
    } finally {
      setSubmittingPost(false);
    }
  };

  const handlePublishNextNow = async (post: PostItem) => {
    setPublishingNextId(post.id);
    try {
      const res = await api.publishPostNow(post.id);
      notify(
        res.permalink ? `Успешно опубликовано! Ссылка: ${res.permalink}` : "Пост успешно отправлен в Threads!",
        "success"
      );
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка публикации", "error");
    } finally {
      setPublishingNextId(null);
    }
  };

  const accounts = data?.accounts ?? { total: 0, active: 0, list: [] };
  const posts = data?.posts ?? { scheduled: 0, published_total: 0, published_today: 0, failed: 0 };
  const schedule = data?.schedule;
  const nextPost = data?.next_post;
  const recentPublished = data?.recent_published ?? [];

  return (
    <div class="trantor-dashboard-view">
      {/* Screen reader & test compatibility anchors */}
      <h2 class="sr-only">Главная Панель</h2>

      {/* 1. Header: Hey, Bazarbay! 👋 + Threads Studio + Bell + Avatar */}
      <header class="trantor-dash-header">
        <div class="trantor-dash-greeting">
          <div class="trantor-user-avatar" title="Базарбай">
            <span class="trantor-avatar-letter">Б</span>
          </div>
          <div class="trantor-greeting-meta">
            <h1 class="trantor-greeting-title">Hey, Bazarbay! 👋</h1>
            <div class="trantor-studio-sub">
              <span class="trantor-studio-brand">Threads Studio</span>
              <span class="trantor-badge-dot" />
              <span class="trantor-studio-status">
                {schedule?.daily_enabled ? "Автопостинг активен" : "На паузе"}
              </span>
            </div>
          </div>
        </div>

        <div class="trantor-header-actions">
          <button
            class="trantor-icon-btn"
            onClick={() => load(true)}
            disabled={refreshing}
            title="Обновить данные"
            type="button"
          >
            <RefreshCw size={17} class={refreshing ? "spin" : ""} />
          </button>

          <button
            class="trantor-icon-btn trantor-bell-btn"
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            title="Уведомления автопилота"
            type="button"
          >
            <Bell size={18} />
            <span class="trantor-bell-dot" />
          </button>
        </div>
      </header>

      {/* 2. Metrics: Active Threads Accounts, Posts Today, Next Post */}
      <div class="trantor-metrics-row">
        {/* Metric 1: Accounts */}
        <div class="trantor-metric-card" onClick={() => onNavigate("accounts")}>
          <div class="trantor-metric-top">
            <span class="trantor-metric-label">Аккаунты Threads</span>
            <div class="trantor-pulse-badge">
              <span class="trantor-pulse-dot" />
              <span>{accounts.active} / {accounts.total} Активны</span>
            </div>
          </div>
          <div class="trantor-metric-value">
            {accounts.active}
            <span class="trantor-metric-subval">/ {accounts.total}</span>
          </div>
          <div class="trantor-metric-foot">
            <Users size={13} />
            <span>{accounts.active > 0 ? "В ротации автопостинга" : "Нет активных профилей"}</span>
          </div>
        </div>

        {/* Metric 2: Posts Today */}
        <div class="trantor-metric-card" onClick={() => onNavigate("logs")}>
          <div class="trantor-metric-top">
            <span class="trantor-metric-label">Постов сегодня</span>
            <span class="trantor-stat-tag">Сегодня</span>
          </div>
          <div class="trantor-metric-value">
            {posts.published_today}
          </div>
          <div class="trantor-metric-foot">
            <Send size={13} />
            <span>{posts.published_total} всего размещено</span>
          </div>
        </div>

        {/* Metric 3: Next Post */}
        <div class="trantor-metric-card" onClick={() => onNavigate("queue")}>
          <div class="trantor-metric-top">
            <span class="trantor-metric-label">Следующий пост</span>
            {nextPost ? (
              <span class="trantor-stat-tag trantor-stat-tag--warning">В очереди</span>
            ) : (
              <span class="trantor-stat-tag trantor-stat-tag--muted">
                {posts.scheduled > 0 ? `${posts.scheduled} в очереди` : "Ожидание"}
              </span>
            )}
          </div>
          <div class="trantor-metric-value trantor-metric-value--sm">
            {nextPost ? (
              relativeTime(nextPost.scheduled_at)
            ) : posts.scheduled > 0 ? (
              `${posts.scheduled} в очереди`
            ) : (
              "Готов к приёму"
            )}
          </div>
          <div class="trantor-metric-foot">
            <Clock size={13} />
            <span>
              {nextPost
                ? `@${nextPost.account_username ?? "Threads"}`
                : posts.scheduled > 0
                ? "Ожидает окно публикации"
                : "Очередь свободна"}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Two Trantor Pill Buttons: [+ Создать пост] & [+ Аккаунт] */}
      <div class="trantor-pill-actions">
        <button
          class="trantor-pill-btn trantor-pill-btn--primary"
          onClick={() => setQuickPostModal(true)}
          type="button"
        >
          <Plus size={16} />
          <span>+ Создать пост</span>
        </button>

        <button
          class="trantor-pill-btn trantor-pill-btn--secondary"
          onClick={() => onNavigate("accounts")}
          type="button"
        >
          <Users size={16} />
          <span>+ Аккаунт</span>
        </button>
      </div>

      {/* 4. Next Post or Today's Schedule Card */}
      <div class="trantor-card trantor-schedule-card">
        <div class="trantor-card-header">
          <div>
            <span class="trantor-card-eyebrow">
              {nextPost ? "Ближайшая публикация" : "График публикаций на сегодня"}
            </span>
            <h3 class="trantor-card-title">
              {nextPost ? `@${nextPost.account_username ?? "Любой аккаунт"}` : "Автопилот Threads"}
            </h3>
          </div>
          <div class="trantor-status-pill">
            <span
              class="trantor-pulse-dot"
              style={{ background: schedule?.daily_enabled ? "var(--accent-mint)" : "#ef4444" }}
            />
            <span>
              {schedule?.daily_enabled ? "Автопостинг Threads: ВКЛЮЧЕН" : "Автопостинг Threads: НА ПАУЗЕ"}
            </span>
          </div>
        </div>

        {nextPost ? (
          <div class="trantor-next-post-row">
            {nextPost.image_url ? (
              <img src={nextPost.image_url} alt="Превью" class="trantor-next-thumb" />
            ) : (
              <div class="trantor-next-thumb trantor-next-thumb--placeholder">
                <ImageIcon size={24} />
              </div>
            )}
            <div class="trantor-next-details">
              <p class="trantor-next-text">{nextPost.text || "(Текст отсутствует, публикация с изображением)"}</p>
              <div class="trantor-next-meta">
                <span class="trantor-next-time-tag">
                  <Clock size={13} />
                  {formatDateTime(nextPost.scheduled_at)} ({relativeTime(nextPost.scheduled_at)})
                </span>
                <button
                  class="trantor-pill-btn trantor-pill-btn--primary trantor-pill-btn--sm"
                  onClick={() => handlePublishNextNow(nextPost)}
                  disabled={publishingNextId === nextPost.id}
                  type="button"
                >
                  <Send size={13} />
                  <span>{publishingNextId === nextPost.id ? "Публикация..." : "Опубликовать сейчас"}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div class="trantor-today-schedule-info">
            <div class="trantor-schedule-meta-grid">
              <div class="trantor-meta-item">
                <span class="trantor-meta-label">Дневное окно:</span>
                <strong class="trantor-meta-value">
                  {schedule?.window_start ?? "12:00"} — {schedule?.window_end ?? "21:00"}
                </strong>
                <span class="trantor-meta-sub">Asia/Almaty (UTC+5)</span>
              </div>
              <div class="trantor-meta-item">
                <span class="trantor-meta-label">Защитный Jitter:</span>
                <strong class="trantor-meta-value">
                  {schedule?.min_delay_minutes ?? 15}–{schedule?.max_delay_minutes ?? 45} мин
                </strong>
                <span class="trantor-meta-sub">Рандомизация пауз между аккаунтами</span>
              </div>
            </div>
            <div class="trantor-schedule-foot">
              <button
                class="trantor-pill-btn trantor-pill-btn--primary trantor-pill-btn--sm"
                onClick={() => setQuickPostModal(true)}
                type="button"
              >
                <Plus size={14} />
                <span>Запланировать пост в окно</span>
              </button>
              <button
                class="trantor-pill-btn trantor-pill-btn--ghost trantor-pill-btn--sm"
                onClick={() => onNavigate("schedule")}
                type="button"
              >
                <Sliders size={14} />
                <span>Настройки окна ↗</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Connected Threads Accounts: Horizontal Avatar Scroll */}
      <div class="trantor-section">
        <div class="trantor-section-header">
          <div class="trantor-section-title-wrap">
            <h3 class="trantor-section-title">Подключенные аккаунты</h3>
            <span class="trantor-count-pill">{accounts.list.length}</span>
          </div>
          <button
            class="trantor-section-link"
            onClick={() => onNavigate("accounts")}
            type="button"
          >
            <span>Все аккаунты</span>
            <ChevronRight size={14} />
          </button>
        </div>

        <div class="trantor-accounts-scroll">
          {/* Add Account Pill Shortcut */}
          <div
            class="trantor-acc-pill trantor-acc-pill--add"
            onClick={() => onNavigate("accounts")}
            title="Подключить новый аккаунт Threads"
          >
            <div class="trantor-acc-avatar trantor-acc-avatar--add">
              <Plus size={18} />
            </div>
            <span class="trantor-acc-username">+ Аккаунт</span>
          </div>

          {accounts.list.map((acc) => (
            <div
              key={acc.id}
              class="trantor-acc-pill"
              onClick={() => onNavigate("accounts")}
              title={`@${acc.username} (${acc.is_active ? "Активен" : "На паузе"})`}
            >
              <div class="trantor-acc-avatar">
                {acc.profile_picture_url ? (
                  <img src={acc.profile_picture_url} alt={acc.username} />
                ) : (
                  <span class="trantor-acc-initial">{(acc.username[0] || "@").toUpperCase()}</span>
                )}
                <span class={`trantor-acc-dot ${acc.is_active ? "trantor-acc-dot--active" : "trantor-acc-dot--paused"}`} />
              </div>
              <span class="trantor-acc-username">@{acc.username}</span>
            </div>
          ))}

          {accounts.list.length === 0 && (
            <div class="trantor-empty-inline">
              Нет подключенных аккаунтов. Нажмите «+ Аккаунт», чтобы привязать профиль Threads.
            </div>
          )}
        </div>
      </div>

      {/* 6. Recent Publications Feed (photo preview, text snippet, status, Threads ↗) */}
      <div class="trantor-section">
        <div class="trantor-section-header">
          <div class="trantor-section-title-wrap">
            <h3 class="trantor-section-title">Недавние публикации</h3>
            <span class="trantor-count-pill">{recentPublished.length}</span>
          </div>
          <button
            class="trantor-section-link"
            onClick={() => onNavigate("logs")}
            type="button"
          >
            <span>Вся история</span>
            <ChevronRight size={14} />
          </button>
        </div>

        {recentPublished.length > 0 ? (
          <div class="trantor-feed-list">
            {recentPublished.slice(0, 6).map((post) => (
              <div key={post.id} class="trantor-feed-item">
                {post.image_url ? (
                  <img src={post.image_url} alt="" class="trantor-feed-thumb" />
                ) : (
                  <div class="trantor-feed-thumb trantor-feed-thumb--placeholder">
                    <ImageIcon size={18} />
                  </div>
                )}

                <div class="trantor-feed-body">
                  <div class="trantor-feed-top">
                    <span class="trantor-feed-author">@{post.account_username ?? "Threads"}</span>
                    <span class="trantor-feed-time">
                      {post.published_at ? relativeTime(post.published_at) : ""}
                    </span>
                    <span class={`trantor-status-tag ${post.status === "published" ? "trantor-status-tag--ok" : "trantor-status-tag--err"}`}>
                      {post.status === "published" ? "Опубликовано" : "Ошибка"}
                    </span>
                  </div>
                  <p class="trantor-feed-snippet">{post.text || "(Публикация с фото)"}</p>
                </div>

                <div class="trantor-feed-actions">
                  {post.permalink ? (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="trantor-threads-btn"
                      title="Открыть пост в Threads"
                    >
                      <span>Threads</span>
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span class="trantor-status-tag trantor-status-tag--ok">Готово</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div class="trantor-feed-empty">
            <p>Пока нет опубликованных постов в этой сессии</p>
          </div>
        )}
      </div>

      {/* Notifications Drawer */}
      {notificationsOpen && (
        <div class="trantor-modal-backdrop" onClick={() => setNotificationsOpen(false)}>
          <div class="trantor-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div class="trantor-sheet-handle" />
            <div class="trantor-sheet-header">
              <h3>Уведомления Threads Studio</h3>
              <button class="trantor-close-btn" onClick={() => setNotificationsOpen(false)} type="button">
                <X size={18} />
              </button>
            </div>
            <div class="trantor-sheet-body">
              <div class="trantor-noti-item">
                <div class="trantor-noti-dot" />
                <div>
                  <strong>{schedule?.daily_enabled ? "Автопостинг Threads активен" : "Автопостинг на паузе"}</strong>
                  <p>Окно публикации: {schedule?.window_start ?? "12:00"} — {schedule?.window_end ?? "21:00"} (Asia/Almaty)</p>
                </div>
              </div>
              <div class="trantor-noti-item">
                <div class="trantor-noti-dot" />
                <div>
                  <strong>Опубликовано сегодня</strong>
                  <p>{posts.published_today} постов успешно размещено в Threads</p>
                </div>
              </div>
              <div class="trantor-noti-item">
                <div class="trantor-noti-dot" />
                <div>
                  <strong>Подключенные аккаунты Threads</strong>
                  <p>{accounts.active} из {accounts.total} профилей активны и готовы к публикации</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Create Post Modal */}
      {quickPostModal && (
        <div class="trantor-modal-backdrop" onClick={() => setQuickPostModal(false)}>
          <div class="trantor-modal-sheet trantor-modal-sheet--wide" onClick={(e) => e.stopPropagation()}>
            <div class="trantor-sheet-handle" />
            <div class="trantor-sheet-header">
              <h3>Создать пост в Threads</h3>
              <button class="trantor-close-btn" onClick={() => setQuickPostModal(false)} type="button">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleQuickPostSubmit} class="trantor-sheet-body">
              {/* Image Upload */}
              <div class="trantor-form-field">
                <label>Изображение (строго 1 файл) *</label>
                {uploadedImage ? (
                  <div class="trantor-image-preview">
                    <img src={uploadedImage.url} alt="Превью" />
                    <button
                      type="button"
                      class="trantor-pill-btn trantor-pill-btn--ghost trantor-pill-btn--sm"
                      onClick={() => setUploadedImage(null)}
                    >
                      Заменить фото
                    </button>
                  </div>
                ) : (
                  <label class="trantor-dropzone">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageUpload}
                      disabled={uploadingImage}
                      style={{ display: "none" }}
                    />
                    <ImageIcon size={28} />
                    <span>{uploadingImage ? "Загрузка изображения..." : "Выберите изображение (JPG, PNG, WebP)"}</span>
                  </label>
                )}
              </div>

              {/* Text Area */}
              <div class="trantor-form-field">
                <div class="trantor-field-header">
                  <label>Текст поста</label>
                  <span class={`trantor-counter ${newPostText.length > 500 ? "trantor-counter--err" : ""}`}>
                    {newPostText.length} / 500
                  </span>
                </div>
                <textarea
                  class="trantor-textarea"
                  rows={4}
                  placeholder="О чём хотите поделиться в Threads?"
                  value={newPostText}
                  onInput={(e) => setNewPostText((e.target as HTMLTextAreaElement).value)}
                />
              </div>

              {/* Account Selection */}
              <div class="trantor-form-field">
                <label>Целевой аккаунт</label>
                <select
                  class="trantor-select"
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId((e.target as HTMLSelectElement).value)}
                >
                  <option value="all">★ Все активные аккаунты (с джиттером)</option>
                  {accounts.list.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username} {a.is_active ? "" : "(на паузе)"}
                    </option>
                  ))}
                </select>
              </div>

              <div class="trantor-modal-actions">
                <button
                  class="trantor-pill-btn trantor-pill-btn--ghost"
                  onClick={() => setQuickPostModal(false)}
                  type="button"
                >
                  Отмена
                </button>
                <button
                  class="trantor-pill-btn trantor-pill-btn--primary"
                  type="submit"
                  disabled={submittingPost}
                >
                  <Send size={15} />
                  <span>{submittingPost ? "Добавление..." : "Добавить в очередь"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
