import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { homeCandidates } from "@/lib/content/homepage";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { toggleHome } from "./actions";
import { HomeCurator, type HomeRowView } from "./HomeCurator";

/**
 * Board 12g — homepage curation.
 *
 * `Category.showOnHome` has been read by `getHomeCategories` since handoff 1
 * and written only by the seed. This is the screen that sets it.
 */

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [candidates, badges] = await Promise.all([homeCandidates(), getAdminNavBadges(seat)]);

  const rows: HomeRowView[] = candidates.map((row) => ({
    id: row.id,
    name: row.name,
    listings: formatCount(row.listings),
    publishable: row.publishable,
    showOnHome: row.showOnHome,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/home"
      title={t("home.title")}
      eyebrow={t("home.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("home.meta", {
            count: formatCount(rows.filter((row) => row.showOnHome).length),
          })}
        </span>
      }
    >
      <HomeCurator rows={rows} save={toggleHome} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">{t("home.note")}</p>
    </AdminPage>
  );
}
