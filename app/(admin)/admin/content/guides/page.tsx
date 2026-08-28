import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { formatDate } from "@/lib/format";
import { GUIDE_MIN_WORDS } from "@/lib/guides/blocks";
import { guideList } from "@/lib/guides/service";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { GuideTable, type GuideRowView } from "./GuideTable";

/**
 * Boards 10b and 6d — the guide list.
 *
 * Twenty-two articles belong here rather than in a seed file. Per `CLAUDE.md`:
 * content added through the admin costs a revalidation, and the same content
 * added as a constant costs a build, a deploy, and a cold cache for every page
 * on the site.
 */

export const dynamic = "force-dynamic";

export default async function GuidesAdminPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [guides, badges] = await Promise.all([guideList(), getAdminNavBadges(seat)]);

  const rows: GuideRowView[] = guides.map((guide) => ({
    id: guide.id,
    title: guide.title,
    slug: guide.slug,
    words: guide.words,
    published: guide.publishedAt !== null,
    updated: formatDate(guide.updatedAt),
  }));

  const published = rows.filter((row) => row.published).length;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/guides"
      title={t("guide_admin.title")}
      eyebrow={t("guide_admin.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("guide_admin.meta", { published, drafts: rows.length - published })}
        </span>
      }
      actions={
        <Link href="/admin/content/guides/new" className={buttonClassName({ size: "sm" })}>
          {t("guide_admin.new")}
        </Link>
      }
    >
      <GuideTable rows={rows} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("guide_admin.note", { need: GUIDE_MIN_WORDS })}
      </p>
    </AdminPage>
  );
}
