import { useCallback, useEffect, useState } from "preact/hooks";
import {
  AlertTriangle,
  AtSign,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
  UserX,
  Users
} from "lucide-preact";
import { api } from "../api";
import type { ThreadsAccount } from "../types";

interface AccountsProps {
  notify: (msg: string, tone?: "success" | "error" | "info") => void;
}

export function AccountsView({ notify }: AccountsProps) {
  const [accounts, setAccounts] = useState<ThreadsAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"oauth" | "manual">("manual");
  const [manualToken, setManualToken] = useState("");
  const [manualUsername, setManualUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await api.getAccounts();
      setAccounts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить аккаунты");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const search = window.location.hash.split("?")[1] || window.location.search.slice(1);
    if (search) {
      const params = new URLSearchParams(search);
      if (params.get("connected") === "1") {
        notify("Аккаунт Threads успешно подключен через OAuth!", "success");
        window.location.hash = "#/accounts";
      } else if (params.get("error")) {
        notify(`Ошибка OAuth: ${decodeURIComponent(params.get("error")!)}`, "error");
        window.location.hash = "#/accounts";
      }
    }
  }, [load, notify]);

  const handleToggle = async (account: ThreadsAccount) => {
    try {
      const updated = await api.toggleAccount(account.id);
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      notify(`Аккаунт @${account.username} ${updated.is_active ? "активирован" : "приостановлен"}`, "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка при переключении статуса", "error");
    }
  };

  const handleRefresh = async (account: ThreadsAccount) => {
    setRefreshingId(account.id);
    try {
      await api.refreshAccount(account.id);
      notify(`Токен для @${account.username} успешно обновлён на 60 дней`, "success");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Не удалось обновить токен", "error");
    } finally {
      setRefreshingId(undefined);
    }
  };

  const handleDelete = async (account: ThreadsAccount) => {
    if (!window.confirm(`Удалить подключение @${account.username}?`)) return;
    try {
      await api.deleteAccount(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      notify(`Аккаунт @${account.username} удалён`, "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка при удалении аккаунта", "error");
    }
  };

  const handleManualSubmit = async (e: Event) => {
    e.preventDefault();
    if (!manualToken.trim()) {
      notify("Пожалуйста, введите Access Token", "error");
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.addManualAccount(manualToken.trim(), manualUsername.trim() || undefined);
      setAccounts((prev) => [...prev.filter((a) => a.id !== created.id), created]);
      setManualToken("");
      setManualUsername("");
      setModalOpen(false);
      notify(`Аккаунт @${created.username} успешно подключен!`, "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка при добавлении аккаунта", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOAuthConnect = async () => {
    try {
      const url = await api.getOAuthStartUrl();
      window.location.assign(url);
    } catch (err) {
      notify(err instanceof Error ? err.message : "OAuth не настроен в .env. Используйте ручной ввод токена.", "error");
    }
  };

  const activeCount = accounts.filter((a) => a.is_active).length;

  return (
    <div class="view accounts-view">
      <header class="view-header">
        <div>
          <span class="eyebrow">Мультиаккаунт</span>
          <h1>Подключенные аккаунты Threads</h1>
        </div>
        <div class="header-actions">
          <button class="button button--primary" type="button" onClick={() => setModalOpen(true)}>
            <Plus size={16} />
            Подключить аккаунт
          </button>
        </div>
      </header>

      <div class="stats-bar">
        <div class="stat-pill">
          <Users size={16} />
          <span>Всего аккаунтов: <strong>{accounts.length}</strong></span>
        </div>
        <div class="stat-pill stat-pill--success">
          <UserCheck size={16} />
          <span>Активно: <strong>{activeCount}</strong></span>
        </div>
        <div class="stat-pill stat-pill--warn">
          <UserX size={16} />
          <span>На паузе: <strong>{accounts.length - activeCount}</strong></span>
        </div>
      </div>

      {error && <div class="error-banner">{error}</div>}

      {loading ? (
        <div class="empty-state">
          <RefreshCw class="spin" size={24} />
          <p>Загрузка аккаунтов...</p>
        </div>
      ) : accounts.length === 0 ? (
        <div class="empty-state card">
          <AtSign size={40} />
          <h3>Нет подключенных аккаунтов</h3>
          <p>Подключите аккаунты Threads через OAuth или введите Long-Lived Access Token вручную.</p>
          <button class="button button--primary" type="button" onClick={() => setModalOpen(true)}>
            <Plus size={16} />
            Подключить первый аккаунт
          </button>
        </div>
      ) : (
        <div class="accounts-grid">
          {accounts.map((account) => (
            <div key={account.id} class={`card account-card ${!account.is_active ? "account-card--paused" : ""}`}>
              <div class="account-card__top">
                <div class="account-avatar-wrapper">
                  {account.profile_picture_url ? (
                    <img src={account.profile_picture_url} alt={account.username} class="account-avatar" />
                  ) : (
                    <div class="account-avatar account-avatar--placeholder">
                      <AtSign size={20} />
                    </div>
                  )}
                  <span class={`account-dot ${account.is_active ? "account-dot--active" : "account-dot--paused"}`} />
                </div>
                <div class="account-details">
                  <div class="account-name-row">
                    <h3>@{account.username}</h3>
                    <a
                      href={`https://www.threads.net/@${account.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="external-link"
                      title="Открыть профиль"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>
                  <span class="account-sub">ID: {account.threads_user_id}</span>
                </div>
              </div>

              <div class="account-card__info">
                <div class="info-row">
                  <span class="info-label">Статус:</span>
                  <span class={`status-badge status-badge--${account.is_active ? "active" : "paused"}`}>
                    {account.is_active ? "Активен" : "На паузе"}
                  </span>
                </div>

                <div class="info-row">
                  <span class="info-label">Срок токена:</span>
                  <span class={`token-expiry ${account.days_remaining != null && account.days_remaining < 10 ? "token-expiry--warning" : ""}`}>
                    {account.days_remaining != null ? `${account.days_remaining} дней` : "60 дней"}
                  </span>
                </div>

                {account.last_error && (
                  <div class="account-error-msg">
                    <AlertTriangle size={14} />
                    <span>{account.last_error}</span>
                  </div>
                )}
              </div>

              <div class="account-card__actions">
                <label class="ios-switch">
                  <input
                    type="checkbox"
                    checked={account.is_active}
                    onChange={() => void handleToggle(account)}
                  />
                  <span class="ios-switch-track">
                    <span class="ios-switch-thumb" />
                  </span>
                  <span class="ios-switch-label">{account.is_active ? "Включен" : "На паузе"}</span>
                </label>

                <div class="action-buttons">
                  <button
                    class="button button--ghost"
                    type="button"
                    title="Обновить токен"
                    onClick={() => void handleRefresh(account)}
                    disabled={refreshingId === account.id}
                  >
                    <RefreshCw size={15} class={refreshingId === account.id ? "spin" : ""} />
                  </button>

                  <button
                    class="button button--danger-ghost"
                    type="button"
                    title="Удалить аккаунт"
                    onClick={() => void handleDelete(account)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Account Modal */}
      {modalOpen && (
        <div class="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div class="modal-card" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h2>Подключение аккаунта Threads</h2>
              <button class="modal-close" onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <div class="modal-tabs">
              <button
                class={`modal-tab ${modalMode === "manual" ? "modal-tab--active" : ""}`}
                onClick={() => setModalMode("manual")}
              >
                <KeyRound size={16} />
                Ручной ввод токена
              </button>
              <button
                class={`modal-tab ${modalMode === "oauth" ? "modal-tab--active" : ""}`}
                onClick={() => setModalMode("oauth")}
              >
                <AtSign size={16} />
                Threads OAuth
              </button>
            </div>

            {modalMode === "manual" ? (
              <form onSubmit={handleManualSubmit} class="modal-form">
                <p class="modal-description">
                  Введите Long-Lived Access Token аккаунта Threads. Имя пользователя и аватар загрузятся автоматически.
                </p>

                <div class="form-group">
                  <label>Access Token (Long-Lived) *</label>
                  <textarea
                    rows={4}
                    placeholder="EAA..."
                    value={manualToken}
                    onInput={(e) => setManualToken((e.target as HTMLTextAreaElement).value)}
                    required
                  />
                </div>

                <div class="form-group">
                  <label>Никнейм @username (необязательно)</label>
                  <input
                    type="text"
                    placeholder="Например: my_threads_account"
                    value={manualUsername}
                    onInput={(e) => setManualUsername((e.target as HTMLInputElement).value)}
                  />
                </div>

                <div class="modal-actions">
                  <button class="button button--secondary" type="button" onClick={() => setModalOpen(false)}>
                    Отмена
                  </button>
                  <button class="button button--primary" type="submit" disabled={submitting}>
                    {submitting ? "Проверка..." : "Подключить токен"}
                  </button>
                </div>
              </form>
            ) : (
              <div class="oauth-box">
                <p class="modal-description">
                  Авторизуйтесь через официальное окно входа Meta Threads. После успешного входа токен будет сохранён и автоматически обновляться каждые 60 дней.
                </p>
                <button class="button button--primary button--large" onClick={handleOAuthConnect}>
                  <AtSign size={20} />
                  Войти через Threads
                </button>
                <small class="oauth-hint">Требуется указанный THREADS_APP_ID и THREADS_APP_SECRET в .env файле сервера.</small>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
