import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { homeCandidates, popularQueryReport } from "@/lib/content/homepage";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { StatusBadge } from "@/components/display";
import { Panel } from "@/components/structure";
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

  const [candidates, popular, badges] = await Promise.all([
    homeCandidates(),
    popularQueryReport(),
    getAdminNavBadges(seat),
  ]);

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

      {/*
        The other half of the home page, and the half nobody could see. The
        five chips under the hero are the top real searches of the last thirty
        days that returned something — read, never chosen, which is the whole
        argument for them. This is where you notice a term climbing that the
        directory cannot answer.
      */}
      <div className="mt-[var(--section-pad)]">
        <Panel title={t("home.popular_title")} description={t("home.popular_note")}>
          {popular.length === 0 ? (
            <p className="text-body-sm text-muted">{t("home.popular_empty")}</p>
          ) : (
            <table className="w-full border-collapse">
              <caption className="sr-only">{t("home.popular_caption")}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 text-start font-mono text-colhead uppercase text-muted">
                    {t("home.popular_col_query")}
                  </th>
                  <th scope="col" className="w-28 py-2 text-end font-mono text-colhead uppercase text-muted">
                    {t("home.popular_col_searches")}
                  </th>
                  <th scope="col" className="w-40 py-2 text-start font-mono text-colhead uppercase text-muted">
                    {t("home.popular_col_state")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {popular.map((row) => (
                  <tr key={row.query} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-2 text-start text-body-sm font-normal text-ink">
                      {row.query}
                    </th>
                    <td className="py-2 text-end font-mono text-caption tabular-nums text-body">
                      {formatCount(row.searches)}
                    </td>
                    <td className="py-2">
                      {!row.answered ? (
                        // The recruitment signal: buyers are asking and the
                        // directory has nobody to send them to.
                        <StatusBadge tone="warn">{t("home.popular_unanswered")}</StatusBadge>
                      ) : row.onHome ? (
                        <StatusBadge tone="ok">{t("home.popular_on_home")}</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">{t("home.popular_ranked")}</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
