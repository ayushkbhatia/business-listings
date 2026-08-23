import { cn } from "@/lib/cn";

/**
 * The frame for any full-screen editing surface — the storefront builder, the
 * CSV import mapper, the quote composer.
 *
 * An ink bar and no sidebar. The point is that the surface below is the whole
 * job: nothing else on screen competes for attention, and the only ways out are
 * the two in the bar.
 *
 * Exit sits on the left because it is the escape route, and the commit action
 * sits on the right where the eye finishes.
 */
export interface BuilderChromeProps {
  title: string;
  /** A mono ref or breadcrumb under the title. */
  subtitle?: string;
  /** Leave, cancel, back. */
  exit: React.ReactNode;
  /** Save, publish, send. */
  commit?: React.ReactNode;
  /** Autosave line, validity state, a step indicator. */
  status?: React.ReactNode;
  children: React.ReactNode;
  /** A secondary strip under the bar — a device switcher, a zoom control. */
  toolbar?: React.ReactNode;
}

export function BuilderChrome({
  title,
  subtitle,
  exit,
  commit,
  status,
  children,
  toolbar,
}: BuilderChromeProps) {
  return (
    <div data-density="comfortable" className="flex h-dvh flex-col bg-paper">
      <header
        className={cn(
          "flex shrink-0 items-center gap-3 border-b border-ink-line bg-ink px-4 text-on-ink",
        )}
        style={{ height: "58px" }}
      >
        <div className="shrink-0">{exit}</div>

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-body-sm text-on-ink">{title}</p>
          {subtitle && (
            <p className="truncate font-mono text-eyebrow text-on-ink-faint">{subtitle}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {status && <span className="font-mono text-eyebrow text-on-ink-faint">{status}</span>}
          {commit}
        </div>
      </header>

      {toolbar && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card px-4 py-2">
          {toolbar}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
