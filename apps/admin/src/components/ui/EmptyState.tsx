import type { ComponentChildren } from "preact";

export interface EmptyStateProps {
  icon?: ComponentChildren;
  title: string;
  description?: string;
  action?: ComponentChildren;
  class?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  class: className = ""
}: EmptyStateProps) {
  return (
    <div class={`trantor-empty-state card empty-state ${className}`}>
      {icon && <div class="trantor-empty-icon">{icon}</div>}
      <h3 class="trantor-empty-title">{title}</h3>
      {description && <p class="trantor-empty-desc">{description}</p>}
      {action && <div class="trantor-empty-action">{action}</div>}
    </div>
  );
}
