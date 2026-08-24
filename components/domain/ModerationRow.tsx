import { StatusBadge, type StatusTone } from "@/components/display/StatusBadge";
import { cn } from "@/lib/cn";

/**
 * ModerationRow — tier 4.
 *
 * One thing waiting for a decision: a review somebody reported, a supplier
 * report the platform raised, a listing flagged for a wrong trade. The admin
 * queues that display these are handoff 4; the rows are built here because
 * handoff 2 is what creates them — an IBAN in a thread raises a supplier
 * report, and a removed review writes an audit row.
 *
 * The subject is quoted in full, not summarised. A moderator deciding whether
 * a sentence is abusive needs the sentence, and a queue that makes them click
 * through to read it is a queue that gets skimmed.
 *
 * Every string arrives already translated.
 */
export interface ModerationRowProps {
  /** `Review` · `Supplier report`. Already localised. */
  kindLabel: string;
  /** Machine reference, in mono. `SR-4412`, or the subject ref. */
  reference: string;
  /** Who or what it is about, and a link to it. */
  subjectName: string;
  subjectHref?: string;
  /** The reported content, quoted. The reason the queue exists. */
  quoted?: string;
  /** Why it is here: the ground, or what the detector matched. Already localised. */
  groundLabel: string;
  /** Already formatted. */
  raisedAt: string;
  /** Who raised it, or the platform. Already localised. */
  raisedByLabel: string;
  /** Set once decided. Already localised. */
  outcomeLabel?: string;
  outcomeTone?: StatusTone;
  /** The decision controls. Absent on a resolved row. */
  actions?: React.ReactNode;
  as?: "li" | "div";
}

export function ModerationRow({
  kindLabel,
  reference,
  subjectName,
  subjectHref,
  quoted,
  groundLabel,
  raisedAt,
  raisedByLabel,
  outcomeLabel,
  outcomeTone = "neutral",
  actions,
  as: Element = "li",
}: ModerationRowProps) {
  return (
    <Element className={cn("border-b border-line px-3 py-3 last:border-b-0", outcomeLabel && "bg-paper-sunk")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-caption uppercase text-muted">{kindLabel}</span>
          <span className="font-mono text-caption text-faint">{reference}</span>
          {outcomeLabel ? (
            <StatusBadge tone={outcomeTone} size="sm" shape="chip">
              {outcomeLabel}
            </StatusBadge>
          ) : null}
        </p>
        <span className="text-caption text-muted">
          {raisedByLabel} · {raisedAt}
        </span>
      </div>

      <p className="mt-1 text-body-sm text-ink">
        {subjectHref ? (
          <a
            href={subjectHref}
            className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {subjectName}
          </a>
        ) : (
          subjectName
        )}
      </p>

      <p className="mt-0.5 text-caption text-muted">{groundLabel}</p>

      {/*
        Quoted, not summarised. A moderator deciding whether a sentence is
        abusive needs the sentence.
      */}
      {quoted ? (
        <blockquote className="mt-2 border-s-2 border-line-strong ps-3 text-body-sm text-prose">
          {quoted}
        </blockquote>
      ) : null}

      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </Element>
  );
}
