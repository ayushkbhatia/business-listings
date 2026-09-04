import { cn } from "@/lib/cn";
import { Check } from "@/components/primitives/icons";

/**
 * PlanCard — tier 4, and the last of the sixty-odd.
 *
 * Used in three places that want the same object to read differently: the
 * public pricing page `1l`, the last step of onboarding `2e`, and the plan
 * change screen `11f`. One component, three states, because a seller comparing
 * plans while signing up and a seller comparing them nine months later are
 * looking at the same facts and should see the same shape.
 *
 * Two rules the design system is firm about and this obeys:
 *
 *   - The recommended plan is promoted with the tinted shadow, never with a
 *     colour the badges use. A plan is a commercial choice and a verification
 *     badge is a fact we checked; if a paid tier can borrow the trust palette,
 *     the trust signal is for sale.
 *   - Every price is a real number from the `Plan` row. There is no "from" and
 *     no "contact us" — a directory whose own pricing is coy is asking a
 *     supplier to trust it with their catalogue.
 *
 * Features are given as already-localised strings by the caller, because what
 * is worth listing differs by surface: onboarding leads on caps, and the change
 * screen leads on what is different from what they have now.
 */

export interface PlanFeature {
  /** Already localised, e.g. "40 enquiries a month". */
  label: string;
  /** A feature this plan does not have is shown struck through, not hidden. */
  included: boolean;
}

export interface PlanCardProps {
  name: string;
  /** Whole dirhams a month, from the Plan row. Zero renders as free. */
  monthlyPriceAed: number;
  /** "AED 349" / "Free", already formatted and localised. */
  priceLabel: string;
  /** "a month" or "a month, billed yearly". */
  periodLabel?: string;
  /** One line on who this is for. */
  summary?: string;
  features: readonly PlanFeature[];

  /** The tinted shadow. One card at a time. */
  recommended?: boolean;
  recommendedLabel?: string;
  /** The plan this seller is already on. Never also `recommended`. */
  current?: boolean;
  currentLabel?: string;

  /** The button. Absent on the public page, where nothing can be bought yet. */
  action?: React.ReactNode;
  /** A line under the button, e.g. what the change would cost today. */
  note?: string;
  /**
   * Which heading level the plan name takes.
   *
   * Three inside a Panel, whose title is already an h2. Two where the cards sit
   * directly under the page heading, as they do on the plan-change screen —
   * jumping h1 to h3 is a heading-order violation and, more to the point, tells
   * a screen-reader user these cards are nested inside something that is not
   * there.
   */
  headingLevel?: 2 | 3;
}

export function PlanCard({
  name,
  monthlyPriceAed,
  priceLabel,
  periodLabel,
  summary,
  features,
  recommended = false,
  recommendedLabel,
  current = false,
  currentLabel,
  action,
  note,
  headingLevel = 3,
}: PlanCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      aria-label={name}
      /*
         The promoted state, as an attribute rather than only a shadow.

         §01 allows one promoted card on a page and `--e-promoted` appears here
         and on `1l` and nowhere else. That is a rule about the page, not about
         this component, so the only way to hold it is to be able to count them
         — and counting a Tailwind class is a test that breaks when somebody
         renames a utility rather than when the rule does.
      */
      data-promoted={recommended || undefined}
      className={cn(
        "flex flex-col rounded-card border bg-card p-4",
        // The tinted shadow, and a moss border. Not the ok/verified palette:
        // a paid tier must never borrow the colour a trust signal uses.
        recommended ? "border-moss shadow-promoted" : "border-line",
        current && !recommended && "border-line-strong",
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading className="text-h3 text-ink">{name}</Heading>
        {recommended && recommendedLabel && (
          <span className="rounded-chip bg-moss-wash px-2 py-0.5 font-mono text-eyebrow uppercase text-moss-deep">
            {recommendedLabel}
          </span>
        )}
        {current && currentLabel && (
          <span className="rounded-chip border border-line-strong px-2 py-0.5 font-mono text-eyebrow uppercase text-muted">
            {currentLabel}
          </span>
        )}
      </header>

      <p className="mt-2 flex flex-wrap items-baseline gap-1.5">
        {/*
          The number is the point, so it takes the serif face at display size —
          §01's one sanctioned "big number". Everything around it stays small.
        */}
        <span className="font-serif text-h1-serif tabular-nums text-ink">{priceLabel}</span>
        {periodLabel && monthlyPriceAed > 0 && (
          <span className="text-caption text-muted">{periodLabel}</span>
        )}
      </p>

      {summary && <p className="mt-1 max-w-prose text-caption text-muted">{summary}</p>}

      <ul className="mt-4 flex flex-1 flex-col gap-1.5">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start gap-2 text-body-sm">
            {feature.included ? (
              <Check size={14} aria-hidden="true" className="mt-1 shrink-0 text-moss" />
            ) : (
              // Shown struck through rather than dropped. A seller cannot want
              // what they cannot see, and the absence is what the next plan up
              // is selling.
              <span aria-hidden="true" className="mt-1 w-3.5 shrink-0 text-center text-faint">
                —
              </span>
            )}
            <span className={feature.included ? "text-body" : "text-faint line-through"}>
              {feature.label}
            </span>
          </li>
        ))}
      </ul>

      {(action || note) && (
        <footer className="mt-4 flex flex-col gap-1.5">
          {action}
          {note && <p className="text-caption text-muted">{note}</p>}
        </footer>
      )}
    </section>
  );
}
