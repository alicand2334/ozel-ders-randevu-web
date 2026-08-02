import type { HTMLAttributes, ReactNode } from "react";

export type CardProps = {
  children: ReactNode;
  className?: string;
  /** İç boşluk varyantı */
  padding?: "default" | "snug" | "roomy";
  /** Hafif yükseltilmiş yüzey (hover/etkileşimli kartlar için) */
  raised?: boolean;
} & Omit<HTMLAttributes<HTMLDivElement>, "className">;

const paddingMap = {
  default: "p-5 sm:p-6",
  snug: "p-4 sm:p-5",
  roomy: "p-6 sm:p-8",
} as const;

export function Card({
  children,
  className = "",
  padding = "default",
  raised = false,
  ...rest
}: CardProps) {
  return (
    <div
      className={[
        "rounded-2xl border border-line bg-surface transition-colors duration-200",
        paddingMap[padding],
        raised ? "hover:bg-surface-raised hover:border-line-strong" : "",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
