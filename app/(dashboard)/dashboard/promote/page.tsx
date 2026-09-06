import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { catalogueGapSummary } from "@/lib/products/catalogue";
import { slotsFor } from "@/lib/placement/service";
import { Panel } from "@/components/structure";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { leavePlacementQueue, takePlacementSlot } from "./actions";
import { SlotList } from "./SlotList";

/**
 * Board 11e — sponsored placement.
 *
 * The "fix the free stuff first" panel is at the top and comes before anything
 * can be bought. It reads the same number the catalogue screen shows, and it is
 * the reason a seller trusts this upsell: a sponsored slot that puts a product
 * nobody can filter to at the top of a page sells them nothing, and they find
 * that out a month later and never buy one again.
 */
export const metadata = { title: "Sponsored placement" };
export const dynamic = "force-dynamic";

const RULES = ["labelled", "never_outranks", "one_slot"] as const;

export default async function PromotePage() {
  const seat = await requireSellerSeat();

  const [business, catalogue, badges] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: {
        primaryCategoryId: true,
        categories: { select: { categoryId: true } },
      },
    }),
    catalogueGapSummary(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  const categoryIds = [
    ...new Set([business.primaryCategoryId, ...business.categories.map((c) => c.categoryId)]),
  ];
  const slots = await slotsFor(seat.businessId, categoryIds);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/promote"
      eyebrow={t("promote.eyebrow")}
      title={t("promote.title")}
    >
      <div className="flex flex-col gap-5">
        <p className="max-w-prose text-body-sm text-muted">{t("promote.intro")}</p>

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

        <Panel title={t("promote.rules_heading")}>
          <ul className="flex flex-col gap-2">
            {RULES.map((rule) => (
              <li key={rule} className="max-w-prose text-body-sm text-prose">
                {t(`promote.rule.${rule}` as never)}
              </li>
            ))}
          </ul>
        </Panel>

        <SlotList
          slots={slots.map((slot) => ({
            categoryId: slot.categoryId,
            categoryName: slot.categoryName,
            mine: slot.mine,
            takenUntil: slot.takenUntil ? formatDate(slot.takenUntil) : null,
            queued: slot.queued,
            ahead: slot.ahead,
            monthlyPriceAed: slot.monthlyPriceAed,
          }))}
          takeAction={takePlacementSlot}
          leaveAction={leavePlacementQueue}
        />
      </div>
    </SellerPage>
  );
}
