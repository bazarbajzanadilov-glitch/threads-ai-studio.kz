import { useCallback, useEffect, useState } from "preact/hooks";
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  History,
  RefreshCw
} from "lucide-preact";
import { api } from "../api";
import type { PostItem, SystemEvent } from "../types";

interface LogsProps {
  notify: (msg: string, tone?: "success" | "error" | "info") => void;
}

export function LogsView({ notify }: LogsProps) {
  const [tab, setTab] = useState<"history" | "events">("history");
  const [history, setHistory] = useState<PostItem[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "history") {
        const hData = await api.getHistory();
        setHistory(hData);
      } else {
        const eData = await api.getLogs({
          level: levelFilter === "all" ? undefined : levelFilter,
        });
        setEvents(eData);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Не удалось загрузить данные", "error");
    } finally {
      setLoading(false);
    }
  }, [tab, levelFilter, notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div class="view logs-view">
      <header class="view-header">
        <div>
          <span class="eyebrow">Мониторинг и Аудит</span>
          <h1>История и Журнал событий</h1>
        </div>
        <div class="header-actions">
          <button class="button button--secondary" type="button" onClick={() => void loadData()}>
            <RefreshCw size={15} />
            Обновить
          </button>
        </div>
      </header>

      {/* View Tabs */}
      <div class="subnav-tabs">
        <button
          class={`subnav-tab ${tab === "history" ? "subnav-tab--active" : ""}`}
          onClick={() => setTab("history")}
        >
          <History size={16} />
          История публикаций
        </button>
        <button
          class={`subnav-tab ${tab === "events" ? "subnav-tab--active" : ""}`}
          onClick={() => setTab("events")}
        >
          <FileText size={16} />
          Системный журнал событий
        </button>
      </div>

      {tab === "history" ? (
        <div class="history-section">
          {loading ? (
            <div class="empty-state">
              <RefreshCw class="spin" size={24} />
              <p>Загрузка истории публикаций...</p>
            </div>
          ) : history.length === 0 ? (
            <div class="empty-state card">
              <History size={40} />
              <h3>Пока нет завершённых публикаций</h3>
              <p>Опубликованные или завершившиеся с ошибкой посты появятся в этой ленте.</p>
            </div>
          ) : (
            <div class="history-list">
              {history.map((item) => (
                <div key={item.id} class="card history-card">
                  <div class="history-card__thumb">
                    <img src={item.image_url} alt="Attachment" />
                  </div>

                  <div class="history-card__info">
                    <div class="history-card__header">
                      <span class="history-account">@{item.account_username ?? "Неизвестный аккаунт"}</span>
                      <span class="history-date">
                        {new Date(item.published_at || item.updated_at).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}
                      </span>
                      <span class={`status-badge status-badge--${item.status}`}>
                        {item.status === "published" ? "Опубликовано" : "Ошибка"}
                      </span>
                    </div>

                    <p class="history-card__text">{item.text || <em>(Без текста)</em>}</p>

                    {item.error_message && (
                      <div class="post-error-banner">
                        <AlertTriangle size={14} />
                        <span>{item.error_message}</span>
                      </div>
                    )}

                    {item.permalink && (
                      <div class="history-card__link">
                        <a
                          href={item.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="trantor-threads-btn"
                          title="Открыть пост в Threads"
                        >
                          <span>Threads</span>
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div class="events-section">
          <div class="filter-toolbar card">
            <div class="filter-group">
              <label>Уровень:</label>
              <select value={levelFilter} onChange={(e) => setLevelFilter((e.target as HTMLSelectElement).value)}>
                <option value="all">Все уровни</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div class="empty-state">
              <RefreshCw class="spin" size={24} />
              <p>Загрузка журнала событий...</p>
            </div>
          ) : events.length === 0 ? (
            <div class="empty-state card">
              <FileText size={40} />
              <h3>События отсутствуют</h3>
              <p>Системные операции ещё не зарегистрированы.</p>
            </div>
          ) : (
            <div class="card events-table-wrapper">
              <table class="events-table">
                <thead>
                  <tr>
                    <th>Время (Алматы)</th>
                    <th>Уровень</th>
                    <th>Категория</th>
                    <th>Сообщение</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id} class={`event-row event-row--${ev.level}`}>
                      <td class="event-time">
                        {new Date(ev.created_at).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty" })}
                      </td>
                      <td>
                        <span class={`badge-level badge-level--${ev.level}`}>
                          {ev.level}
                        </span>
                      </td>
                      <td class="event-category">
                        <code>{ev.category}</code>
                      </td>
                      <td class="event-msg">{ev.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
