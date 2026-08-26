import { cn } from "@/lib/cn";

/**
 * One number, named, with what changed under it.
 *
 * The number is the point, so it gets the serif face and the display size —
 * the one place §01 permits "one big number". Everything else on the card is
 * mono or small sans, so the eye lands on the figure.
 *
 * A delta is a word and a direction, never a green or red arrow alone.
 */
export interface StatCardProps {
  label: string;
  /** Already formatted — formatCount, formatAED, formatDuration. */
  value: string;
  /** A mono line under the number: a period, a denominator, a caveat. */
  caption?: string;
  delta?: {
    /** Already formatted, e.g. "+18%". */
    value: string;
    direction: "up" | "down" | "flat";
    /** What the change is against, e.g. "vs last month". */
    label: string;
    /** Up is not always good. A rise in response time is bad. */
    sentiment?: "good" | "bad" | "neutral";
  };
  /** Display size. Off for a dense admin row of eight. */
  hero?: boolean;
  /**
   * The face the number is set in.
   *
   * Serif everywhere the design draws it, and the one exception is the admin
   * console: the handoff-4 README says no serif anywhere in it, and a second
   * stat component to say the same thing differently is a component the
   * inventory does not have room for.
   */
  face?: "serif" | "sans";
  /** A footnote the number needs to be honest, e.g. self-reported. */
  note?: string;
}

const SENTIMENT = {
  good: "text-ok-ink",
  bad: "text-bad-ink",
  neutral: "text-muted",
} as const;

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;

export function StatCard({
  label,
  value,
  caption,
  delta,
  hero = false,
  face = "serif",
  note,
}: StatCardProps) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <p className="font-mono text-eyebrow uppercase text-muted">{label}</p>

      <p
        className={cn(
          "mt-1 text-ink tabular-nums",
          face === "serif" ? "font-serif" : "font-sans",
          hero ? "text-display" : face === "serif" ? "text-h1-serif" : "text-h1",
        )}
      >
        {value}
      </p>

      {caption && <p className="font-mono text-eyebrow text-faint">{caption}</p>}

      {delta && (
        <p className={cn("mt-2 text-caption", SENTIMENT[delta.sentiment ?? "neutral"])}>
          <span aria-hidden="true">{ARROW[delta.direction]}</span>{" "}
          <span className="tabular-nums">{delta.value}</span>{" "}
          <span className="text-muted">{delta.label}</span>
        </p>
      )}

      {note && <p className="mt-2 text-caption text-muted">{note}</p>}
    </div>
  );
}
