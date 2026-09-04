import Link from "next/link";
import { Button, buttonClassName } from "@/components/primitives";
import { cn } from "@/lib/cn";

/**
 * One row on the setup hub.
 *
 * A link, not a form. State lives on the task's own route, so this card knows
 * nothing except what the task is worth to this seller and where it goes — and
 * a card that held state would be a fifth place completion could disagree from.
 *
 * Every string arrives formatted. The chip is a percentage, the estimate is a
 * duration and the progress line is a count, and all three are worked out on
 * the server: a client component that formats renders one answer at prerender
 * and another at hydration, which is the defect this codebase names first.
 *
 * ## Two weights of card, and it is not decoration
 *
 * Board 8a orders the four by weight times impact rather than by score:
 * photographs and a catalogue move enquiry volume, and the two trust tasks
 * follow. `lead` carries that — a filled control and a firmer border on the two
 * that pay, an outlined one on the two that do not. Four identical primary
 * buttons would say the four are interchangeable, which is the thing the
 * ordering exists to deny.
 */

export interface TaskCardProps {
  title: string;
  body: string;
  /** "+12%", or a word like SPEED where the task pays no points. */
  chip: string;
  /** Explains the chip on hover. Optional — a word chip explains itself. */
  chipTitle?: string;
  /** True where the chip is a points figure rather than a category word. */
  chipIsPoints: boolean;
  /** "~6 MIN". */
  estimate: string;
  /** "3 of 6". Omitted where a task has no partial state worth showing. */
  progress?: string;
  /** The two that move enquiry volume. Filled control, firmer border. */
  lead?: boolean;
  cta: string;
  href: string;
  /**
   * A suspended listing reaches no buyer, so the hub stops asking for work.
   * The card stays on the page and stops being a link — hiding it would lose
   * the reason the seller came.
   */
  disabled?: boolean;
}

export function TaskCard({
  title,
  body,
  chip,
  chipTitle,
  chipIsPoints,
  estimate,
  progress,
  lead = false,
  cta,
  href,
  disabled = false,
}: TaskCardProps) {
  return (
    <li
      className={cn(
        "flex items-center gap-[18px] rounded-card border bg-card px-5 py-[18px]",
        lead ? "border-line-strong" : "border-line",
      )}
    >
      {/*
        Empty on purpose. Every card here is open — a finished one has already
        collapsed into the summary row below — so this is the unticked circle
        the render draws, and it says "not yet" without a word for it.
      */}
      <span
        aria-hidden="true"
        className="size-[26px] shrink-0 rounded-pill border-[1.5px] border-line-strong"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-h3 font-medium text-ink">{title}</h3>
          <span
            {...(chipTitle ? { title: chipTitle } : {})}
            className={cn(
              "inline-flex h-5 items-center rounded-tag px-2 font-mono text-eyebrow uppercase",
              chipIsPoints ? "bg-moss-wash text-moss-deep" : "bg-fill text-muted",
            )}
          >
            {chip}
          </span>
        </div>
        <p className="mt-1.5 max-w-prose text-body-sm text-body">{body}</p>
      </div>

      {/*
        The estimate sits under the control rather than in the body, because it
        is a property of pressing the button rather than of the sentence above
        it — and because a seller scanning for "what can I finish now" is
        reading this column, not the prose.
      */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {disabled ? (
          <Button type="button" variant={lead ? "primary" : "secondary"} size="lg" disabled>
            {cta}
          </Button>
        ) : (
          <Link
            href={href}
            className={buttonClassName({ variant: lead ? "primary" : "secondary", size: "lg" })}
          >
            {cta}
          </Link>
        )}
        <span className="font-mono text-eyebrow uppercase text-faint">
          {estimate}
          {progress ? ` · ${progress}` : ""}
        </span>
      </div>
    </li>
  );
}
