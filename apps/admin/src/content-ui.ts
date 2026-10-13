import { contentMediaLimits, type ContentFormat, type Platform } from "@publisher/core";

export function usablePublishingAccount(account: { is_active?: boolean; status?: string; token_expires_at?: string | null } | undefined, now = Date.now()): boolean {
  if (!account || !account.is_active || !["active", "expiring"].includes(account.status ?? "")) return false;
  if (!account.token_expires_at) return true;
  const expiry = Date.parse(account.token_expires_at);
  return Number.isFinite(expiry) && expiry > now;
}

export function acceptedMediaTypes(_platform: Platform = "threads", _format: ContentFormat = "image"): readonly string[] {
  return ["image/jpeg", "image/png", "image/webp"];
}

export function mediaAcceptAttribute(platform: Platform = "threads", format: ContentFormat = "image"): string {
  return acceptedMediaTypes(platform, format).join(",");
}

export function canAddMedia(platform: Platform = "threads", format: ContentFormat = "image", currentCount: number): boolean {
  return currentCount < contentMediaLimits(platform, format).max;
}

export function mediaCountProblem(platform: Platform = "threads", format: ContentFormat = "image", count: number): string | null {
  const limits = contentMediaLimits(platform, format);
  if (count >= limits.min && count <= limits.max) return null;
  return "Threads strictly requires exactly one image (1 изображение)";
}
