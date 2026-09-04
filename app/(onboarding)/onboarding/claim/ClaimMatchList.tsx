"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClassName } from "@/components/primitives";
import { LogoTile, StatusBadge } from "@/components/display";
import { t } from "@/lib/i18n";

/**
 * The result rows, and the fold at six.
 *
 * Board 2a: *"show six, then '12 more matches' expanding in place. A supplier
 * with a common trade name needs to scan, not paginate."* Expanding in place is
 * the whole requirement — a second page loses the first six from the screen,
 * which is exactly the comparison somebody is trying to make when three of
 * their near-namesakes are in the list.
 *
 * All the rows are already here; the button reveals rather than fetches. That
 * keeps it instant and keeps the count honest, because the number in the button
 * is the number of rows behind it rather than an estimate.
 *
 * Every row is plain data. No function crosses this boundary — the hrefs and
 * the labels are strings computed on the server, which is where the actor is
 * known and where the sign-up detour is decided.
 */

export interface ClaimMatchRow {
  id: string;
  /** The legal name from the licence register. licence-locked */
  name: string;
  categoryCode: string | null;
  meta: string;
  claimed: boolean;
  href: string;
  /** Only the top unclaimed row carries the primary. One per view. */
  primary: boolean;
}

export function ClaimMatchList({
  rows,
  visible,
}: {
  rows: readonly ClaimMatchRow[];
  visible: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, visible);
  const hidden = rows.length - shown.length;

  return (
    <>
      <ul>
        {shown.map((row) => (
          <li
            key={row.id}
            className={[
              // Two lines on a phone, per board 2a's responsive notes: the name
              // and its state on the first, the action across the whole of the
              // second at the 44px target floor. A grid rather than a wrapping
              // flex row, because wrapping puts the badge on a line of its own
              // and turns two lines into three.
              "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5",
              "border-t border-line-mid px-4 py-3.5 first:border-t-0",
              // One line above `sm`, where the columns become flex items again.
              "sm:flex sm:flex-nowrap sm:gap-3",
            ].join(" ")}
          >
            <LogoTile name={row.name} categoryCode={row.categoryCode ?? undefined} size="md" />

            <div className="min-w-0 sm:flex-1">
              <span className="block text-body-sm font-medium text-ink">
                {row.name /* licence-locked — an unclaimed record has no display name */}
              </span>
              <span className="mt-1 block text-caption text-muted">{row.meta}</span>
            </div>

            <StatusBadge tone={row.claimed ? "ok" : "neutral"} shape="pill" size="sm">
              {row.claimed ? t("claim.already_claimed") : t("claim.unclaimed")}
            </StatusBadge>

            {/*
              A link, not a button: it navigates, and a middle click should open
              it. Across all three grid columns below `sm`, which is what makes
              it the full-width 44px action the board asks for on a phone.
            */}
            <Link
              href={row.href}
              className={[
                buttonClassName({
                  variant: row.primary ? "primary" : "secondary",
                  size: "md",
                  block: true,
                }),
                "col-span-3 h-11 w-full sm:h-9 sm:w-auto",
              ].join(" ")}
            >
              {row.claimed ? t("claim.dispute") : t("claim.this_is_us")}
            </Link>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <div className="border-t border-line-mid px-4 py-3">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={[
              "rounded-tag text-body-sm text-moss underline-offset-2",
              "hover:underline focus-visible:shadow-focus focus-visible:outline-none",
            ].join(" ")}
          >
            {t("claim.more_matches", { count: hidden })}
          </button>
        </div>
      )}
    </>
  );
}
