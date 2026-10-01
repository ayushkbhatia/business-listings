"use client";

import Link from "next/link";

/**
 * A figure on the overview, as a link into the board that owns it — and a
 * record that somebody followed it.
 *
 * Phase 5 of the handoff: *which figure gets clicked each morning tells you
 * which job is behind most often.* So every figure link posts one small beacon
 * to `/api/admin/overview/opened`, staff-only, and the overview's footnote reads
 * the tally back. `sendBeacon` because the page is usually gone by the time an
 * ordinary request would answer, and a lost count costs nothing.
 *
 * Every prop is data. A server component renders this, and a function cannot
 * cross that boundary (the codebase's rule about it is in memory and in three
 * reverted commits).
 */
export interface OverviewLinkProps {
  href: string;
  /** The figure's key, e.g. `queue` or `report:review_dispute`. */
  figure: string;
  /** The month on screen, `2026-09`. */
  period: string;
  className?: string;
  children: React.ReactNode;
}

const ENDPOINT = "/api/admin/overview/opened";

export function OverviewLink({ href, figure, period, className, children }: OverviewLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        try {
          const body = new Blob([JSON.stringify({ figure, period })], { type: "application/json" });
          navigator.sendBeacon?.(ENDPOINT, body);
        } catch {
          // A count we failed to send is a count we do not have, and nothing else.
        }
      }}
    >
      {children}
    </Link>
  );
}
