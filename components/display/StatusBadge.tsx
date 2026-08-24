import { cn } from "@/lib/cn";

/**
 * A state, as a word and a tone. Never a bare colour — a green dot on its own
 * says nothing to anyone who cannot see it, and not much to anyone who can.
 *
 * `dot` adds the mark beside the word for scanning a dense table; the word is
 * never optional.
 */
export type StatusTone = "ok" | "warn" | "bad" | "info" | "neutral";

export interface StatusBadgeProps {
  children: React.ReactNode;
  tone?: StatusTone;
  dot?: boolean;
  size?: "sm" | "md";
  /** Rendered as a pill. Squared-off suits a table cell better. */
  shape?: "pill" | "chip";
}

const TONE: Record<StatusTone, { wash: string; line: string; text: string; dot: string }> = {
  ok: { wash: "bg-ok-wash", line: "border-ok-line", text: "text-ok-ink", dot: "bg-ok" },
  warn: { wash: "bg-warn-wash", line: "border-warn-line", text: "text-warn-ink", dot: "bg-warn" },
  bad: { wash: "bg-bad-wash", line: "border-bad-line", text: "text-bad-ink", dot: "bg-bad" },
  info: { wash: "bg-info-wash", line: "border-info-line", text: "text-info-ink", dot: "bg-info" },
  neutral: { wash: "bg-fill", line: "border-line", text: "text-body", dot: "bg-line-strong" },
};

export function StatusBadge({
  children,
  tone = "neutral",
  dot = false,
  size = "md",
  shape = "pill",
}: StatusBadgeProps) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border whitespace-nowrap",
        shape === "pill" ? "rounded-pill" : "rounded-chip",
        size === "sm" ? "px-1.5 py-px text-eyebrow" : "px-2 py-0.5 text-caption",
        t.wash,
        t.line,
        t.text,
      )}
    >
      {dot && <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-pill", t.dot)} />}
      {children}
    </span>
  );
}
