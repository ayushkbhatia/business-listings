import Link from "next/link";
import { ChipLink, Eyebrow } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { CategoryAskView } from "@/lib/taxonomy/services-landing";

/**
 * Board `6a-s` — the parts of a services landing page, as plain components.
 *
 * Presentational and server-safe: numbers and words in, markup out, no query.
 * The route composes them in `ServicesLandingPage.tsx` and the gallery renders
 * each state from fixtures, so a specimen cannot show something the page does
 * not — the split `1c-s` made for the blended results for the same reason.
 *
 * Nothing here names a trade. *VAT*, *FTA* and *filing* are the board's
 * fixtures; on the page they arrive as the category's plural noun, the
 * credential it counts and the three questions somebody wrote for it — the
 * owner's rule for the service track: anything that branches per trade lives
 * in data, never in a component.
 */

/* ── The stat line ────────────────────────────────────────────────────────── */

export interface ServicesStatLineProps {
  firms: number;
  /** The page's place — *Business Bay*, or the emirate on the emirate class. */
  place: string;
  verified: number;
  /** Firms holding the trade's register-checked credential. Absent is absent. */
  credential: { kind: string; holders: number } | null;
  /** Median of the members' medians, or null under the floor. */
  replyMedianMs: number | null;
  /** `content_updated_at`, never the build time — board 6a §Freshness. */
  updatedAt: Date | null;
}

/**
 * *37 firms covering Business Bay · 29 licence-verified · 24 registered FTA tax
 * agents · median reply 3h 20m*.
 *
 * Every entry is a query result, and an entry that cannot be measured is
 * absent rather than nought: a trade with no checkable credential has no
 * credential stat, and a page with fewer than five measured firms states no
 * median. "0 registered FTA tax agents" on a page nobody could check would be a
 * claim against every firm on it.
 */
export function ServicesStatLine({
  firms,
  place,
  verified,
  credential,
  replyMedianMs,
  updatedAt,
}: ServicesStatLineProps) {
  const rest = [
    t("landing_services.stat_verified", { display: formatCount(verified) }),
    credential
      ? t(`landing_services.stat_credential.${credential.kind}` as "landing_services.stat_credential.fta_tax_agent", {
          count: credential.holders,
          display: formatCount(credential.holders),
        })
      : null,
    replyMedianMs !== null
      ? t("landing_services.stat_reply", { duration: formatDuration(replyMedianMs) })
      : null,
  ].filter((entry): entry is string => entry !== null);

  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
      <p className="text-body-sm text-body">
        <span className="font-medium text-ink">
          {t("landing_services.stat_firms", { count: firms, display: formatCount(firms) })}
        </span>{" "}
        {t("landing_services.stat_covering", { place })}
      </p>
      <p className="text-body-sm text-muted">{rest.join(" · ")}</p>
      {updatedAt && (
        <p className="font-mono text-eyebrow uppercase text-muted">
          {t("landing.updated", { date: formatDate(updatedAt) })}
        </p>
      )}
    </div>
  );
}

/* ── The fan-out ─────────────────────────────────────────────────────────── */

export type FanOutFacts =
  | {
      state: "match";
      /** Firms the `1h-s` matcher would write to now — at most its cap. */
      count: number;
      cap: number;
      place: string;
      href: string;
      /** Half of briefs had a first reply within this. Null under the floor. */
      measuredMs: number | null;
    }
  | {
      state: "widen";
      /** Firms the matcher finds across the emirate when the area finds none. */
      count: number;
      place: string;
      emirate: string;
      href: string;
    };

/**
 * D-FAN — *Ask 8 firms that cover Business Bay*.
 *
 * The render drew *Ask all 37 at once*, which correction 1 strikes: the brief
 * goes to at most eight, matched per service on a verified licence and coverage
 * of the site (`1h-s` B5), and `1h-s` B10 forbids a number the matcher cannot
 * deliver. So the title states the match, and the body states the rule behind
 * it rather than implying every firm on the page receives the brief.
 *
 * The render's *Most first replies come back within the hour* is a claim, and
 * response time is measured, never claimed: it is `briefFirstReplyMedianMs`,
 * the sentence `1h-s`'s own page prints, or nothing.
 *
 * The anchor carries `data-scope-action`, so `ResultClicks` counts a buyer
 * starting a brief here as acting on this scope — the demand signal `11e`
 * prices from.
 */
export function FanOutCard({ facts, id = "rail-fanout" }: { facts: FanOutFacts; id?: string }) {
  const title =
    facts.state === "match"
      ? t("landing_services.fanout_title", {
          count: facts.count,
          display: formatCount(facts.count),
          place: facts.place,
        })
      : t("landing_services.fanout_widen_title", { emirate: facts.emirate });

  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-card p-5">
      <h2 id={id} className="text-h3 text-ink">
        {title}
      </h2>
      <p className="mt-2 text-body-sm text-body">
        {facts.state === "match"
          ? t("landing_services.fanout_body", { place: facts.place, cap: facts.cap })
          : t("landing_services.fanout_widen", {
              count: facts.count,
              display: formatCount(facts.count),
              place: facts.place,
              emirate: facts.emirate,
            })}
      </p>
      {facts.state === "match" && facts.measuredMs !== null && (
        <p className="mt-2 text-caption text-muted">
          {t("brief.next_measured", { duration: formatDuration(facts.measuredMs) })}
        </p>
      )}
      <Link
        href={facts.href}
        rel={crawlRel(facts.href)}
        data-scope-action="fanout"
        className={cn(buttonClassName({ block: true }), "mt-4")}
      >
        {t("search_blended.rfq_cta")}
      </Link>
    </section>
  );
}

/* ── Link cards ──────────────────────────────────────────────────────────── */

export interface RailLink {
  href: string;
  label: string;
  /** Firms on the linked page — its own count, from its own query. */
  count: number;
}

/**
 * *Nearby* — same trade, other areas — as chips with their counts.
 *
 * Every entry is a live page (`B7`); `lib/seo/landing/links.ts` decides and
 * nothing here filters. An empty card does not render, eyebrow and all: a
 * heading over nothing is the cold-start state reading as broken.
 */
export function RailChipsCard({ id, heading, links }: { id: string; heading: string; links: readonly RailLink[] }) {
  if (links.length === 0) return null;
  return (
    <nav aria-labelledby={id} className="rounded-card border border-line bg-card p-5">
      <Eyebrow as="h2" id={id}>
        {heading}
      </Eyebrow>
      <ul className="mt-3 flex list-none flex-wrap gap-2 p-0">
        {links.map((link) => (
          <li key={link.href}>
            <ChipLink href={link.href} size="sm" count={formatCount(link.count)}>
              {link.label}
            </ChipLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * *Related work* — same place, other trades — as a list of links.
 *
 * A second axis, never merged into the first (`B8`): *VAT consultants in
 * Downtown* and *Auditors in Business Bay* answer different questions, and one
 * list holding both would make a reader work out which is which.
 */
export function RailLinksCard({ id, heading, links }: { id: string; heading: string; links: readonly RailLink[] }) {
  if (links.length === 0) return null;
  return (
    <nav aria-labelledby={id} className="rounded-card border border-line bg-card p-5">
      <Eyebrow as="h2" id={id}>
        {heading}
      </Eyebrow>
      <ul className="mt-3 flex list-none flex-col gap-2.5 p-0">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ── What to ask ─────────────────────────────────────────────────────────── */

/**
 * *What to ask VAT consultants in Business Bay* — three questions per trade.
 *
 * `B9`: per category, never per area. The questions come from the trade's
 * record and render on every page in it; only the heading names the place. A
 * trade nobody has written questions for renders no block — never a generic
 * set standing in for one.
 *
 * A real `<section>` with its heading as its name, and `h3` questions — the
 * same outline the FAQ below it uses, so a screen reader reads two blocks of
 * questions as two blocks.
 */
export function WhatToAsk({ heading, asks }: { heading: string; asks: readonly CategoryAskView[] }) {
  if (asks.length === 0) return null;
  return (
    <section aria-labelledby="what-to-ask" className="rounded-card border border-line bg-card p-5 sm:p-6">
      <h2 id="what-to-ask" className="text-h3 text-ink">
        {heading}
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        {asks.map((ask) => (
          <div key={ask.position}>
            <h3 className="text-body-sm font-medium text-ink">{ask.question}</h3>
            <p className="mt-1.5 max-w-[var(--measure-prose)] text-body-sm text-prose">{ask.why}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
