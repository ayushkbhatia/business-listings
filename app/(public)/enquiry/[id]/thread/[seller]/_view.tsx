import { LogoTile } from "@/components/display";
import { VerificationBadge } from "@/components/domain";
import { buttonClassName } from "@/components/primitives";
import { cn } from "@/lib/cn";

/**
 * Board `10h` — the frame around one negotiation: the rail of every thread on
 * the enquiry, and the header naming the supplier this one is with.
 *
 * Presentational and worded already, so the page and the gallery draw the same
 * thing. The thread itself is the child.
 */

export interface RailRowView {
  key: string;
  href: string;
  /** `displayName`, always — the name the storefront this row's supplier links to carries. */
  name: string;
  /** The last message's opening clause (`B4`), a revision's figure, or *No reply yet*. */
  preview: string | null;
  /** `Revised quote · r2 · 12 min ago`. */
  stateLine: string | null;
  tone: "ok" | "plain";
  /** `B9`: a supplier who has said nothing, drawn quieter and never dropped. */
  silent: boolean;
  current: boolean;
  /** `2 unread`, for a thread that is not the open one. */
  unreadLabel: string | null;
}

export interface NegotiationLayoutProps {
  rail: {
    /** `ENQ-8841 · 4 threads`. */
    heading: string;
    /** The requirement's opening clause. */
    eyebrow: string;
    /** Names the rail's navigation landmark. */
    label: string;
    /** Back to the enquiry. */
    href: string;
    rows: readonly RailRowView[];
  };
  header: {
    name: string;
    categoryCode?: string | undefined;
    tier: number;
    badgeLabel: string;
    badgeChecked: string;
    badgeDate?: string;
    /** `Rajesh Nair, Sales · replies in about 2 h`. */
    subline: string;
    storefrontHref: string;
    storefrontLabel: string;
  };
  /** The page's own `h1`; a gallery specimen, which sits under a section heading, takes `h3`. */
  headingAs?: "h1" | "h2" | "h3";
  /**
   * `page` fills the viewport under the 68px nav on a wide screen, with the rail
   * and the log each scrolling on their own, as the board draws it. `specimen`
   * is a fixed height for the gallery.
   */
  frame?: "page" | "specimen";
  children: React.ReactNode;
}

export function NegotiationLayout({ rail, header, headingAs = "h1", frame = "page", children }: NegotiationLayoutProps) {
  const Heading = headingAs;
  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[90rem] border-line bg-paper lg:grid-cols-[18.75rem_minmax(0,1fr)] lg:border-x",
        frame === "page" ? "lg:h-[calc(100dvh-68px)]" : "rounded-card border lg:h-[56rem]",
      )}
    >
      {/*
        One navigation landmark at every width: a column of rows beside the thread
        on a wide screen, a row that scrolls sideways above it on a phone. Drawn
        once so a screen reader meets one list of threads, not two.
      */}
      <nav aria-label={rail.label} className="flex min-h-0 min-w-0 flex-col border-b border-line bg-card lg:border-b-0 lg:border-r">
        <div className="border-b border-line px-4 py-3.5 lg:px-[1.125rem]">
          <a
            href={rail.href}
            className="rounded-tag text-body-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {rail.heading}
          </a>
          {rail.eyebrow ? (
            <p className="mt-1 truncate font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{rail.eyebrow}</p>
          ) : null}
        </div>
        <ul className="relative flex min-h-0 overflow-x-auto lg:block lg:flex-1 lg:overflow-y-auto">
          {rail.rows.map((row) => (
            <li key={row.key} className="min-w-[15.5rem] border-r border-paper-sunk lg:min-w-0 lg:border-b lg:border-r-0">
              <a
                href={row.href}
                aria-current={row.current ? "page" : undefined}
                className={cn(
                  "block h-full px-4 py-3 transition-colors duration-120 ease-out lg:px-[1.125rem] lg:py-3.5",
                  "focus-visible:shadow-focus focus-visible:outline-none",
                  row.current
                    ? "border-b-[2.5px] border-moss bg-paper lg:border-b-0 lg:border-l-[2.5px] lg:pl-[calc(1.125rem-2.5px)]"
                    : "hover:bg-paper",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-body-sm", row.silent && !row.current ? "text-muted" : "text-ink", row.current && "font-medium")}>
                    {row.name}
                  </span>
                  {row.unreadLabel ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span aria-hidden="true" className="size-[7px] rounded-full bg-moss" />
                      <span className="sr-only">{row.unreadLabel}</span>
                    </span>
                  ) : null}
                </span>
                {row.preview ? (
                  <span className={cn("mt-1.5 line-clamp-2 block text-caption leading-snug", row.silent ? "text-faint" : row.current ? "text-body" : "text-muted")}>
                    {row.preview}
                  </span>
                ) : null}
                {row.stateLine ? (
                  <span
                    className={cn(
                      "mt-1.5 block font-mono text-eyebrow uppercase tracking-eyebrow",
                      row.tone === "ok" ? "text-ok-ink" : "text-faint",
                    )}
                  >
                    {row.stateLine}
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/*
        Not a <section> or a <header>: a named region per specimen would repeat
        in the gallery, and the page's own `main` already holds this.
      */}
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-card px-4 py-3.5 md:flex-nowrap md:px-6">
          <LogoTile name={header.name} {...(header.categoryCode ? { categoryCode: header.categoryCode } : {})} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Heading className="text-body font-medium text-ink">
                {header.name}
              </Heading>
              <VerificationBadge
                tier={header.tier}
                label={header.badgeLabel}
                checked={header.badgeChecked}
                {...(header.badgeDate ? { date: header.badgeDate } : {})}
                size="sm"
                compact
              />
            </div>
            <p className="mt-0.5 text-caption text-muted">{header.subline}</p>
          </div>
          <a href={header.storefrontHref} className={buttonClassName({ variant: "secondary", size: "sm" })}>
            {header.storefrontLabel}
          </a>
        </div>
        {children}
      </div>
    </div>
  );
}
