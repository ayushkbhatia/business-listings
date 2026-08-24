import { cn } from "@/lib/cn";
import { Check } from "@/components/primitives/icons";

/**
 * The four rungs, and where this business sits on them. Read-only here; the
 * seller-facing version in handoff 3 makes the next rung actionable.
 *
 * It shows the rungs above as well as below on purpose. A tier 2 supplier
 * seeing what tier 3 requires is the whole mechanism by which the directory
 * gets more verified suppliers, and a buyer seeing it understands that the
 * badge is a ladder rather than a badge somebody bought.
 *
 * No colour from the seller theme reaches this, for the same reason as the
 * badge.
 */
export interface LadderRung {
  tier: number;
  label: string;
  /** What this rung requires, already localised. */
  requirement: string;
  /** Already formatted. Present only on rungs already reached. */
  date?: string;
}

export interface VerificationLadderProps {
  rungs: readonly LadderRung[];
  current: number;
  /** Required: names the region. */
  label: string;
  /** "Reached", already localised, for the assistive-technology marker. */
  reachedLabel: string;
}

export function VerificationLadder({ rungs, current, label, reachedLabel }: VerificationLadderProps) {
  return (
    <section aria-label={label} className="w-full">
      <ol className="flex flex-col">
        {rungs.map((rung) => {
          const reached = rung.tier <= current;
          const isCurrent = rung.tier === current;

          return (
            <li
              key={rung.tier}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex items-start gap-3 border-b border-line py-2.5 last:border-b-0",
                isCurrent && "bg-moss-wash",
                isCurrent && "-mx-3 px-3",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill",
                  "font-mono text-eyebrow tabular-nums",
                  reached
                    ? isCurrent
                      ? "border-[1.5px] border-moss bg-moss text-on-ink"
                      : "bg-ok-wash text-ok-ink"
                    : "border border-line-strong bg-card text-faint",
                )}
              >
                {reached ? <Check size={11} /> : rung.tier}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className={cn("text-body-sm", reached ? "text-ink" : "text-muted")}>
                    {rung.label}
                  </span>
                  {reached && (
                    <span className="sr-only">{reachedLabel}</span>
                  )}
                  {rung.date && (
                    <span className="font-mono text-eyebrow tabular-nums text-faint">{rung.date}</span>
                  )}
                </span>
                <span className="block text-caption text-muted">{rung.requirement}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
