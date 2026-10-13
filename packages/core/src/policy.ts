export type RetryDisposition = "retry" | "unknown" | "permanent";

export interface RetryDecision {
  disposition: RetryDisposition;
  delay_seconds: number | null;
  attempt: number;
}

const DEFAULT_RETRY_SECONDS = [60, 120, 300, 900, 1800] as const;

export function classifyHttpFailure(input: {
  status: number | null;
  attempt: number;
  retry_after?: string | null;
  operation?: "create" | "status" | "publish";
  response_received?: boolean;
  ambiguous?: boolean;
  random?: number;
}): RetryDecision {
  const { status, attempt, operation = "create", response_received = true, ambiguous = false } = input;
  if (operation === "publish" && (
    !response_received || ambiguous || status === 408 || (status !== null && status >= 500 && status <= 599)
  )) {
    return { disposition: "unknown", delay_seconds: null, attempt };
  }
  const retryable = status === null || status === 408 || status === 409 || status === 425 || status === 429 || (status !== null && status >= 500 && status <= 599);
  if (!retryable || attempt >= DEFAULT_RETRY_SECONDS.length) {
    return { disposition: "permanent", delay_seconds: null, attempt };
  }
  const retryAfter = parseRetryAfter(input.retry_after);
  const base = retryAfter ?? DEFAULT_RETRY_SECONDS[attempt] ?? DEFAULT_RETRY_SECONDS.at(-1)!;
  const random = Math.max(0, Math.min(1, input.random ?? Math.random()));
  const jitter = retryAfter === null ? Math.round(base * (random * 0.2 - 0.1)) : 0;
  return { disposition: "retry", delay_seconds: Math.max(1, base + jitter), attempt };
}

export function parseRetryAfter(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Math.max(1, Number(value));
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(1, Math.ceil((timestamp - now.getTime()) / 1000));
}

export interface JitterSlotOptions {
  windowStart: string; // "11:00"
  windowEnd: string;   // "21:00"
  minDelayMinutes: number; // e.g. 15
  maxDelayMinutes: number; // e.g. 40
  randomize: boolean;
  accountCount: number;
  baseDate?: Date; // base date (defaults to today)
  timezoneOffsetHours?: number; // e.g. 5 for Almaty (UTC+5)
  startFromBaseTime?: boolean; // start from baseDate time if within window
}

export interface JitterSlot {
  index: number;
  scheduledAt: string; // ISO 8601
  timeFormatted: string; // "11:15"
  delayMinutes: number; // Delay from previous post
}

export function calculateJitterSlots(options: JitterSlotOptions): JitterSlot[] {
  const {
    windowStart,
    windowEnd,
    minDelayMinutes,
    maxDelayMinutes,
    randomize,
    accountCount,
    baseDate = new Date(),
    timezoneOffsetHours = 5,
    startFromBaseTime = false
  } = options;

  if (accountCount <= 0) return [];

  const [startH, startM] = windowStart.split(":").map(Number);
  const [endH, endM] = windowEnd.split(":").map(Number);
  const startTotalMinutes = (startH ?? 11) * 60 + (startM ?? 0);
  const endTotalMinutes = (endH ?? 21) * 60 + (endM ?? 0);
  const windowSpanMinutes = Math.max(30, endTotalMinutes - startTotalMinutes);

  // Compute local base datetime in target timezone
  const localBaseMs = baseDate.getTime() + timezoneOffsetHours * 3600_000;
  const localBase = new Date(localBaseMs);
  const localY = localBase.getUTCFullYear();
  const localM = localBase.getUTCMonth();
  let localD = localBase.getUTCDate();
  const baseMinutes = localBase.getUTCHours() * 60 + localBase.getUTCMinutes();

  let currentMinutes: number;
  if (startFromBaseTime) {
    if (baseMinutes >= endTotalMinutes) {
      localD += 1;
      currentMinutes = startTotalMinutes;
    } else {
      currentMinutes = Math.max(startTotalMinutes, baseMinutes);
    }
  } else {
    currentMinutes = startTotalMinutes;
  }

  // Ideal step if evenly distributed
  const idealStep = accountCount > 1
    ? Math.max(minDelayMinutes, Math.floor(windowSpanMinutes / accountCount))
    : 0;

  const slots: JitterSlot[] = [];

  for (let i = 0; i < accountCount; i++) {
    let delay = 0;
    if (i > 0) {
      if (randomize) {
        const range = Math.max(1, maxDelayMinutes - minDelayMinutes);
        delay = Math.floor(minDelayMinutes + Math.random() * range);
      } else {
        delay = Math.min(maxDelayMinutes, Math.max(minDelayMinutes, idealStep));
      }
      currentMinutes += delay;
      if (currentMinutes > endTotalMinutes) {
        localD += 1;
        currentMinutes = startTotalMinutes + Math.min(minDelayMinutes, currentMinutes - endTotalMinutes);
      }
    }

    const slotH = Math.floor(currentMinutes / 60) % 24;
    const slotMin = currentMinutes % 60;
    const timeFormatted = `${String(slotH).padStart(2, "0")}:${String(slotMin).padStart(2, "0")}`;

    const utcHours = slotH - timezoneOffsetHours;
    const slotDate = new Date(Date.UTC(localY, localM, localD, utcHours, slotMin, 0, 0));

    slots.push({
      index: i,
      scheduledAt: slotDate.toISOString(),
      timeFormatted,
      delayMinutes: delay
    });
  }

  return slots;
}

export function nextAttemptAt(now: Date, delaySeconds: number): string {
  return new Date(now.getTime() + delaySeconds * 1000).toISOString();
}
