import { notFound } from "next/navigation";
import { Panel } from "@/components/structure";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { fieldProposals, templateLibrary } from "@/lib/spec/versions";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { TemplateTable } from "./TemplateTable";

/**
 * Board 4e — the spec library.
 *
 * Two things on one screen, because they are two halves of the same job:
 *
 *   - **What the platform defines**, per category, with the version and how
 *     many sellers have cloned it. The clone count is the blast radius of a
 *     change, and it belongs next to the change rather than in a report.
 *   - **What sellers keep inventing**, ranked by how many of them invented it.
 *     That promotion path is what stops 40,000 businesses inventing 40,000
 *     attribute names, and it was not a countable thing until step 1 gave it a
 *     row — `SellerTemplate.fieldMappings` is an opaque Json blob.
 *
 * The `in grace` count is the one to read first. A field inside its grace
 * period is a deadline somebody set and a catalogue somebody has to fill in
 * before it, and it stops being visible the moment it expires.
 */

export const dynamic = "force-dynamic";

export default async function SpecLibraryPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [templates, proposals, badges] = await Promise.all([
    templateLibrary(),
    fieldProposals(),
    getAdminNavBadges(seat),
  ]);

  const live = templates.filter((template) => template.status === "live");
  const inGrace = templates.reduce((sum, template) => sum + template.inGrace, 0);


  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/spec-library"
      title={t("admin.spec.title")}
      eyebrow={t("admin.spec.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.spec.meta", {
            live: formatCount(live.length),
            grace: formatCount(inGrace),
          })}
        </span>
      }
    >
      <TemplateTable rows={templates} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.spec.note")}
      </p>

      <div className="mt-[var(--gutter)]">
        <Panel title={t("admin.spec.proposals")}>
          {proposals.length === 0 ? (
            <p className="text-caption text-muted">{t("admin.spec.proposals_empty")}</p>
          ) : (
            <ul className="flex flex-col">
              {proposals.map((proposal) => (
                <li
                  key={proposal.id}
                  className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 first:border-t-0"
                >
                  <span className="min-w-0 text-body-sm text-body">
                    {proposal.sampleLabel}
                    <span className="ms-2 font-mono text-eyebrow uppercase text-faint">
                      {proposal.category.name}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-caption tabular-nums text-muted">
                    {t("admin.spec.proposal_count", {
                      count: formatCount(proposal.businessCount),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
