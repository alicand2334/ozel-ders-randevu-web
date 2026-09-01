import type { ReactNode } from "react";

export type BadgeProps = {
  children: ReactNode;
  /** Vurgu tonu */
  tone?: "gold" | "neutral" | "red";
  className?: string;
};

export function Badge({
  children,
  tone = "gold",
  className = "",
}: BadgeProps) {
  const toneClasses =
    tone === "gold"
      ? "border-gold/30 bg-gold-soft text-gold"
      : tone === "red"
      ? "border-red-500/30 bg-red-500/10 text-red-400"
      : "border-line bg-surface text-muted";
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
        "text-xs font-medium tracking-wide",
        toneClasses,
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}
