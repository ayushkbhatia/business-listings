import { cn } from "@/lib/cn";
import { Check } from "@/components/primitives/icons";

/**
 * Onboarding and any other numbered sequence. Claim, verify, profile,
 * locations, plan.
 *
 * Steps are numbered and named, never dots. A dot row tells somebody there are
 * five things left and nothing about what they are, which is exactly the
 * information a seller deciding whether to continue actually needs.
 */
export interface Step {
  key: string;
  label: string;
  href?: string;
}

export interface StepHeaderProps {
  steps: readonly Step[];
  /** Index of the step being worked on, zero-based. */
  current: number;
  /** Required: names the sequence. */
  label: string;
  /** "Step 2 of 5", already localised. */
  progressLabel?: (current: number, total: number) => string;
}

export function StepHeader({ steps, current, label, progressLabel }: StepHeaderProps) {
  return (
    <nav aria-label={label} className="border-b border-line bg-card px-5 py-3">
      {progressLabel && (
        <p className="mb-2 font-mono text-eyebrow uppercase text-faint">
          {progressLabel(current + 1, steps.length)}
        </p>
      )}
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
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
