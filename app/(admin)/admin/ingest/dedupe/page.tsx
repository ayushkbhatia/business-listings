import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { openCandidates, REVERSIBLE_DAYS } from "@/lib/dedupe/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { DedupeTable, type CandidateRow, type Signal } from "./DedupeTable";
import { dismiss, merge } from "./actions";

/**
 * Board 12b — dedupe and merge.
 *
 * `business.merge` is ops lead alone: a merge rewrites slugs, creates a 301 and
 * moves somebody's reviews onto another company's page. It is reversible for
 * thirty days and that is not the same as harmless.
 */

export const dynamic = "force-dynamic";

export default async function DedupePage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "business.merge")) notFound();

  const [candidates, badges] = await Promise.all([
    openCandidates(undefined, 200),
    getAdminNavBadges(seat),
  ]);

  const rows: CandidateRow[] = candidates.map((candidate) => ({
    id: candidate.id,
    score: candidate.score,
    band: candidate.band,
    // `signals` is Json on the row, so it is unknown to the type system on the
    // way out. Narrowed once, here, rather than trusted everywhere.
    signals: Array.isArray(candidate.signals) ? (candidate.signals as unknown as Signal[]) : [],
    keepId: candidate.keep.id,
    keepName: candidate.keep.displayName,
    keepSlug: candidate.keep.slug,
    absorbId: candidate.absorb.id,
    absorbName: candidate.absorb.displayName,
    absorbSlug: candidate.absorb.slug,
    // What the absorbed listing brings with it, which is what a wrong merge
    // moves onto somebody else's page.
    reviewsAtRisk: candidate.absorb._count.reviews,
    enquiriesAtRisk: candidate.absorb._count.recipients,
  }));

  const certain = rows.filter((row) => row.band === "certain").length;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/ingest/dedupe"
      title={t("admin.dedupe.title")}
      eyebrow={t("admin.dedupe.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.dedupe.meta", {
            certain: formatCount(certain),
            probable: formatCount(rows.length - certain),
          })}
        </span>
      }
    >
      <DedupeTable rows={rows} merge={merge} dismiss={dismiss} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.dedupe.note", { days: String(REVERSIBLE_DAYS) })}
      </p>
    </AdminPage>
  );
}
