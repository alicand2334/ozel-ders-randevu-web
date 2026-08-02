import type { ReactNode } from "react";

export type SectionTitleProps = {
  /** Üst küçük etiket (altın, küçük harfler) */
  eyebrow?: string;
  /** Ana başlık metni */
  title: ReactNode;
  /** Başlığın altındaki açıklama */
  description?: ReactNode;
  /** Hizalama */
  align?: "left" | "center";
  className?: string;
};

export function SectionTitle({
  eyebrow,
  title,
  description,
  align = "center",
  className = "",
}: SectionTitleProps) {
  const alignment = align === "center" ? "text-center mx-auto" : "text-left";
  return (
    <div className={`max-w-2xl ${alignment} ${className}`.trim()}>
      {eyebrow ? (
        <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-gold">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink-text sm:text-3xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-base leading-relaxed text-muted">{description}</p>
      ) : null}
    </div>
  );
}
