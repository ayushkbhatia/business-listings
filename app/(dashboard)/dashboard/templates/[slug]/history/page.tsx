import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { getSellerTemplateBySlug, revisionsFor } from "@/lib/catalogue/template";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../../_shell";
import { restoreRevision } from "../../actions";

/**
 * Board 3h §8 — `Revision history`, and rolling back to any prior one.
 *
 * Each row is a snapshot rather than a diff, so restoring reproduces field
 * order and options exactly. Restoring writes a *new* revision carrying the old
 * overlay: the history is append-only, a rollback can itself be rolled back,
 * and the record of what happened never depends on what happened next.
 */
export const metadata = { title: t("template.history") };
export const dynamic = "force-dynamic";

export default async function HistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const seat = await requireSellerSeat();
  if (!can(seat.actor, "product.edit")) notFound();

  const { slug } = await params;
  const view = await getSellerTemplateBySlug(seat.businessId, slug);
  if (!view) notFound();

  const [revisions, badges] = await Promise.all([
    revisionsFor(seat.businessId, view.id),
    getNavBadges(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/templates"
      eyebrow={t("template.eyebrow")}
      title={t("template.history_heading")}
      breadcrumb={
        <Link
          href={`/dashboard/templates/${view.slug}`}
          className="text-caption underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
        >
          {view.name}
        </Link>
      }
    >
      {revisions.length === 0 ? (
        <p className="max-w-prose text-body-sm text-muted">{t("template.history_none")}</p>
      ) : (
        <ol className="flex flex-col gap-[var(--gutter)]">
          {revisions.map((revision) => (
            <li key={revision.revision}>
              <Panel
                title={t("template.history_row", { revision: String(revision.revision) })}
                description={`${formatDateTime(revision.createdAt)} · ${
                  revision.author
                    ? t("template.history_by", { name: revision.author })
                    : t("template.history_anon")
                }`}
                actions={
                  /*
                     The current revision has nothing to restore to — it is what
                     is already applied. Absent rather than disabled, the same
                     rule the pending-changes action follows.
                  */
                  revision.revision === view.revision ? null : (
                    <form action={restore}>
                      <input type="hidden" name="sellerTemplateId" value={view.id} />
                      <input type="hidden" name="revision" value={revision.revision} />
                      <Button type="submit" size="sm" variant="secondary">
                        {t("template.history_restore")}
                      </Button>
                    </form>
                  )
                }
              >
                <ul className="flex flex-col gap-1">
                  {revision.changes.map((change, index) => (
                    <li key={index} className="text-caption text-muted">
                      {change.kind === "renamed" && change.from
                        ? t("template.change.renamed", { from: change.from, to: change.label })
                        : t("template.change.reordered", { field: change.label })}
                    </li>
                  ))}
                </ul>
              </Panel>
            </li>
          ))}
        </ol>
      )}
    </SellerPage>
  );
}

/** React needs a form action that returns nothing. */
async function restore(formData: FormData): Promise<void> {
  "use server";
  await restoreRevision(formData);
}
