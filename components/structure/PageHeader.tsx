import { cn } from "@/lib/cn";

/**
 * The 58px bar at the top of a dashboard or admin page: title, metadata, the
 * autosave line, and the actions.
 *
 * `savedLabel` is where "Saved 20 seconds ago" lives. Autosave is the rule
 * everywhere in the dashboard, and an explicit Save exists only where a change
 * goes to moderation — which is why `actions` is a slot rather than a Save
 * button baked in.
 */
export interface PageHeaderProps {
  title: string;
  /** Mono eyebrow above the title — a ref, a category mark. */
  eyebrow?: string;
  /** Status badges, counts, a verification badge. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** "Saved 20 seconds ago". Announced politely as it changes. */
  savedLabel?: string;
  /** A tab row directly under the header, sharing its bottom border. */
  tabs?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  /** Serif hero title, for a public page rather than a work surface. */
  serif?: boolean;
}

export function PageHeader({
  title,
  eyebrow,
  meta,
  actions,
  savedLabel,
  tabs,
  breadcrumb,
  serif = false,
}: PageHeaderProps) {
  return (
    <header className="border-b border-line bg-card">
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5"
        style={{ minHeight: "58px", paddingBlock: "10px" }}
      >
        <div className="min-w-0">
          {breadcrumb}
          {eyebrow && <p className="font-mono text-eyebrow uppercase text-faint">{eyebrow}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className={cn("truncate text-ink", serif ? "font-serif text-h1-serif" : "text-h1")}>
              {title}
            </h1>
            {meta}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {savedLabel && (
            <span aria-live="polite" className="font-mono text-eyebrow text-faint">
              {savedLabel}
            </span>
          )}
          {actions}
        </div>
      </div>

      {tabs && <div className="px-5">{tabs}</div>}
    </header>
  );
}
