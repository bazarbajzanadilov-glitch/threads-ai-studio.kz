export interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  class?: string;
}

export function Skeleton({
  width = "100%",
  height = "20px",
  radius = "12px",
  class: className = ""
}: SkeletonProps) {
  return (
    <div
      class={`trantor-skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius: radius,
      }}
      aria-hidden="true"
    />
  );
}
