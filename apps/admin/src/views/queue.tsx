import { useCallback, useEffect, useState } from "preact/hooks";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  ImageIcon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  UploadCloud
} from "lucide-preact";
import { api } from "../api";
import type { PostItem, ThreadsAccount } from "../types";

interface QueueProps {
  notify: (msg: string, tone?: "success" | "error" | "info") => void;
}

function formatLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function QueueView({ notify }: QueueProps) {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [accounts, setAccounts] = useState<ThreadsAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");

  // Create Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [text, setText] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [topicTag, setTopicTag] = useState("");
  const [altText, setAltText] = useState("");
  const [publishImmediate, setPublishImmediate] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(() => {
    return formatLocalDatetime(new Date(Date.now() + 60 * 60 * 1000));
  });
  const [uploadedImage, setUploadedImage] = useState<{ filename: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionInProgressId, setActionInProgressId] = useState<string>();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [postsRes, accsRes] = await Promise.all([
        api.getPosts({
          status: statusFilter === "all" ? undefined : statusFilter,
          account_id: accountFilter === "all" ? undefined : accountFilter,
        }),
        api.getAccounts(),
      ]);
      setPosts(postsRes.posts);
      setAccounts(accsRes);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Не удалось загрузить публикации", "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, accountFilter, notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleFileUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      notify("Поддерживаются только изображения JPG, PNG и WebP", "error");
      return;
    }

    setUploading(true);
    try {
      const res = await api.uploadImage(file);
      setUploadedImage({ filename: res.filename, url: res.url });
      notify("Изображение успешно загружено на сервер", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка загрузки файла", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleCreateSubmit = async (e: Event) => {
    e.preventDefault();
    if (!uploadedImage) {
      notify("Пожалуйста, загрузите изображение для публикации (Threads строго требует 1 изображение)", "error");
      return;
    }
    if (text.length > 500) {
      notify("Текст публикации в Threads не может превышать 500 символов", "error");
      return;
    }

    setSubmitting(true);
    try {
      const scheduledIso = publishImmediate
        ? new Date(Date.now() - 1000).toISOString()
        : new Date(scheduledDate).toISOString();

      await api.createPost({
        text,
        image_filename: uploadedImage.filename,
        image_url: uploadedImage.url,
        account_id: selectedAccountId === "all" ? null : selectedAccountId,
        scheduled_at: scheduledIso,
        alt_text: altText.trim() || null,
        topic_tag: topicTag.trim() || null,
      });

      notify(
        selectedAccountId === "all"
          ? "Публикации успешно запланированы для всех активных аккаунтов с задержкой (jitter)!"
          : "Публикация успешно запланирована!",
        "success"
      );

      // Reset
      setText("");
      setUploadedImage(null);
      setTopicTag("");
      setAltText("");
      setModalOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Не удалось создать публикацию", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublishNow = async (post: PostItem) => {
    setActionInProgressId(post.id);
    try {
      const res = await api.publishPostNow(post.id);
      notify(
        res.permalink
          ? `Успешно опубликовано в Threads! Ссылка: ${res.permalink}`
          : "Публикация успешно отправлена в Threads!",
        "success"
      );
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка при немедленной публикации", "error");
    } finally {
      setActionInProgressId(undefined);
    }
  };

  const handleTogglePause = async (post: PostItem) => {
    setActionInProgressId(post.id);
    try {
      const res = await api.togglePostPause(post.id);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, status: res.status } : p)));
      notify(res.status === "paused" ? "Публикация приостановлена" : "Публикация возобновлена", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка при смене статуса", "error");
    } finally {
      setActionInProgressId(undefined);
    }
  };

  const handleDelete = async (post: PostItem) => {
    if (!window.confirm("Удалить эту публикацию из очереди?")) return;
    try {
      await api.deletePost(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      notify("Публикация удалена", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка при удалении", "error");
    }
  };

  const charCount = text.length;
  const isOverLimit = charCount > 500;

  return (
    <div class="view queue-view">
      <header class="view-header">
        <div>
          <span class="eyebrow">Очередь публикаций</span>
          <h1>Публикации Threads</h1>
        </div>
        <div class="header-actions">
          <button class="button button--primary" type="button" onClick={() => setModalOpen(true)}>
            <Plus size={16} />
            Создать публикацию
          </button>
        </div>
      </header>

      {/* Filter Toolbar */}
      <div class="filter-toolbar card">
        <div class="filter-group">
          <label>Статус:</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}>
            <option value="all">Все статусы</option>
            <option value="scheduled">В очереди (запланировано)</option>
            <option value="publishing">Публикуется сейчас</option>
            <option value="published">Опубликовано</option>
            <option value="paused">На паузе</option>
            <option value="failed">Ошибка</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Аккаунт:</label>
          <select value={accountFilter} onChange={(e) => setAccountFilter((e.target as HTMLSelectElement).value)}>
            <option value="all">Все аккаунты</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>@{a.username}</option>
            ))}
          </select>
        </div>

        <button class="button button--secondary button--sm" type="button" onClick={() => void loadData()}>
          <RefreshCw size={14} />
          Обновить
        </button>
      </div>

      {/* Posts List */}
      {loading ? (
        <div class="empty-state">
          <RefreshCw class="spin" size={24} />
          <p>Загрузка очереди публикаций...</p>
        </div>
      ) : posts.length === 0 ? (
        <div class="empty-state card">
          <Send size={40} />
          <h3>Очередь публикаций пуста</h3>
          <p>Создайте новый пост, выберите изображение и укажите аккаунт или пул аккаунтов.</p>
          <button class="button button--primary" type="button" onClick={() => setModalOpen(true)}>
            <Plus size={16} />
            Создать публикацию
          </button>
        </div>
      ) : (
        <div class="posts-list">
          {posts.map((post) => (
            <div key={post.id} class="card post-item-card">
              <div class="post-item__image-thumb">
                <img src={post.image_url} alt="Post attachment" />
              </div>

              <div class="post-item__body">
                <div class="post-item__meta">
                  <span class="post-account">
                    {post.account_username ? `@${post.account_username}` : "Пул всех активных аккаунтов"}
                  </span>
                  <span class="post-time">
                    <Clock size={13} />
                    {new Date(post.scheduled_at).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}
                  </span>
                  <span class={`status-badge status-badge--${post.status}`}>
                    {post.status === "scheduled" && "В очереди"}
                    {post.status === "publishing" && "Публикуется..."}
                    {post.status === "published" && "Опубликовано"}
                    {post.status === "paused" && "На паузе"}
                    {post.status === "failed" && "Ошибка"}
                  </span>
                </div>

                <p class="post-item__text">{post.text || <em class="muted">(Без текста)</em>}</p>

                {post.error_message && (
                  <div class="post-error-banner">
                    <AlertCircle size={14} />
                    <span>{post.error_message}</span>
                  </div>
                )}

                {post.permalink && (
                  <div class="post-permalink-row">
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="permalink-button"
                    >
                      <ExternalLink size={13} />
                      Открыть публикацию в Threads
                    </a>
                  </div>
                )}
              </div>

              <div class="post-item__actions">
                {post.status !== "published" && post.status !== "publishing" && (
                  <button
                    class="button button--primary button--sm"
                    type="button"
                    onClick={() => void handlePublishNow(post)}
                    disabled={actionInProgressId === post.id}
                    title="Опубликовать немедленно"
                  >
                    <Send size={14} />
                    {actionInProgressId === post.id ? "Публикация..." : "Сейчас"}
                  </button>
                )}

                {(post.status === "scheduled" || post.status === "paused") && (
                  <button
                    class="button button--secondary button--sm"
                    type="button"
                    onClick={() => void handleTogglePause(post)}
                    disabled={actionInProgressId === post.id}
                    title={post.status === "paused" ? "Возобновить" : "Поставить на паузу"}
                  >
                    {post.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                )}

                <button
                  class="button button--danger-ghost button--sm"
                  type="button"
                  onClick={() => void handleDelete(post)}
                  title="Удалить пост"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Post Modal */}
      {modalOpen && (
        <div class="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div class="modal-card modal-card--lg" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h2>Создать публикацию Threads</h2>
              <button class="modal-close" onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleCreateSubmit} class="modal-form">
              {/* Image Upload Area */}
              <div class="form-group">
                <label>Изображение (Строго 1 файл: JPG, PNG, WebP) *</label>
                {uploadedImage ? (
                  <div class="image-preview-box">
                    <img src={uploadedImage.url} alt="Preview" class="preview-img" />
                    <div class="image-preview-info">
                      <strong>{uploadedImage.filename}</strong>
                      <span class="preview-url-text">{uploadedImage.url}</span>
                      <button
                        type="button"
                        class="button button--secondary button--sm"
                        onClick={() => setUploadedImage(null)}
                      >
                        Заменить изображение
                      </button>
                    </div>
                  </div>
                ) : (
                  <div class="upload-dropzone">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileUpload}
                      id="image-file-input"
                      disabled={uploading}
                    />
                    <label for="image-file-input" class="dropzone-label">
                      <UploadCloud size={32} />
                      <span>{uploading ? "Загрузка на сервер..." : "Выберите или перетащите изображение"}</span>
                      <small>JPG, PNG или WebP до 20 МБ</small>
                    </label>
                  </div>
                )}
              </div>

              {/* Text Input with Counter */}
              <div class="form-group">
                <div class="label-with-counter">
                  <label>Текст публикации (Threads limit: 500 символов)</label>
                  <span class={`counter-tag ${isOverLimit ? "counter-tag--error" : ""}`}>
                    {charCount} / 500
                  </span>
                </div>
                <textarea
                  rows={4}
                  placeholder="О чём хотите поделиться в Threads?"
                  value={text}
                  onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
                />
                {isOverLimit && (
                  <small class="field-error">Текст превышает допустимый лимит Threads (500 символов).</small>
                )}
              </div>

              {/* Account Selection */}
              <div class="form-group">
                <label>Целевой аккаунт:</label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId((e.target as HTMLSelectElement).value)}
                >
                  <option value="all">
                    ★ Все активные аккаунты (распределить с задержкой / jitter)
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username} {a.is_active ? "" : "(на паузе)"}
                    </option>
                  ))}
                </select>
              </div>

              {/* Timing Options */}
              <div class="form-group">
                <label>Время публикации:</label>
                <div class="radio-row">
                  <label class="radio-label">
                    <input
                      type="radio"
                      name="timing"
                      checked={!publishImmediate}
                      onChange={() => setPublishImmediate(false)}
                    />
                    <span>Запланировать по расписанию</span>
                  </label>
                  <label class="radio-label">
                    <input
                      type="radio"
                      name="timing"
                      checked={publishImmediate}
                      onChange={() => setPublishImmediate(true)}
                    />
                    <span>Опубликовать немедленно</span>
                  </label>
                </div>

                {!publishImmediate && (
                  <div class="datetime-picker-row">
                    <input
                      type="datetime-local"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate((e.target as HTMLInputElement).value)}
                      required
                    />
                    <small>Время по часовому поясу Asia/Almaty (UTC+5)</small>
                  </div>
                )}
              </div>

              {/* Optional Meta Tags */}
              <div class="form-row">
                <div class="form-group">
                  <label>Тег темы (topic_tag, без #)</label>
                  <input
                    type="text"
                    placeholder="Например: design, travel"
                    value={topicTag}
                    onInput={(e) => setTopicTag((e.target as HTMLInputElement).value)}
                  />
                </div>
                <div class="form-group">
                  <label>Alt-текст изображения (для слабовидящих)</label>
                  <input
                    type="text"
                    placeholder="Краткое описание картинки"
                    value={altText}
                    onInput={(e) => setAltText((e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>

              <div class="modal-actions">
                <button class="button button--secondary" type="button" onClick={() => setModalOpen(false)}>
                  Отмена
                </button>
                <button
                  class="button button--primary"
                  type="submit"
                  disabled={submitting || isOverLimit || !uploadedImage}
                >
                  {submitting ? "Создание..." : publishImmediate ? "Опубликовать сейчас" : "Запланировать пост"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
