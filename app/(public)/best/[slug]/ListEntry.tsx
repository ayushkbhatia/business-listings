import { VerificationBadge, tierSpec } from "@/components/domain";
import { buttonClassName } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { crawlRel } from "@/lib/seo/crawl-policy";
import type { ListMember } from "@/lib/seo/curated";

/**
 * Board 6b §3 — one hand-written entry.
 *
 * Every figure here is from the snapshot on the selection record, never a live
 * read (acceptance 5). The component takes a `ListMember`, and `ListMember`
 * carries no live fields — that is deliberate, so a future edit reaching for
 * `business.responseTimeMedianMs` has to leave the type to get it.
 *
 * ## No image slot
 *
 * The board draws a 220×160 photograph per entry. Those were site-visit
 * photographs, and visits were cut on 5 Sep — Q3: *"Seller-supplied and
 * labelled, or drop the slot. Note that an unpaid editorial list illustrated
 * with seller marketing material weakens the page's own claim. Dropping costs
 * least."*
 *
 * Dropped. The column runs full width, which §States already specifies: *"the
 * layout must not reserve an empty 220×160 box."* If premises photography ever
 * has a source again this is where it goes back.
 */

/**
 * §3: `--moss` under 2h, `--amber-ink` 2–8h, `--text-muted` above. Same bands as
 * `1b` and `6a`.
 *
 * Not `ResponseTime`, which renders the shared "typically replies in" phrasing
 * with a dot. Here the value sits in a metric strip under a mono eyebrow and the
 * eyebrow is the label, so a second label inside the cell would say it twice.
 * The bands are the shared ones and that is what matters.
 *
 * The spec is explicit that a member may render amber while still inside the
 * published criterion — the band and the criterion are different scales — but
 * that no member may render in a colour reading as a failure of the rule the
 * page just published. Four hours is the criterion and eight is the band's
 * floor, so nothing on a compliant list ever renders muted.
 */
function replyTone(ms: number): string {
  if (ms <= 2 * 3_600_000) return "text-moss";
  if (ms <= 8 * 3_600_000) return "text-warn-ink";
  return "text-muted";
}

interface Cell {
  label: string;
  value: string;
  tone?: string;
}

export function ListEntry({ member }: { member: ListMember }) {
  const spec = tierSpec(member.verificationTier);

  /*
     Three or four cells. §3: the varying fourth is intentional — a fixed grid
     with blanks would say less — so an absent one is absent rather than empty.
  */
  const cells: Cell[] = [];
  if (member.ratingOverall !== null) {
    cells.push({
      label: t("best.metric.rating"),
      value: t("best.rating_value", {
        rating: member.ratingOverall.toFixed(1),
        count: formatCount(member.reviewCount),
      }),
    });
  }
  cells.push({
    label: t("best.metric.replies"),
    value: formatDuration(member.responseTimeMedianMs),
    tone: replyTone(member.responseTimeMedianMs),
  });
  if (member.establishedYear !== null) {
    cells.push({
      label: t("best.metric.established"),
      value: String(member.establishedYear),
    });
  }
  if (member.extraLabel && member.extraValue) {
    cells.push({ label: member.extraLabel, value: member.extraValue });
  }

  const href = `/b/${member.slug}`;
  const enquireHref = `/rfq/new?to=${member.slug}`;

  return (
    <li
      id={`entry-${member.rank}`}
      className="flex gap-5 border-b border-line py-6 last:border-b-0 sm:gap-7"
    >
      {/*
         The rank numeral: decorative weight, in `--line-strong`, not a badge.
         §3 is explicit — the ranking is editorial and the numeral should not
         look like a score. `aria-hidden` because the `ol` already carries the
         position, and a screen reader should hear it once.
      */}
      <span
        aria-hidden
        className="w-8 shrink-0 font-serif text-[28px] leading-none text-line-strong sm:w-11 sm:text-[38px]"
      >
        {String(member.rank).padStart(2, "0")}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h3 className="text-h2 text-ink">
            <a
              href={href}
              className="rounded-tag underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {member.displayName}
            </a>
          </h3>
          <VerificationBadge
            compact
            tier={member.verificationTier}
            label={t(spec.labelKey as never)}
            checked={t(spec.checkedKey as never)}
            date={
              spec.dateField === "verifiedAt" && member.verifiedAt
                ? formatDate(member.verifiedAt)
                : undefined
            }
            tierLabel={t("verify.tier", { tier: member.verificationTier })}
          />
          {member.areaName && (
            <span className="text-caption text-muted">{member.areaName}</span>
          )}
        </div>

        {/*
           The line a reader scans, and the actual product of the curation: it
           is what turns a ranked list into twelve recommendations that do not
           compete with each other. Unique within a list, enforced by a unique
           index rather than by review.

           `whitespace-nowrap` is refused deliberately — §Responsive says the
           line never truncates at any width, and the way to honour that is to
           let it wrap. "If it does not fit, it was written too long."
        */}
        <p className="mt-2 font-mono text-eyebrow uppercase text-moss">
          {t("best.best_for", { what: member.bestFor })}
        </p>

        <p className="mt-2.5 max-w-[640px] text-body leading-relaxed text-prose">
          {member.prose}
        </p>

        <dl className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2 border-y border-fill py-3">
          {cells.map((cell) => (
            <div key={cell.label}>
              <dt className="font-mono text-eyebrow uppercase text-muted">{cell.label}</dt>
              <dd className={cn("mt-1 text-body-sm tabular-nums", cell.tone ?? "text-ink")}>
                {cell.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-3.5 flex flex-wrap gap-2">
          <a href={href} className={buttonClassName({ size: "sm" })}>
            {t("listing.view_storefront")}
          </a>
          {/*
             Acceptance 13: every member links to its storefront **and** its
             quote composer. `crawlRel` because the composer is one uncached,
             `noindex` URL per supplier and there is nothing at the end of it
             for a crawler.
          */}
          <a
            href={enquireHref}
            rel={crawlRel(enquireHref)}
            className={buttonClassName({ size: "sm", variant: "secondary" })}
          >
            {t("listing.enquire")}
          </a>
        </div>
      </div>
    </li>
  );
}
