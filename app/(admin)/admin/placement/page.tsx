import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { DEFAULT_BASE_PRICE_AED, DEFAULT_STEP_BPS } from "@/lib/placement/bands";
import { ladder, rateCard } from "@/lib/placement/demand";
import { bandOccupancy } from "@/lib/placement/rate-card";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { saveBandPrice, saveCurve } from "./actions";
import { RateCard, type Rung } from "./RateCard";

/**
 * Board `11e` — what a sponsored slot costs, by demand band.
 *
 * Ten rungs, priced from a floor and a step, and a scope climbs them by
 * attracting traffic rather than by anybody typing a number. What is editable
 * here is the *ladder*, not where a scope sits on it: that is measured, monthly,
 * from what buyers did — which is the whole reason this screen has no control
 * for moving one trade up a band.
 *
 * Held at `plan.entitlements.write` — ops lead and finance, the one commercial
 * row §07 gives them both. A placement price is the same kind of decision as a
 * plan price and made by the same people, and inventing a capability for one
 * screen would put a row in the matrix that says nothing the existing one does
 * not.
 */

export const dynamic = "force-dynamic";

export default async function PlacementPricingPage() {
  const seat = await requireStaff();
  const mayEdit = can(seat.actor, "plan.entitlements.write");
  if (!can(seat.actor, "revenue.read") && !mayEdit) notFound();

  const [rungs, card, occupancy, badges] = await Promise.all([
    ladder(),
    rateCard(),
    bandOccupancy(),
    getAdminNavBadges(seat),
  ]);

  const rows: Rung[] = rungs.map((rung) => ({
    band: rung.band,
    monthlyPriceAed: rung.monthlyPriceAed,
    override: rung.override,
    scopes: occupancy.get(rung.band) ?? 0,
  }));

  const measured = [...occupancy.values()].reduce((total, count) => total + count, 0);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/placement"
      title={t("admin.placement.title")}
      eyebrow={t("admin.placement.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {measured === 0
            ? t("admin.placement.meta_none")
            : t("admin.placement.meta", { count: formatCount(measured) })}
        </span>
      }
    >
      <p className="mb-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.placement.intro")}
      </p>

      <RateCard
        rungs={rows}
        basePriceAed={card.basePriceAed || DEFAULT_BASE_PRICE_AED}
        // Stored as basis points, read as the percentage a person types.
        stepPercent={(card.stepBps || DEFAULT_STEP_BPS) / 100}
        canEdit={mayEdit}
        saveCurve={saveCurve}
        saveBandPrice={saveBandPrice}
      />

      <div className="mt-[var(--gutter)] flex flex-col gap-2">
        <p className="max-w-prose text-caption text-muted">{t("admin.placement.note_measured")}</p>
        <p className="max-w-prose text-caption text-muted">{t("admin.placement.note_frozen")}</p>
      </div>
    </AdminPage>
  );
}
