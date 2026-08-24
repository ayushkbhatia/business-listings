import { cn } from "@/lib/cn";

/**
 * AuditRow — tier 4.
 *
 * One line of the audit log. Every staff state change writes one, with a
 * written reason, and this is how a person reads it back.
 *
 * The reason is never truncated. It is the whole point of the row: an audit
 * log that hides why is a list of timestamps, and the one question anybody
 * ever asks of it is "why did somebody do that".
 *
 * `before` and `after` are rendered only when a caller supplies them already
 * formatted. A JSON blob dumped into a table teaches nobody anything; "tier 3
 * → tier 2" does.
 *
 * Every string arrives already translated.
 */
export interface AuditRowProps {
  /** `Review removed`. Already localised, never the raw action key. */
  actionLabel: string;
  /** `Review:clx123`. Mono, and greppable. */
  subject: string;
  subjectHref?: string;
  /** Who did it. A name, not a uuid. */
  actorName: string;
  /** Their role at the time, already localised. */
  actorRoleLabel?: string;
  /** Already formatted. */
  at: string;
  /** The written reason. Required, and shown in full. */
  reason: string;
  /** `tier 3` → `tier 2`, already formatted by the caller. */
  change?: { from: string; to: string };
  as?: "li" | "div";
}

export function AuditRow({
  actionLabel,
  subject,
  subjectHref,
  actorName,
  actorRoleLabel,
  at,
  reason,
  change,
  as: Element = "li",
}: AuditRowProps) {
  return (
    <Element className="border-b border-line px-3 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-body-sm text-ink">{actionLabel}</span>
          {subjectHref ? (
            <a
              href={subjectHref}
              className="rounded-tag font-mono text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {subject}
            </a>
          ) : (
            <span className="font-mono text-caption text-muted">{subject}</span>
          )}
        </p>
        <span className="text-caption text-muted">
          {actorName}
          {actorRoleLabel ? ` · ${actorRoleLabel}` : ""} · {at}
        </span>
      </div>

      {change ? (
        <p className="mt-1 flex flex-wrap items-baseline gap-2 font-mono text-caption">
          <s className="text-muted">{change.from}</s>
          <span className="text-ink">{change.to}</span>
        </p>
      ) : null}

      {/* Never truncated. The reason is the whole point of the row. */}
      <p className={cn("mt-1 max-w-[var(--measure-prose)] text-body-sm text-prose")}>{reason}</p>
    </Element>
  );
}
