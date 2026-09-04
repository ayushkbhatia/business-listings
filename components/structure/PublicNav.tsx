import { cn } from "@/lib/cn";

/**
 * The 68px public bar. The search field lives *in* the bar, not under it — on
 * a directory, search is the primary action of the whole site and putting it
 * one scroll away costs more than any amount of hero.
 *
 * Below `sm` the bar is two rows rather than one: brand and actions, then the
 * search across the full width. One row cannot hold all three on a phone — at
 * 375px the wordmark is 168px and the action button 123px of a 335px content
 * box, which left the field 12px to render a 46px input in and put it under
 * the button. Two rows is the only shape that keeps the field usable without
 * shrinking the wordmark to a monogram or pushing search off the bar, and it
 * holds on every public surface because they all share this component.
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
        className={cn(
          "mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 px-5",
          // The wrap is what makes the second row, so it is on below `sm` and
          // off above it. It also means no width can push the bar wider than
          // the viewport: at 320px the action button drops to a row of its own
          // rather than overflowing, which is what tests/e2e/viewport.spec.ts
          // is there to catch.
          "gap-y-2 py-2 sm:flex-nowrap sm:py-0",
        )}
        // `min-height`, not `height`. The bar is 68px while it is one row and
        // 112px once it wraps; a fixed height would let the search row spill
        // out from under the bottom border.
        style={{ minHeight: "68px" }}
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

        {search && (
          <div
            className={cn(
              /*
                 `order-last` and a full width put the field on its own row
                 below `sm`. DOM order is left alone so the desktop bar — where
                 the field sits between the brand and the links — still reads
                 and tabs in the same order it is drawn. The cost is that on a
                 phone the tab lands on the search before the action button
                 above it; the more important of the two comes first, which is
                 the right way round for the transposition to fall.
              */
              "order-last w-full min-w-0",
              // 44px on mobile, the field's own 36px from `sm` up. `min-height`
              // rather than a taller size, so this cannot race the `h-9` that
              // controlShell already puts on the input.
              "[&_input]:min-h-11 sm:[&_input]:min-h-0",
              "sm:order-none sm:w-auto sm:flex-1",
            )}
          >
            {search}
          </div>
        )}

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

        {/*
           `ms-auto` matters only on the wrapped rows, where the search is no
           longer between the brand and the actions to hold them apart. Above
           `sm` the search's `flex-1` has already taken the slack.
        */}
        {actions && <div className="ms-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </nav>
    </header>
  );
}
