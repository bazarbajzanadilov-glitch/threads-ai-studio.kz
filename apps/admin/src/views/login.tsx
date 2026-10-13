import { useState } from "preact/hooks";
import { AtSign, KeyRound, Lock, LogIn, Mail, ShieldCheck } from "lucide-preact";
import { api } from "../api";
import type { AdminUser } from "../types";

interface LoginProps {
  onSuccess: (user: AdminUser) => void;
  notify: (msg: string, tone?: "success" | "error" | "info") => void;
}

export function LoginView({ onSuccess, notify }: LoginProps) {
  const [email, setEmail] = useState("bazarbajzanadilov@gmail.com");
  const [password, setPassword] = useState("admin_master_secret_2026");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      const res = await api.login(email.trim(), password);
      notify(`Добро пожаловать, ${res.user.email}!`, "success");
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неверный email или секретный пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="login-page">
      <div class="login-card card">
        <div class="login-brand">
          <div class="brand-glyph">
            <AtSign size={36} />
          </div>
          <h1>Threads Auto-Publisher</h1>
          <p>Вход в панель управления авто-публикациями</p>
        </div>

        {error && <div class="error-banner">{error}</div>}

        <form onSubmit={handleSubmit} class="login-form">
          <div class="form-group">
            <label>
              <Mail size={14} />
              Email администратора:
            </label>
            <input
              type="email"
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              required
            />
            <div class="quick-admin-chips">
              <button
                type="button"
                class="chip-button"
                onClick={() => setEmail("bazarbajzanadilov@gmail.com")}
              >
                bazarbajzanadilov@gmail.com
              </button>
              <button
                type="button"
                class="chip-button"
                onClick={() => setEmail("reli.sheets1@gmail.com")}
              >
                reli.sheets1@gmail.com
              </button>
            </div>
          </div>

          <div class="form-group">
            <label>
              <Lock size={14} />
              Секретный пароль сессии (SESSION_SECRET):
            </label>
            <input
              type="password"
              value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              required
            />
          </div>

          <button class="button button--primary button--large button--full" type="submit" disabled={loading}>
            <LogIn size={18} />
            {loading ? "Авторизация..." : "Войти в панель"}
          </button>
        </form>

        <div class="login-footer">
          <ShieldCheck size={14} />
          <span>Защищённая сессия сервера (Linux VPS 89.207.249.39)</span>
        </div>
      </div>
    </div>
  );
}
