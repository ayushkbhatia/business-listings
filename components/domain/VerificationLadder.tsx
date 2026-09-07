import { cn } from "@/lib/cn";
import { Check } from "@/components/primitives/icons";

/**
 * The rungs, and where this business sits on them.
 *
 * It shows the rungs above as well as below on purpose. A tier 1 supplier
 * seeing what tier 2 requires is the whole mechanism by which the directory
 * gets more verified suppliers, and a buyer seeing it understands that the
 * badge is a ladder rather than a badge somebody bought.
 *
 * No colour from the seller theme reaches this, for the same reason as the
 * badge.
 *
 * ## Read-only, and the absence is the feature
 *
 * There is no rung with an action. There was: the board this was drawn from
 * offered `Start this →` on a tier with no implementation behind it, which is a
 * promise a live screen cannot keep. `tests/e2e/listing.spec.ts` asserts the
 * region contains no button, textbox, combobox or spinbutton at all — the
 * seller's own tier is `ops_lead`-write-only (CLAUDE.md non-negotiable 2) and a
 * control here would be a control that gets refused.
 *
 * There was also a `reserved` rung, drawn muted and inert so the ladder had
 * somewhere to go. Trade references will never be built, so it has gone with
 * the tier: a rung nobody intends to ship is the same unkeepable promise as a
 * button with nothing behind it, drawn one shade quieter.
 *
 * ## Why it reads across rather than down
 *
 * Board 3e draws it as a row of nodes with the progression between them, which
 * is what a ladder is for: rungs stacked as list rows read as unrelated facts.
 * Below `md` it stacks, because two columns inside a 340px phone is two columns
 * of two words each.
 */
export interface LadderRung {
  tier: number;
  label: string;
  /** What this rung requires, already localised. */
  requirement: string;
  /** Already formatted. Present only on rungs already reached. */
  date?: string;
  /**
   * A short mono mark on the rung — "Top tier". Already localised.
   *
   * Only the top rung carries one, and it says the ladder ends here rather than
   * that this seller has arrived: it renders at tier 2 whether or not the
   * seller has reached it, so somebody at tier 1 can see how far there is left
   * to go.
   */
  badge?: string;
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
      {/*
         Columns counted from the rungs, not written.

         This was `md:grid-cols-3` while the ladder had three rungs. Cutting
         trade references left two rungs in a three-column grid — a third of the
         panel empty, which reads as a rung that failed to render rather than a
         ladder that ends. Tailwind cannot see a runtime value, so the two
         classes it may emit are both spelt out here.
      */}
      <ol
        className={cn(
          "grid gap-3 md:gap-0",
          rungs.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2",
        )}
      >
        {rungs.map((rung, index) => {
          const reached = rung.tier <= current;
          const isCurrent = rung.tier === current;

          return (
            <li
              key={rung.tier}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex items-start gap-3 border-line",
                // The progression, drawn once between columns rather than as a
                // decorative rule under every row.
                index > 0 && "md:border-l md:pl-4",
                index > 0 && "border-t pt-3 md:border-t-0 md:pt-0",
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
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={cn("text-body-sm", reached ? "text-ink" : "text-body")}>
                    {rung.label}
                  </span>
                  {reached && <span className="sr-only">{reachedLabel}</span>}
                  {rung.badge && (
                    <span className="rounded-chip bg-ok-wash px-1.5 py-px font-mono text-eyebrow uppercase tracking-eyebrow text-ok-ink">
                      {rung.badge}
                    </span>
                  )}
                </span>
                {rung.date && (
                  <span className="mt-0.5 block font-mono text-eyebrow uppercase tabular-nums text-muted">
                    {rung.date}
                  </span>
                )}
                <span className="mt-1 block text-caption text-muted">{rung.requirement}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
