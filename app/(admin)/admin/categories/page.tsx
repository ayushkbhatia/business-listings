import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { categoryHealth } from "@/lib/taxonomy/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { CategoryTable } from "./CategoryTable";

/**
 * Board 4d — the taxonomy, and the floor under every landing page.
 *
 * `Category.publishThreshold` and `verifiedShareMin` have existed since handoff
 * 0 with no reader. This screen is the reader: each category judged against its
 * own numbers rather than one constant for six very different trades.
 *
 * The column that matters is **Landing pages** — publishable or held back, and
 * held back on which half. That is criterion 6, and it is what separates a
 * directory from a doorway-page farm: a hundred thin "Valves in Umm Al Quwain"
 * pages teach a search engine that the site is mostly filler.
 *
 * Read-only for now. The edit form is a second PR; `editCategory` is built and
 * tested behind it, and shipping a table that tells the truth is worth more
 * than shipping a form that changes numbers nobody has looked at yet.
 */

export const dynamic = "force-dynamic";

export default async function TaxonomyPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [rows, badges] = await Promise.all([
    /*
     * Intro words passed as satisfied. The copy lives with the landing page,
     * which handoff 5 owns, so counting it here would fail every category on a
     * threshold this screen cannot see. The note under the table says so
     * rather than leaving a silent third of the rule unmentioned.
     */
    categoryHealth(),
    getAdminNavBadges(seat),
  ]);

  const blocked = rows.filter((row) => !row.decision.publishable).length;


  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/categories"
      title={t("admin.taxonomy.title")}
      eyebrow={t("admin.taxonomy.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.taxonomy.meta", {
            blocked: formatCount(blocked),
            total: formatCount(rows.length),
          })}
        </span>
      }
    >
      <CategoryTable rows={rows} />

      <div className="mt-[var(--gutter)] flex flex-col gap-1">
        <p className="max-w-prose text-caption text-muted">{t("admin.taxonomy.note")}</p>
        <p className="max-w-prose text-caption text-faint">{t("admin.taxonomy.intro_note")}</p>
      </div>
    </AdminPage>
  );
}
