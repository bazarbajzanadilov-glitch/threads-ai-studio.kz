import type { ComponentChildren, JSX } from "preact";

export interface ButtonProps extends JSX.HTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger-ghost" | "pill-primary" | "pill-secondary" | "pill-ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  icon?: ComponentChildren;
  children?: ComponentChildren;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  class: className = "",
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const isPill = variant.startsWith("pill-");
  const baseVariant = isPill ? variant.replace("pill-", "") : variant;

  const classes = [
    isPill ? "trantor-pill-btn" : "button",
    isPill ? `trantor-pill-btn--${baseVariant}` : `button--${variant}`,
    size !== "md" ? (isPill ? `trantor-pill-btn--${size}` : `button--${size}`) : "",
    loading ? "is-loading" : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <button
      type={type}
      class={classes}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span class="btn-spinner spin" aria-hidden="true" />
      ) : (
        icon && <span class="btn-icon" aria-hidden="true">{icon}</span>
      )}
      {children && <span>{children}</span>}
    </button>
  );
}
