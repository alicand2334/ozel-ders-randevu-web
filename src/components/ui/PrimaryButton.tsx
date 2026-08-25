import type { ButtonHTMLAttributes, ReactNode } from "react";

const baseClasses = [
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3",
  "text-sm font-semibold tracking-wide transition-colors duration-200",
  "min-h-11 touch-manipulation select-none",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
  "focus-visible:ring-offset-ink",
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
        disabled
          ? "bg-gold/50 text-ink/70 cursor-not-allowed opacity-70"
          : "bg-gold text-ink hover:bg-gold-hover active:bg-gold-active cursor-pointer",
        "focus-visible:ring-gold",
        "focus-visible:ring-offset-ink",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
