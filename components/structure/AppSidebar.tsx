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
 */
export interface AppSidebarProps {
  groups: readonly ResolvedNavGroup[];
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
  activeHref,
  actor,
  mark,
  footer,
  label,
  lockedLabel,
  laterLabel,
}: AppSidebarProps) {
  return (
    <nav
      aria-label={label}
      className="flex h-full w-[236px] shrink-0 flex-col border-e border-ink-line bg-ink text-on-ink"
    >
      {mark && <div className="border-b border-ink-line px-4 py-3">{mark}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {groups.map((group) => (
          <div key={group.key} className="px-2 py-1.5">
            <h3 className="px-2 py-1 font-mono text-eyebrow uppercase text-on-ink-faint">
              {group.label}
            </h3>
            <ul>
              {group.items.map((item) => {
                const permitted = !item.capability || !actor || can(actor, item.capability);
                const active = item.href === activeHref;
                const reachable = permitted && !item.later;

                const inner = (
                  <>
                    <span className="truncate">{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && reachable && (
                      <span
                        className={cn(
                          "ms-auto rounded-pill px-1.5 py-px font-mono text-eyebrow tabular-nums",
                          active ? "bg-moss-on-ink text-moss-on-ink-text" : "bg-ink-raised text-on-ink-muted",
                        )}
                      >
                        {formatCount(item.badge)}
                      </span>
                    )}
                    {!permitted && (
                      <span className="ms-auto font-mono text-eyebrow uppercase text-on-ink-faint">
                        {lockedLabel}
                      </span>
                    )}
                    {permitted && item.later && (
                      <span className="ms-auto font-mono text-eyebrow uppercase text-on-ink-faint">
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
                          "focus-visible:outline-none focus-visible:shadow-focus-on-ink",
                          active
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
                        className={cn(shared, "cursor-not-allowed text-on-ink-faint")}
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

      {footer && <div className="border-t border-ink-line px-4 py-3">{footer}</div>}
    </nav>
  );
}
