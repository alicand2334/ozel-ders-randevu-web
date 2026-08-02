export const primaryButtonClasses = [
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3",
  "text-sm font-semibold tracking-wide text-ink",
  "bg-gold transition-colors duration-200",
  "hover:bg-gold-hover active:bg-gold-active",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:ring-gold",
  "min-h-11 touch-manipulation select-none",
].join(" ");

export const secondaryButtonClasses = [
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3",
  "text-sm font-semibold tracking-wide text-ink-text",
  "border border-line bg-transparent transition-colors duration-200",
  "hover:bg-surface hover:border-line-strong active:bg-surface-raised",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:ring-gold",
  "min-h-11 touch-manipulation select-none",
].join(" ");
