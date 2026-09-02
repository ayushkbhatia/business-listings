import { cn } from "@/lib/cn";

/**
 * The 68px public bar. The search field lives *in* the bar, not under it — on
 * a directory, search is the primary action of the whole site and putting it
 * one scroll away costs more than any amount of hero.
 */
export interface PublicNavLink {
  key: string;
  label: string;
  href: string;
  /**
   * Named in docs/routes.md but not built yet. Rendered as text rather than a
   * link, so the nav is the right shape now without a dead link in it — the
   * same treatment AppSidebar gives an unbuilt admin route.
   */
  later?: boolean;
}

export interface PublicNavProps {
  /** The wordmark. Instrument Serif, per the type rules. */
  brand: React.ReactNode;
  brandHref?: string;
  /** The SearchField, placed in the bar. */
  search?: React.ReactNode;
  links?: readonly PublicNavLink[];
  /** Sign in, or the account menu. */
  actions?: React.ReactNode;
  label: string;
  /** Tooltip on an unbuilt route, already localised. */
  laterLabel?: string;
  /**
   * The `key` of the link this page is. Empty on the home page, which is not
   * one of them — a nav where something is always current cannot say "you are
   * on the directory home", and marking Categories current there would be
   * wrong rather than merely unhelpful.
   */
  active?: string;
}

export function PublicNav({
  brand,
  brandHref = "/",
  search,
  links,
  actions,
  label,
  laterLabel,
  active,
}: PublicNavProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
      <nav
        aria-label={label}
        className="mx-auto flex max-w-7xl items-center gap-4 px-5"
        style={{ height: "68px" }}
      >
        <a
          href={brandHref}
          className={cn(
            "shrink-0 rounded-tag font-serif text-h1-serif text-ink",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          {brand}
        </a>

        {search && <div className="min-w-0 flex-1">{search}</div>}

        {links && links.length > 0 && (
          <ul className="hidden shrink-0 items-stretch gap-1 self-stretch lg:flex">
            {links.map((link) =>
              link.later ? (
                <li key={link.key}>
                  <span
                    aria-disabled="true"
                    title={laterLabel}
                    // Same full-bar height as a real link. The list stretches
                    // its items so the current one's underline can reach the
                    // nav's bottom edge, and a span left on default padding
                    // floats above the others.
                    className="flex h-[68px] cursor-not-allowed items-center px-2.5 text-body-sm text-faint"
                  >
                    {link.label}
                  </span>
                </li>
              ) : (
                <li key={link.key}>
                  <a
                    href={link.href}
                    aria-current={active === link.key ? "page" : undefined}
                    className={cn(
                      // `relative` and the full bar height so the current item's
                      // rule can sit on the nav's own bottom edge, which is
                      // where board 6c draws it — a 2px moss underline meeting
                      // the 1px line under the bar.
                      "relative flex h-[68px] items-center px-2.5 text-body-sm",
                      "transition-colors duration-120 ease-out hover:text-ink",
                      "focus-visible:outline-none focus-visible:shadow-focus",
                      active === link.key ? "font-medium text-ink" : "text-muted",
                      // Weight alone was the whole signal before this. Medium
                      // against regular at 13.5px is not a difference anyone
                      // notices, and "you are here" is worth more than that.
                      active === link.key &&
                        "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-moss after:content-['']",
                    )}
                  >
                    {link.label}
                  </a>
                </li>
              ),
            )}
          </ul>
        )}

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </nav>
    </header>
  );
}
