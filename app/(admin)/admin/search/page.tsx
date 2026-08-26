import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { boostList, liveWeights } from "@/lib/search/settings";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { addBoost, saveWeights } from "./actions";
import { RankingEditor, type BoostRowView } from "./RankingEditor";

/**
 * Board 12c — ranking and boosts.
 *
 * `search.ranking.write` and `placement.boost` are both ops lead only, and both
 * have existed as declared capabilities since handoff 3 with nothing behind
 * them. This is what they gate.
 */

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "search.ranking.write")) notFound();

  const [weights, boosts, badges] = await Promise.all([
    liveWeights(),
    boostList(),
    getAdminNavBadges(seat),
  ]);

  const rows: BoostRowView[] = boosts.map((boost) => ({
    id: boost.id,
    businessName: boost.businessName,
    points: `+${boost.points}`,
    reason: boost.reason,
    expires: formatDate(boost.expiresAt),
    expired: boost.expired,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/search"
      title={t("ranking.title")}
      eyebrow={t("ranking.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("ranking.meta", {
            live: formatCount(rows.filter((row) => !row.expired).length),
            expired: formatCount(rows.filter((row) => row.expired).length),
          })}
        </span>
      }
    >
      <RankingEditor
        weights={weights as unknown as Record<string, number>}
        boosts={rows}
        saveWeights={saveWeights}
        addBoost={addBoost}
      />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("ranking.note")}
      </p>
    </AdminPage>
  );
}
