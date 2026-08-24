import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * A titled region inside a page. The dashboard and admin form container.
 *
 * `locked` renders the real panel dimmed with a lock line rather than hiding
 * it. A seller cannot want what they cannot see, and a staff member needs to
 * know a queue exists before they can ask for access to it.
 */
export interface PanelProps {
  title?: string;
  /** A line under the title. Not a tooltip. */
  description?: string;
  /** Buttons on the right of the header. */
  actions?: React.ReactNode;
  /** A mono eyebrow above the title. */
  eyebrow?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  padded?: boolean;
  /** Dims the panel and names what unlocks it. Never hides the feature. */
  locked?: { label: string; action?: React.ReactNode };
}

export function Panel({
  title,
  description,
  actions,
  eyebrow,
  children,
  footer,
  padded = true,
  locked,
}: PanelProps) {
  const titleId = useId();
  return (
    <section
      // A <section> is only a landmark once it has a name. Without this, a
      // screen-reader user cannot jump between the panels on a settings page.
      //
      // No aria-disabled: it is not supported on role=region, and it would be
      // the wrong signal anyway. A locked panel is readable on purpose — the
      // line in the footer says what unlocks it, and the controls inside are
      // disabled individually by whoever put them there.
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        "relative overflow-hidden rounded-panel border border-line bg-card",
        locked && "select-none",
      )}
    >
      {(title || actions || eyebrow) && (
        <header
          className={cn(
            "flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3",
          )}
        >
          <div className="min-w-0">
            {eyebrow && (
              <p className="font-mono text-eyebrow uppercase text-faint">{eyebrow}</p>
            )}
            {title && (
              <h2 id={titleId} className="text-h2 text-ink">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-caption text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}

      <div className={cn(padded && "p-4", locked && "pointer-events-none opacity-40")}>
        {children}
      </div>

      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper-sunk px-4 py-2.5">
          <p className="text-caption text-muted">{locked.label}</p>
          {locked.action}
        </div>
      )}

      {footer && !locked && (
        <div className="border-t border-line bg-paper-sunk px-4 py-2.5">{footer}</div>
      )}
    </section>
  );
}
