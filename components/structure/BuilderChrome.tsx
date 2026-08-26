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
  /**
   * The content region's element. `main` in the product; `div` when a shell
   * is embedded inside another page, as the gallery does — a page may only
   * have one main landmark.
   */
  contentAs?: "main" | "div";
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
  contentAs = "main",
}: BuilderChromeProps) {
  const Content = contentAs;
  return (
    <div data-density="comfortable" className="flex h-dvh flex-col bg-paper">
      {/*
        A banner when this is the whole page, and nothing when it is embedded.
        A `header` that is not a direct child of `body` carries no role, which
        left the bar's contents outside every landmark — axe's `region` rule,
        and a real navigation problem for anybody moving by landmark. The
        gallery embeds this inside a page that already has a banner, so the role
        is conditional rather than always on: two banners is its own violation.
      */}
      <header
        {...(contentAs === "main" ? { role: "banner" as const } : {})}
        className="flex shrink-0 flex-col border-b border-ink-line bg-ink text-on-ink"
      >
        <div
          className={cn("flex shrink-0 items-center gap-3 px-4")}
          style={{ height: "58px" }}
        >
          <div className="shrink-0">{exit}</div>

          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-body-sm text-on-ink">{title}</p>
            {subtitle && (
              <p className="truncate font-mono text-eyebrow text-on-ink-faint">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {status && (
              <span className="font-mono text-eyebrow text-on-ink-faint">
                {status}
              </span>
            )}
            {commit}
          </div>
        </div>

        {/*
          Inside the banner, not beside it. A second strip of chrome outside
          every landmark is the same problem the bar had.
        */}
        {toolbar && (
          /*
           * Inside the banner so its contents are in a landmark, and on its own
           * surface so it looks the way it did — the first version inherited
           * the bar's ink and put an unselected tab at 3.69:1, which the
           * gallery's contrast set caught immediately.
           */
          <div className="flex shrink-0 items-center gap-2 border-t border-line bg-card px-4 py-2 text-ink">
            {toolbar}
          </div>
        )}
      </header>

      <Content className="min-h-0 flex-1 overflow-auto">{children}</Content>
    </div>
  );
}
