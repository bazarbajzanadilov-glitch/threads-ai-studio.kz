import type { ComponentChildren } from "preact";

export interface BadgeProps {
  tone?: "active" | "paused" | "success" | "warning" | "error" | "muted" | "mint" | "indigo";
  pulse?: boolean;
  children: ComponentChildren;
  class?: string;
}

export function Badge({
  tone = "mint",
  pulse = false,
  children,
  class: className = ""
}: BadgeProps) {
  return (
    <span class={`trantor-status-tag trantor-status-tag--${tone} ${className}`}>
      {pulse && <span class="trantor-pulse-dot" aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
}
