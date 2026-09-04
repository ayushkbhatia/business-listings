import { cn } from "@/lib/cn";
import { Check } from "@/components/primitives/icons";

/**
 * Onboarding and any other numbered sequence. Claim, verify, profile,
 * locations, plan.
 *
 * Steps are numbered and named, never dots. A dot row tells somebody there are
 * five things left and nothing about what they are, which is exactly the
 * information a seller deciding whether to continue actually needs.
 *
 * ## Two variants, one chain
 *
 * `banner` is the component's original shape: its own bar, with the "Step 2 of
 * 5" line above the list. It sits at the top of a panel.
 *
 * `inline` is board 2a's onboarding header — the chain sitting in a 60px bar
 * beside the wordmark, drawing none of its own. Below `md` it collapses to the
 * progress line and the current step's name alone, because five labelled steps
 * do not fit on a phone and a squeezed chain is less use than a sentence. The
 * chain is the same component and the same labels on every step of the funnel;
 * state is carried by the tick, the colour and the weight, and by nothing else.
 */
export interface Step {
  key: string;
  label: string;
  href?: string;
}

export type StepHeaderVariant = "banner" | "inline";

export interface StepHeaderProps {
  steps: readonly Step[];
  /** Index of the step being worked on, zero-based. */
  current: number;
  /** Required: names the sequence. */
  label: string;
  /** "Step 2 of 5", already localised. */
  progressLabel?: (current: number, total: number) => string;
  variant?: StepHeaderVariant;
}

export function StepHeader({
  steps,
  current,
  label,
  progressLabel,
  variant = "banner",
}: StepHeaderProps) {
  const inline = variant === "inline";
  const activeStep = steps[current];

  return (
    <nav
      aria-label={label}
      className={cn(
        inline
          ? "flex min-w-0 items-center"
          : "border-b border-line bg-card px-5 py-3",
      )}
    >
      {progressLabel && (
        <p
          className={cn(
            "font-mono text-eyebrow uppercase text-muted",
            inline
              ? // The whole chain on a phone, in one line. Hidden from the
                // desktop reading order rather than duplicated, so a screen
                // reader is not told the position twice.
                "flex items-baseline gap-2 md:hidden"
              : "mb-2",
          )}
        >
          <span className="tabular-nums">{progressLabel(current + 1, steps.length)}</span>
          {inline && activeStep && (
            <span className="truncate font-sans text-caption normal-case text-ink">
              {activeStep.label}
            </span>
          )}
        </p>
      )}

      <ol
        className={cn(
          "flex items-center gap-x-1 gap-y-2",
          inline ? "hidden md:flex" : "flex-wrap",
        )}
      >
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          const body = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-pill font-mono text-eyebrow tabular-nums",
                  done && "bg-moss text-on-ink",
                  active && "border-[1.5px] border-moss bg-moss-wash text-moss-deep",
                  !done && !active && "border border-line-strong bg-card text-faint",
                )}
              >
                {done ? <Check size={11} /> : i + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-caption",
                  active ? "text-ink" : done ? "text-body" : "text-faint",
                )}
              >
                {step.label}
              </span>
            </>
          );

          return (
            <li key={step.key} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="mx-1 h-px w-5 bg-line" />}
              {step.href && done ? (
                <a
                  href={step.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-tag px-1",
                    "transition-colors duration-120 ease-out hover:bg-fill",
                    "focus-visible:outline-none focus-visible:shadow-focus",
                  )}
                >
                  {body}
                </a>
              ) : (
                <span
                  aria-current={active ? "step" : undefined}
                  className="flex items-center gap-1.5 px-1"
                >
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
