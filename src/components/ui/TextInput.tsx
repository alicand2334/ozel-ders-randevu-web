import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

export type TextInputProps = {
  label?: string;
  hint?: string;
  leadingIcon?: ReactNode;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput(
    { label, hint, leadingIcon, className = "", disabled = false, id, ...rest },
    ref,
  ) {
    const inputId = id;
    const hintId = hint && inputId ? `${inputId}-hint` : undefined;
    return (
      <div className={`w-full ${className}`.trim()}>
        {label ? (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-sm font-medium text-ink-text"
          >
            {label}
          </label>
        ) : null}
        <div className="relative">
          {leadingIcon ? (
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted">
              {leadingIcon}
            </span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-describedby={hintId}
            className={[
              "w-full rounded-xl border border-line bg-ink px-3.5 py-3 text-sm text-ink-text",
              "placeholder:text-subtle",
              "transition-colors duration-200",
              "hover:border-line-strong",
              "focus:border-gold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-ink focus:ring-gold/60",
              leadingIcon ? "pl-9" : "",
              "min-h-11 touch-manipulation",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line",
            ].join(" ")}
            {...rest}
          />
        </div>
        {hint ? (
          <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
