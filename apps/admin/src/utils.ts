import type { ContentFormat, ContentState, Platform } from "./types";

export const ALMATY_TIME_ZONE = "Asia/Almaty";

export const platformLabel: Record<Platform, string> = {
  threads: "Threads",
};

export const formatLabel: Record<ContentFormat, string> = {
  image: "Текст + 1 Изображение",
};

export const stateLabel: Record<ContentState, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  publishing: "Публикуется",
  published: "Опубликован",
  paused: "На паузе",
  failed: "Ошибка",
};

export const stateTone: Record<ContentState, "neutral" | "positive" | "warning" | "danger" | "progress"> = {
  draft: "neutral",
  scheduled: "positive",
  publishing: "progress",
  published: "positive",
  paused: "neutral",
  failed: "danger",
};

const fullDateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: ALMATY_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const shortTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: ALMATY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const shortDay = new Intl.DateTimeFormat("ru-RU", {
  timeZone: ALMATY_TIME_ZONE,
  day: "numeric",
  month: "short",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : fullDateTime.format(date);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : shortTime.format(date);
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : shortDay.format(date);
}

export function toDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ALMATY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diffMs = date.getTime() - now;
  const absSeconds = Math.round(Math.abs(diffMs) / 1000);
  const absMinutes = Math.round(absSeconds / 60);
  const absHours = Math.round(absMinutes / 60);
  const absDays = Math.round(absHours / 24);

  const prefix = diffMs >= 0 ? "через " : "";
  const suffix = diffMs < 0 ? " назад" : "";

  if (absSeconds < 45) return diffMs < 0 ? "только что" : "сейчас";
  if (absMinutes < 60) return `${prefix}${absMinutes} мин${suffix}`;
  if (absHours < 24) return `${prefix}${absHours} ч${suffix}`;
  return `${prefix}${absDays} дн${suffix}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)));
  const value = bytes / Math.pow(1000, i);
  const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[i]}`;
}

export function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

export function localInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ALMATY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
}

export function almatyInputToUtc(value: string): string {
  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = (datePart ?? "").split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, (hour ?? 0) - 5, minute ?? 0, 0, 0)).toISOString();
}

export function randomIdempotencyKey(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
