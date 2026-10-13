import { useCallback, useEffect, useState } from "preact/hooks";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  HelpCircle,
  RefreshCw,
  Save,
  Shuffle,
  Sliders,
  Sparkles
} from "lucide-preact";
import { api } from "../api";
import type { JitterSlot, ScheduleSettings } from "../types";

interface ScheduleProps {
  notify: (msg: string, tone?: "success" | "error" | "info") => void;
}

export function ScheduleView({ notify }: ScheduleProps) {
  const [settings, setSettings] = useState<ScheduleSettings>({
    window_start: "11:00",
    window_end: "21:00",
    timezone: "Asia/Almaty",
    min_delay_minutes: 15,
    max_delay_minutes: 40,
    randomize_delay: 1,
    daily_enabled: 1,
    updated_at: new Date().toISOString(),
  });

  const [slots, setSlots] = useState<JitterSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sData, pData] = await Promise.all([
        api.getScheduleSettings(),
        api.getSchedulePreview(),
      ]);
      setSettings(sData);
      setSlots(pData);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Не удалось загрузить настройки расписания", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSave = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateScheduleSettings({
        window_start: settings.window_start,
        window_end: settings.window_end,
        min_delay_minutes: Number(settings.min_delay_minutes),
        max_delay_minutes: Number(settings.max_delay_minutes),
        randomize_delay: Boolean(settings.randomize_delay),
        daily_enabled: Boolean(settings.daily_enabled),
      });
      setSettings(updated);
      notify("Настройки расписания и задержек успешно сохранены!", "success");

      // Refresh slots
      const pData = await api.getSchedulePreview();
      setSlots(pData);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Ошибка сохранения настроек", "error");
    } finally {
      setSaving(false);
    }
  };

  const refreshPreview = async () => {
    setPreviewLoading(true);
    try {
      const pData = await api.getSchedulePreview();
      setSlots(pData);
      notify("Сформирован новый случайный график задержек", "info");
    } catch (err) {
      notify("Не удалось обновить график", "error");
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div class="view schedule-view">
      <header class="view-header">
        <div>
          <span class="eyebrow">Авто-публикация и Анти-спам защита</span>
          <h1>Расписание и Задержки (Jitter)</h1>
          <p>
            Настройка дневного окна публикаций и случайных пауз между постами разных аккаунтов для полной защиты от спам-фильтров Meta.
          </p>
        </div>
      </header>

      <div class="schedule-grid">
        {/* Settings Form Card */}
        <div class="card schedule-form-card">
          <div class="card-title-row">
            <Sliders size={20} />
            <h2>Параметры публикаций</h2>
          </div>

          <form onSubmit={handleSave} class="schedule-form">
            <div class="form-section">
              <h3>Дневное окно публикаций</h3>
              <p class="form-hint">В это время сервер распределяет публикации по активным аккаунтам.</p>

              <div class="form-row">
                <div class="form-group">
                  <label>Начало окна:</label>
                  <input
                    type="time"
                    value={settings.window_start}
                    onInput={(e) => setSettings({ ...settings, window_start: (e.target as HTMLInputElement).value })}
                    required
                  />
                </div>
                <div class="form-group">
                  <label>Конец окна:</label>
                  <input
                    type="time"
                    value={settings.window_end}
                    onInput={(e) => setSettings({ ...settings, window_end: (e.target as HTMLInputElement).value })}
                    required
                  />
                </div>
              </div>

              <div class="timezone-badge">
                <Clock size={14} />
                <span>Часовой пояс: <strong>Asia/Almaty (UTC+5)</strong></span>
              </div>
            </div>

            <div class="form-section">
              <h3>Интервалы и Задержки между аккаунтами (Jitter)</h3>
              <p class="form-hint">Случайная задержка защищает аккаунты от одновременной подозрительной активности.</p>

              <div class="form-row">
                <div class="form-group">
                  <label>Минимальная пауза (мин):</label>
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={settings.min_delay_minutes}
                    onInput={(e) => setSettings({ ...settings, min_delay_minutes: Number((e.target as HTMLInputElement).value) })}
                    required
                  />
                </div>
                <div class="form-group">
                  <label>Максимальная пауза (мин):</label>
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={settings.max_delay_minutes}
                    onInput={(e) => setSettings({ ...settings, max_delay_minutes: Number((e.target as HTMLInputElement).value) })}
                    required
                  />
                </div>
              </div>

              <div class="checkbox-group">
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.randomize_delay)}
                    onChange={(e) => setSettings({ ...settings, randomize_delay: (e.target as HTMLInputElement).checked })}
                  />
                  <div>
                    <strong>Включить случайный разброс (Random Jitter)</strong>
                    <small>Каждый пост будет отправляться с непредсказуемой паузой в диапазоне {settings.min_delay_minutes}–{settings.max_delay_minutes} мин.</small>
                  </div>
                </label>

                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.daily_enabled)}
                    onChange={(e) => setSettings({ ...settings, daily_enabled: (e.target as HTMLInputElement).checked })}
                  />
                  <div>
                    <strong>Автоматический планировщик включен</strong>
                    <small>Фоновый процесс регулярно проверяет очередь и публикует посты.</small>
                  </div>
                </label>
              </div>
            </div>

            <button class="button button--primary button--large" type="submit" disabled={saving}>
              <Save size={18} />
              {saving ? "Сохранение..." : "Сохранить настройки"}
            </button>
          </form>
        </div>

        {/* Timeline Preview Card */}
        <div class="card timeline-preview-card">
          <div class="card-title-row">
            <div class="title-with-badge">
              <CalendarClock size={20} />
              <h2>График распределения на сегодня</h2>
            </div>
            <button
              class="button button--secondary button--sm"
              type="button"
              onClick={() => void refreshPreview()}
              disabled={previewLoading}
            >
              <Shuffle size={14} class={previewLoading ? "spin" : ""} />
              Пересчитать джиттер
            </button>
          </div>

          <p class="card-description">
            Моделирование времени отправки постов для активных аккаунтов на основе окна с <strong>{settings.window_start}</strong> по <strong>{settings.window_end}</strong> и пауз <strong>{settings.min_delay_minutes}–{settings.max_delay_minutes} мин</strong>.
          </p>

          {slots.length === 0 ? (
            <div class="empty-state">
              <p>Нет слотов для отображения. Подключите активные аккаунты.</p>
            </div>
          ) : (
            <div class="timeline-slot-list">
              {slots.map((slot, index) => (
                <div key={slot.index} class="timeline-slot-item">
                  <div class="slot-marker">
                    <span class="slot-number">{index + 1}</span>
                    {index < slots.length - 1 && <span class="slot-connector" />}
                  </div>

                  <div class="slot-content">
                    <div class="slot-time-row">
                      <strong class="slot-time">{slot.timeFormatted}</strong>
                      {slot.delayMinutes > 0 && (
                        <span class="slot-delay-tag">+{slot.delayMinutes} мин задержка</span>
                      )}
                    </div>
                    <span class="slot-account-name">@{slot.account_username}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
