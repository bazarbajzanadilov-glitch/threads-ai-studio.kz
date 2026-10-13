export const ALMATY_TIME_ZONE = "Asia/Almaty";

export function parseAlmatyLocal(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("Local date must use YYYY-MM-DDTHH:mm[:ss]");
  const [, year, month, day, hour, minute, second = "00"] = match;
  const localWithOffset = `${year}-${month}-${day}T${hour}:${minute}:${second}+05:00`;
  const date = new Date(localWithOffset);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Almaty local date");
  const parts = [year, month, day, hour, minute, second].map(Number);
  if (
    parts[1]! < 1 || parts[1]! > 12 || parts[2]! < 1 || parts[2]! > 31 ||
    parts[3]! > 23 || parts[4]! > 59 || parts[5]! > 59
  ) throw new Error("Invalid Almaty local date");
  if (formatAlmaty(date, true) !== `${year}-${month}-${day}T${hour}:${minute}:${second}`) {
    throw new Error("Invalid Almaty calendar date");
  }
  return date.toISOString();
}

export function formatAlmaty(instant: string | Date, includeSeconds = false): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new Error("Invalid instant");
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: ALMATY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23"
  }).format(date).replace(" ", "T");
}

export function minutesUntil(instant: string, now = new Date()): number {
  return Math.floor((Date.parse(instant) - now.getTime()) / 60_000);
}

export function isIsoInstant(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth && !Number.isNaN(Date.parse(value));
}
