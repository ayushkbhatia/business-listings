import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/display";
import { Panel } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { mayBuyPlacement } from "@/lib/auth/guards";
import { VAT_RATE } from "@/lib/billing/proration";
import { lastRunImpact } from "@/lib/placement/impact";
import { slotsFor } from "@/lib/placement/service";
import { catalogueGapSummary } from "@/lib/products/catalogue";
import { formatAED, formatCount, formatDate, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { leavePlacementQueue, takePlacementSlot } from "./actions";
import { SlotBoard, type SlotRow } from "./SlotBoard";

/**
 * Board 11e — sponsored placement.
 *
 * The only place on the platform where a seller can buy position, and it is
 * deliberately small: one slot per subcategory and emirate, a price that tracks
 * what buyers do there, a waiting list rather than an auction, and a third of
 * the screen arguing against the purchase.
 *
 * > Always labelled, always one per page, and it never outranks a result the
 * > buyer's own filter selected. **Sponsorship buys position, not the
 * > appearance of trust.**
 *
 * That sentence is the platform's whole position on paid visibility and it is
 * consistent with the boards either side: `6h`'s homepage rail states nobody
 * can pay to be there, and `12c` caps plan tier at 10 of 100 in the ranking
 * vector. Paid visibility lives here, in search results, labelled — and nowhere
 * else.
 *
 * ## The fix-the-free-stuff panel comes first
 *
 * It reads the same number the catalogue screen shows, and it is the reason a
 * seller trusts this upsell: a sponsored slot that puts a product nobody can
 * filter to at the top of a page sells them nothing, and they find that out a
 * month later and never buy one again. Board `11e` calls it *"the single
 * clearest signal that the ranking is not for sale"* and asks for it above the
 * fold, which is where it is.
 */
export const metadata = { title: t("promote.title") };
export const dynamic = "force-dynamic";

const RULES = ["labelled", "never_outranks", "one_slot"] as const;

/**
 * When this booking reaches an invoice — `Corrected at export` §2.
 *
 * Derived, never a fixed string: the board's primary button offered `Start on
 * 1 Sep` on the seventeenth of September. Since D2 a slot belongs to the
 * subscription that bought it, so the honest date is the seller's own renewal —
 * and where there is no subscription to renew, the next month boundary.
 */
function billedOn(renewsAt: Date | null, now: Date): Date {
  if (renewsAt && renewsAt > now) return renewsAt;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export default async function PromotePage() {
  const seat = await requireSellerSeat();
  /*
     The route gate the screen never had.

     `takeSlot` asserts `placement.purchase` and the page asserted nothing, so a
     seat that cannot buy still read the whole screen — every slot, who holds
     it, and the price — and got a refusal only after pressing the button.
     `notFound` rather than a disabled page, the same answer `analytics` gives a
     seat without `analytics.read`: a screen somebody cannot use is a screen
     that does not exist for them.
  */
  if (!mayBuyPlacement(seat.actor)) notFound();

  const now = new Date();
  const [subscription, catalogue, badges, slots, impact] = await Promise.all([
    prisma.subscription.findUnique({
      where: { businessId: seat.businessId },
      select: { renewsAt: true },
    }),
    catalogueGapSummary(seat.businessId),
    getNavBadges(seat.businessId),
    slotsFor(seat.businessId, undefined, now),
    lastRunImpact(seat.businessId, now),
  ]);

  const rows: SlotRow[] = slots.map((slot) => ({
    categoryId: slot.categoryId,
    categoryName: slot.categoryName,
    emirate: slot.emirate,
    placeName: slot.emirate ? t(`emirate.${slot.emirate}` as never) : t("promote.place.national"),
    band: slot.band,
    monthlyPriceAed: slot.monthlyPriceAed,
    paidMonthlyAed: slot.paidMonthlyAed,
    /*
       Measured or absent. The board prints `14,208 searches a month`; a scope
       this platform has never had a visitor in prints that it has not been
       measured, rather than a nought that reads as a measurement.
    */
    demand:
      slot.measuredTo === null
        ? null
        : t("promote.demand.measured", {
            searches: formatCount(slot.appearances ?? 0),
            clicks: formatCount(slot.clicks ?? 0),
            when: formatDate(slot.measuredTo),
          }),
    /*
       Board `B3`, and the blocker it names is stale: `runPositionSnapshots` has
       written `CategoryRankDay` per scope per night since the `3a`/`3l`
       amendment, so the organic position is a real read.
    */
    position:
      slot.rank === null || slot.rankTotal === null
        ? null
        : t("promote.position.ranked", {
            rank: formatCount(slot.rank),
            total: formatCount(slot.rankTotal),
          }),
    mine: slot.mine,
    takenUntil: slot.takenUntil ? formatDate(slot.takenUntil) : null,
    queued: slot.queued,
    ahead: slot.ahead,
    freed: slot.freed,
  }));

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/promote"
      eyebrow={t("promote.eyebrow")}
      title={t("promote.title")}
      meta={<span className="text-caption text-muted">{t("promote.billed_with")}</span>}
    >
      <div className="flex flex-col gap-5">
        {/*
          Before the buy buttons, not after. This is the panel that makes the
          upsell honest, and an honest upsell that appears below the thing it is
          warning about is decoration.
        */}
        <Panel title={t("promote.fix_first_heading")}>
          {catalogue.missingFilterValue > 0 ? (
            <>
              <p className="max-w-prose text-body-sm text-prose">
                {t("promote.fix_first", {
                  count: formatCount(catalogue.missingFilterValue),
                })}
              </p>
              <Link
                href="/dashboard/products"
                className="mt-2 inline-block text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("promote.fix_first_link")}
              </Link>
            </>
          ) : (
            <p className="max-w-prose text-body-sm text-muted">{t("promote.fix_first_clear")}</p>
          )}
        </Panel>

        <div>
          <h2 className="text-h2 text-ink">{t("promote.where_heading")}</h2>
          <p className="mt-1 max-w-prose text-body-sm text-muted">{t("promote.intro")}</p>
        </div>

        {rows.length === 0 ? (
          <Panel title={t("promote.empty.title")}>
            <p className="max-w-prose text-body-sm text-muted">{t("promote.empty.body")}</p>
          </Panel>
        ) : (
          <SlotBoard
            slots={rows}
            vatRateLabel={formatPercent(VAT_RATE)}
            billedOn={formatDate(billedOn(subscription?.renewsAt ?? null, now))}
            takeAction={takePlacementSlot}
            leaveAction={leavePlacementQueue}
          />
        )}

        {/*
           The measurement rail. `B6`: against a comparable month, never against
           zero — the sentence is the difference between a metric and a sales
           figure, so it renders with the numbers rather than under them.
        */}
        <Panel title={t("promote.impact.title")}>
          {impact === null ? (
            <p className="max-w-prose text-body-sm text-muted">{t("promote.impact.none")}</p>
          ) : (
            <>
              <p className="text-caption text-muted">
                {t("promote.impact.ran", {
                  scope: impact.categoryName,
                  from: formatDate(impact.ranFrom),
                  to: formatDate(impact.ranTo),
                })}
              </p>
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="font-mono text-eyebrow uppercase text-muted">
                    {t("promote.impact.extra")}
                  </dt>
                  <dd className="mt-0.5 font-mono text-h3 tabular-nums text-ink">
                    {impact.extra > 0 ? `+${formatCount(impact.extra)}` : formatCount(impact.extra)}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-eyebrow uppercase text-muted">
                    {t("promote.impact.cost_each")}
                  </dt>
                  <dd className="mt-0.5 font-mono text-h3 tabular-nums text-ink">
                    {impact.costPerEnquiryAed === null
                      ? t("promote.impact.no_extra")
                      : formatAED(impact.costPerEnquiryAed)}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-eyebrow uppercase text-muted">
                    {t("promote.impact.won")}
                  </dt>
                  <dd className="mt-0.5 font-mono text-h3 tabular-nums text-ink">
                    {formatCount(impact.won)} · {formatAED(impact.wonAed)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 max-w-prose text-caption text-muted">
                {t("promote.impact.basis", { count: formatCount(impact.before) })}
              </p>
            </>
          )}
        </Panel>

        {/*
           How a sponsored slot looks to a buyer, and the sentence under it —
           the one this board exists to keep true.
        */}
        <Panel title={t("promote.preview.title")}>
          <div className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-line p-3">
            <StatusBadge tone="neutral" size="sm">
              {t("results.sponsored")}
            </StatusBadge>
            <span className="text-body-sm font-medium text-ink">{seat.businessName}</span>
            <span className="text-caption text-muted">{t("promote.preview.row")}</span>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {RULES.map((rule) => (
              <li key={rule} className="max-w-prose text-body-sm text-prose">
                {t(`promote.rule.${rule}` as never)}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </SellerPage>
  );
}
