import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { catalogueCoverage, catalogueEntries } from "@/lib/i18n/coverage";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { StringsBrowser, type StringRowView } from "./StringsBrowser";

/**
 * Board 12g — localisation.
 *
 * A report rather than an editor, and the page says so in its own words rather
 * than leaving somebody to discover there is no save button.
 *
 * The reasoning is in `lib/i18n/coverage.ts`: `t()` is typed against this
 * catalogue, so a missing string is a build failure. A runtime override table
 * would trade that for the ability to fix a typo without a deploy, and nobody
 * has asked for that trade.
 */

export const dynamic = "force-dynamic";

export default async function StringsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const badges = await getAdminNavBadges(seat);
  const coverage = catalogueCoverage();
  const rows: StringRowView[] = catalogueEntries();

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/strings"
      title={t("strings.title")}
      eyebrow={t("strings.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("strings.meta", {
            keys: formatCount(coverage.keys),
            words: formatCount(coverage.words),
            locales: formatCount(coverage.locales.length),
          })}
        </span>
      }
    >
      <Alert tone="info" live="off" fix={t("strings.arabic")}>
        <strong className="font-medium">{t("strings.read_only")}</strong>{" "}
        {t("strings.read_only_body")}
      </Alert>

      <div className="mt-[var(--gutter)]">
        <Panel title={t("strings.sections")}>
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">{t("strings.sections")}</caption>
            <thead>
              <tr>
                {[
                  "strings.col.section",
                  "strings.col.keys",
                  "strings.col.words",
                  "strings.col.plural",
                  "strings.col.interpolated",
                ].map((key, index) => (
                  <th
                    key={key}
                    scope="col"
                    className={
                      index === 0
                        ? "border-b border-line px-2 py-2 text-start font-mono text-eyebrow uppercase text-muted"
                        : "border-b border-line px-2 py-2 text-end font-mono text-eyebrow uppercase text-muted"
                    }
                  >
                    {t(key as never)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coverage.sections.map((section) => (
                <tr key={section.prefix}>
                  <th
                    scope="row"
                    className="border-b border-line px-2 py-2 text-start font-mono text-caption text-ink"
                  >
                    {section.prefix}
                  </th>
                  <td className="border-b border-line px-2 py-2 text-end tabular-nums text-ink">
                    {formatCount(section.keys)}
                  </td>
                  <td className="border-b border-line px-2 py-2 text-end tabular-nums text-muted">
                    {formatCount(section.words)}
                  </td>
                  <td className="border-b border-line px-2 py-2 text-end tabular-nums text-muted">
                    {formatCount(section.plural)}
                  </td>
                  <td className="border-b border-line px-2 py-2 text-end tabular-nums text-muted">
                    {formatCount(section.interpolated)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-3 max-w-prose text-caption text-muted">
            {t("strings.longest", {
              key: coverage.longest.key,
              words: formatCount(coverage.longest.words),
            })}
          </p>
        </Panel>
      </div>

      <div className="mt-[var(--gutter)]">
        <StringsBrowser rows={rows} />
      </div>
    </AdminPage>
  );
}
