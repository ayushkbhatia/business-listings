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
 * promise a live screen cannot keep. A `reserved` rung now renders muted and
 * inert, and `tests/e2e/listing.spec.ts` asserts the region contains no button,
 * textbox, combobox or spinbutton at all — the seller's own tier is
 * `ops_lead`-write-only (CLAUDE.md non-negotiable 2) and a control here would
 * be a control that gets refused.
 *
 * ## Why it reads across rather than down
 *
 * Board 3e draws it as a row of nodes with the progression between them, which
 * is what a ladder is for: three rungs stacked as list rows read as three
 * unrelated facts. Below `md` it stacks, because three columns inside a 340px
 * phone is three columns of two words each.
 */
export interface LadderRung {
  tier: number;
  label: string;
  /** What this rung requires, already localised. */
  requirement: string;
  /** Already formatted. Present only on rungs already reached. */
  date?: string;
  /**
   * A short mono mark on the rung — "Top tier", "Reserved". Already localised.
   *
   * Two of the three rungs carry one and they say opposite things: tier 2 is as
   * far as anybody can currently get, and tier 3 is drawn so the ladder has
   * somewhere to go without pretending it goes there yet.
   */
  badge?: string;
  /**
   * Drawn, unreachable, and honest about it.
   *
   * Not the same as "not yet reached". An unreached rung is work the seller can
   * do; a reserved one is work nobody has built, so it gets no number circle
   * treatment that would read as a next step and no requirement phrased as an
   * instruction.
   */
  reserved?: boolean;
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
      <ol className="grid gap-3 md:grid-cols-3 md:gap-0">
        {rungs.map((rung, index) => {
          const reached = !rung.reserved && rung.tier <= current;
          const isCurrent = !rung.reserved && rung.tier === current;

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
                  <span
                    className={cn(
                      "text-body-sm",
                      rung.reserved ? "text-muted" : reached ? "text-ink" : "text-body",
                    )}
                  >
                    {rung.label}
                  </span>
                  {reached && <span className="sr-only">{reachedLabel}</span>}
                  {rung.badge && (
                    <span
                      className={cn(
                        "rounded-chip px-1.5 py-px font-mono text-eyebrow uppercase tracking-eyebrow",
                        rung.reserved ? "bg-fill text-muted" : "bg-ok-wash text-ok-ink",
                      )}
                    >
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
