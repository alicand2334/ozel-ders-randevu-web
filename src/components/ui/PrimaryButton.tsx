import type { ButtonHTMLAttributes, ReactNode } from "react";

const baseClasses = [
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3",
  "text-sm font-semibold tracking-wide transition-colors duration-200",
  "min-h-11 touch-manipulation select-none",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
  "focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

export type PrimaryButtonProps = {
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

export function PrimaryButton({
  children,
  className = "",
  disabled = false,
  ...rest
}: PrimaryButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={[
        baseClasses,
        "bg-gold text-ink hover:bg-gold-hover active:bg-gold-active",
        "focus-visible:ring-gold",
        "disabled:hover:bg-gold disabled:active:bg-gold",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
