import type { ComponentChildren, JSX } from "preact";

export interface CardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "metric" | "glass";
  interactive?: boolean;
  children?: ComponentChildren;
}

export function Card({
  variant = "default",
  interactive = false,
  children,
  class: className = "",
  ...rest
}: CardProps) {
  const classes = [
    "trantor-card",
    variant !== "default" ? `trantor-card--${variant}` : "",
    interactive ? "trantor-card--interactive" : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <div class={classes} {...rest}>
      {children}
    </div>
  );
}
