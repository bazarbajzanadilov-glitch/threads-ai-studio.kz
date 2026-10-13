import { useEffect } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { X } from "lucide-preact";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  size?: "sm" | "md" | "lg" | "wide";
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md"
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      class="trantor-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        class={`trantor-modal-sheet ${size === "wide" || size === "lg" ? "trantor-modal-sheet--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="trantor-sheet-handle" aria-hidden="true" />
        <div class="trantor-sheet-header">
          <h3>{title}</h3>
          <button
            class="trantor-close-btn"
            onClick={onClose}
            type="button"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>
        <div class="trantor-sheet-body">
          {children}
        </div>
      </div>
    </div>
  );
}
