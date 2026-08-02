import type { ButtonHTMLAttributes, ReactNode } from "react";

const baseClasses = [
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3",
  "text-sm font-semibold tracking-wide transition-colors duration-200",
  "min-h-11 touch-manipulation select-none",
  "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
  "focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

export type SecondaryButtonProps = {
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

export function SecondaryButton({
  children,
  className = "",
  disabled = false,
  ...rest
}: SecondaryButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={[
        baseClasses,
        "border-line text-ink-text bg-transparent",
        "hover:bg-surface hover:border-line-strong",
        "active:bg-surface-raised",
        "focus-visible:ring-gold",
        "disabled:hover:bg-transparent disabled:active:bg-transparent",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
