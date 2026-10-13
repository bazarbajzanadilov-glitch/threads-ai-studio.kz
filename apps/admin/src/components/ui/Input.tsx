import type { ComponentChildren, JSX } from "preact";

export interface FormFieldProps {
  label?: string;
  error?: string;
  hint?: string;
  counter?: { current: number; max: number };
  children: ComponentChildren;
  class?: string;
}

export function FormField({
  label,
  error,
  hint,
  counter,
  children,
  class: className = ""
}: FormFieldProps) {
  return (
    <div class={`trantor-form-field ${className}`}>
      {(label || counter) && (
        <div class="trantor-field-header">
          {label && <label>{label}</label>}
          {counter && (
            <span class={`trantor-counter ${counter.current > counter.max ? "trantor-counter--err" : ""}`}>
              {counter.current} / {counter.max}
            </span>
          )}
        </div>
      )}
      {children}
      {hint && !error && <small class="trantor-field-hint">{hint}</small>}
      {error && <span class="trantor-field-error">{error}</span>}
    </div>
  );
}

export interface InputProps extends JSX.HTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error, class: className = "", ...rest }: InputProps) {
  return (
    <input
      class={`trantor-input ${error ? "trantor-input--error" : ""} ${className}`}
      {...rest}
    />
  );
}

export interface TextareaProps extends JSX.HTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ error, class: className = "", ...rest }: TextareaProps) {
  return (
    <textarea
      class={`trantor-textarea ${error ? "trantor-textarea--error" : ""} ${className}`}
      {...rest}
    />
  );
}

export interface SelectProps extends JSX.HTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export function Select({ error, class: className = "", children, ...rest }: SelectProps) {
  return (
    <select
      class={`trantor-select ${error ? "trantor-select--error" : ""} ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
