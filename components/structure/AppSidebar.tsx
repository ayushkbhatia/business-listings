"use client";

import { cn } from "@/lib/cn";
import type { Actor } from "@/lib/auth/roles";
import { can } from "@/lib/auth/can";
import { formatCount } from "@/lib/format";
import type { ResolvedNavGroup } from "./nav-config";

/**
 * One sidebar, two surfaces. Dashboard and admin differ in the config they are
 * handed and the density they inherit — not in their code. 236px, per the
 * design system.
 *
 * An item the actor cannot reach renders locked rather than vanishing. A staff
 * member has to know a queue exists to ask for access to it, and a seller
 * cannot want what they cannot see.
 *
 * A `later` route is named so the nav shape is right now, and is not a link
 * until its handoff lands. No dead links.
 *
 * Labels arrive resolved. Pass `resolveNav(DASHBOARD_NAV, t)` — the sidebar
 * still never imports t(), and a server page can render it, which it could not
 * when the API took a translate function across the client boundary.
 *
 * ## Two tones, and why the seller's is the light one
 *
 * `ink` is the staff console: a dark rail against compact tables, which is what
 * the design system drew and what /admin has always used.
 *
 * `paper` is the seller dashboard, and it is what board 8a's render shows — a
 * white rail carrying the supplier's own identity at the top. The difference is
 * whose surface it is. A staff member moves between accounts all day and the
 * chrome is the platform's; a supplier has one listing and the sidebar is the
 * first thing on the page that says whose it is. The dark rail read as somebody
 * else's software.
 *
 * The dot on each row is not decoration either: it is what makes the active
 * item legible on a light rail without a heavy fill, and it carries no meaning
 * of its own — `aria-current` does that.
 */
export type SidebarTone = "ink" | "paper";

export interface AppSidebarProps {
  groups: readonly ResolvedNavGroup[];
  /** `ink` for the staff console, `paper` for the seller dashboard. */
  tone?: SidebarTone;
  /**
   * Whose account this is, at the top of the rail. Seller surfaces only.
   *
   * A slot rather than three props, because the caller already has the business
   * and this component must not learn how to format a plan name.
   */
  identity?: React.ReactNode;
  /** Current route, matched against item hrefs. */
  activeHref: string;
  /** Gates items by capability. Omit to show everything unlocked. */
  actor?: Actor;
  /** The wordmark or admin mark at the top. */
  mark?: React.ReactNode;
  footer?: React.ReactNode;
  /** Required: names the navigation region. */
  label: string;
  lockedLabel: string;
  laterLabel: string;
}

export function AppSidebar({
  groups,
  tone = "ink",
  identity,
  activeHref,
  actor,
  mark,
  footer,
  label,
  lockedLabel,
  laterLabel,
}: AppSidebarProps) {
  const paper = tone === "paper";
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex h-full w-[236px] shrink-0 flex-col border-e",
        paper ? "border-line bg-card text-body" : "border-ink-line bg-ink text-on-ink",
      )}
    >
      {mark && (
        <div className={cn("border-b px-4 py-3", paper ? "border-line" : "border-ink-line")}>
          {mark}
        </div>
      )}
      {identity && (
        <div className={cn("border-b px-3 py-3", paper ? "border-line" : "border-ink-line")}>
          {identity}
        </div>
      )}

      {/*
        Focusable, because it scrolls. A scrollable region with no focusable
        descendant cannot be scrolled by keyboard at all — and this one can end
        up with none, since an item the actor cannot reach and an item whose
        handoff has not landed both render as text rather than as a link.
      */}
      <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto py-2">
        {groups.map((group) => (
          <div key={group.key} className="px-2 py-1.5">
            {/*
              `text-muted` on the light rail, not `text-faint`.

              Board 8a's render draws these headings in the faint token, which
              is 2.70:1 on `--card` — well under the 4.5:1 §09.2 asks for text
              this size, and this is 9.5px uppercase mono, which is the hardest
              thing on the page to read. Muted is 4.45:1: still short of the
              floor and the whole palette shares that problem (docs/contrast.md
              pins ten pairings), but it is the better of the two and it costs
              the design nothing — the heading still recedes behind the rows.
            */}
            <h3
              className={cn(
                "px-2 py-1 font-mono text-eyebrow uppercase",
                paper ? "text-muted" : "text-on-ink-faint",
              )}
            >
              {group.label}
            </h3>
            <ul>
              {group.items.map((item) => {
                const permitted = !item.capability || !actor || can(actor, item.capability);
                const active = item.href === activeHref;
                const reachable = permitted && !item.later;

                const inner = (
                  <>
                    {/*
                      Decorative. `aria-current` carries "you are here"; this
                      makes it visible on a light rail without a heavy fill, and
                      §09.2 forbids colour as the only signal either way.
                    */}
                    {paper && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-[5px] shrink-0 rounded-pill",
                          active ? "bg-moss-on-ink" : "bg-line-mid",
                        )}
                      />
                    )}
                    <span className="truncate">{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && reachable && (
                      <span
                        className={cn(
                          "ms-auto rounded-pill px-1.5 py-px font-mono text-eyebrow tabular-nums",
                          active
                            ? "bg-moss-on-ink text-moss-on-ink-text"
                            : paper
                              ? "bg-fill text-muted"
                              : "bg-ink-raised text-on-ink-muted",
                        )}
                      >
                        {formatCount(item.badge)}
                      </span>
                    )}
                    {!permitted && (
                      <span
                        className={cn(
                          "ms-auto font-mono text-eyebrow uppercase",
                          paper ? "text-faint" : "text-on-ink-faint",
                        )}
                      >
                        {lockedLabel}
                      </span>
                    )}
                    {permitted && item.later && (
                      <span
                        className={cn(
                          "ms-auto font-mono text-eyebrow uppercase",
                          paper ? "text-faint" : "text-on-ink-faint",
                        )}
                      >
                        {laterLabel}
                      </span>
                    )}
                  </>
                );

                const shared = cn(
                  "flex w-full items-center gap-2 rounded-ctl px-2 py-1.5 text-left text-body-sm",
                  "transition-colors duration-120 ease-out",
                );

                return (
                  <li key={item.key}>
                    {reachable ? (
                      <a
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          shared,
                          "focus-visible:outline-none",
                          paper
                            ? "focus-visible:shadow-focus"
                            : "focus-visible:shadow-focus-on-ink",
                          paper
                            ? active
                              ? "bg-ink font-medium text-on-ink"
                              : "text-body hover:bg-fill hover:text-ink"
                            : active
                              ? "bg-ink-raised text-on-ink"
                              : "text-on-ink-muted hover:bg-ink-raised hover:text-on-ink",
                        )}
                      >
                        {inner}
                      </a>
                    ) : (
                      <span
                        aria-disabled="true"
                        title={permitted ? laterLabel : lockedLabel}
                        className={cn(
                          shared,
                          "cursor-not-allowed",
                          paper ? "text-faint" : "text-on-ink-faint",
                        )}
                      >
                        {inner}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {footer && (
        <div className={cn("border-t px-4 py-3", paper ? "border-line" : "border-ink-line")}>
          {footer}
        </div>
      )}
    </nav>
  );
}
