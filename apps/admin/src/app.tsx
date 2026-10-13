import { useCallback, useEffect, useState } from "preact/hooks";
import {
  AtSign,
  CalendarClock,
  Clock,
  History,
  LayoutDashboard,
  LayoutList,
  LogOut,
  Send,
  Shield,
  Users
} from "lucide-preact";
import { api } from "./api";
import type { AdminUser } from "./types";
import { DashboardView } from "./views/dashboard";
import { AccountsView } from "./views/accounts";
import { QueueView } from "./views/queue";
import { ScheduleView } from "./views/schedule";
import { LogsView } from "./views/logs";
import { LoginView } from "./views/login";

type Tab = "dashboard" | "accounts" | "queue" | "schedule" | "logs";

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}

function tabFromHash(): Tab {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash === "dashboard" || hash === "accounts" || hash === "queue" || hash === "schedule" || hash === "logs") {
    return hash;
  }
  return "dashboard";
}

function almatyClock(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

export function App() {
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>(tabFromHash);
  const [clock, setClock] = useState(almatyClock);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((message: string, tone: "success" | "error" | "info" = "info") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Check existing session
  useEffect(() => {
    let mounted = true;
    api
      .getMe()
      .then((res) => {
        if (mounted) setCurrentUser(res.user);
      })
      .catch(() => {
        if (mounted) setCurrentUser(null);
      })
      .finally(() => {
        if (mounted) setAuthChecking(false);
      });

    const handleAuthExpired = () => {
      setCurrentUser(null);
      notify("Сессия завершена. Пожалуйста, выполните вход заново.", "info");
    };
    window.addEventListener("auth:expired", handleAuthExpired);

    return () => {
      mounted = false;
      window.removeEventListener("auth:expired", handleAuthExpired);
    };
  }, [notify]);

  // Clock tick
  useEffect(() => {
    const interval = setInterval(() => setClock(almatyClock()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Hash route change
  useEffect(() => {
    const handleHash = () => setActiveTab(tabFromHash());
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    window.location.hash = `#/${tab}`;
  };

  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
    notify("Вы вышли из системы", "info");
  };

  if (authChecking) {
    return (
      <div class="app-loading-screen">
        <div class="brand-glyph spin">
          <AtSign size={36} />
        </div>
        <p>Инициализация Threads Auto-Publisher...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginView onSuccess={setCurrentUser} notify={notify} />
        <div class="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} class={`toast toast--${toast.tone}`}>
              {toast.message}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div class="app-layout">
      {/* Top Navbar */}
      <header class="app-topbar">
        <div class="topbar-left">
          <div class="topbar-brand">
            <span class="brand-logo">
              <AtSign size={20} />
            </span>
            <span class="brand-title">Threads Auto-Publisher</span>
          </div>

          <nav class="topbar-nav">
            <button
              class={`nav-item ${activeTab === "dashboard" ? "nav-item--active" : ""}`}
              onClick={() => switchTab("dashboard")}
            >
              <LayoutDashboard size={16} />
              <span>Главная</span>
            </button>

            <button
              class={`nav-item ${activeTab === "accounts" ? "nav-item--active" : ""}`}
              onClick={() => switchTab("accounts")}
            >
              <Users size={16} />
              <span>Аккаунты</span>
            </button>

            <button
              class={`nav-item ${activeTab === "queue" ? "nav-item--active" : ""}`}
              onClick={() => switchTab("queue")}
            >
              <Send size={16} />
              <span>Публикации / Очередь</span>
            </button>

            <button
              class={`nav-item ${activeTab === "schedule" ? "nav-item--active" : ""}`}
              onClick={() => switchTab("schedule")}
            >
              <CalendarClock size={16} />
              <span>Расписание & Задержки</span>
            </button>

            <button
              class={`nav-item ${activeTab === "logs" ? "nav-item--active" : ""}`}
              onClick={() => switchTab("logs")}
            >
              <History size={16} />
              <span>История & Журнал</span>
            </button>
          </nav>
          <div class="mobile-greeting">
            <div class="mobile-avatar">Б</div>
            <div class="mobile-greeting-info">
              <span class="mobile-greeting-sub">Добро пожаловать,</span>
              <span class="mobile-greeting-name">Базарбай 👋</span>
            </div>
          </div>
        </div>

        <div class="topbar-right">
          <div class="almaty-clock-pill">
            <Clock size={14} />
            <span>Алматы: <strong>{clock}</strong></span>
          </div>

          <div class="user-pill">
            <Shield size={14} />
            <span class="user-email">{currentUser.email}</span>
          </div>

          <button class="button button--ghost button--sm" type="button" onClick={handleLogout} title="Выйти">
            <LogOut size={16} />
            <span class="logout-label">Выход</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main class="app-main">
        {activeTab === "dashboard" && <DashboardView notify={notify} onNavigate={switchTab} />}
        {activeTab === "accounts" && <AccountsView notify={notify} />}
        {activeTab === "queue" && <QueueView notify={notify} />}
        {activeTab === "schedule" && <ScheduleView notify={notify} />}
        {activeTab === "logs" && <LogsView notify={notify} />}
      </main>

      {/* Mobile Floating Bottom Dock (inspired by reference designs) */}
      <nav class="mobile-dock-nav" aria-label="Мобильная навигация">
        <button
          class={`dock-item ${activeTab === "dashboard" ? "dock-item--active" : ""}`}
          onClick={() => switchTab("dashboard")}
          title="Главная"
        >
          <LayoutDashboard size={20} />
          <span class="dock-label">Главная</span>
        </button>

        <button
          class={`dock-item ${activeTab === "accounts" ? "dock-item--active" : ""}`}
          onClick={() => switchTab("accounts")}
          title="Аккаунты"
        >
          <Users size={20} />
          <span class="dock-label">Аккаунты</span>
        </button>

        {/* Hero Center Button for New Post */}
        <button
          class="dock-item dock-item--center"
          onClick={() => switchTab("queue")}
          title="Создать пост"
        >
          <div class="dock-center-circle">
            <Send size={20} />
          </div>
          <span class="dock-label">+ Пост</span>
        </button>

        <button
          class={`dock-item ${activeTab === "schedule" ? "dock-item--active" : ""}`}
          onClick={() => switchTab("schedule")}
          title="Расписание"
        >
          <CalendarClock size={20} />
          <span class="dock-label">График</span>
        </button>

        <button
          class={`dock-item ${activeTab === "logs" ? "dock-item--active" : ""}`}
          onClick={() => switchTab("logs")}
          title="Журнал"
        >
          <History size={20} />
          <span class="dock-label">Логи</span>
        </button>
      </nav>

      {/* Toasts */}
      <div class="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} class={`toast toast--${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
