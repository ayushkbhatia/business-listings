import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { guideSubjects } from "@/lib/guides/subjects";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { saveSubject } from "../guides/actions";
import { SubjectEditor, type SubjectRowView } from "./SubjectEditor";

/**
 * Board 10b §3 — the shelves the guide index browses by.
 *
 * A screen, because the taxonomy is a table, and the taxonomy is a table
 * because board 10b Q2 says the four subjects have never been agreed and
 * recommends dropping one of them. A taxonomy in an enum costs a migration and
 * a deploy to change its own mind; this costs a revalidation.
 *
 * Three seeded, not the board's four: "For suppliers" is the only group written
 * for the other side of the marketplace and the board recommends it moves to
 * the seller dashboard's help surface. Adding it back is a row on this page.
 */

export const dynamic = "force-dynamic";

export default async function GuideSubjectsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [subjects, counts, badges] = await Promise.all([
    guideSubjects(),
    prisma.guide.groupBy({
      by: ["subjectId"],
      where: { publishedAt: { not: null } },
      _count: true,
    }),
    getAdminNavBadges(seat),
  ]);

  const published = new Map(counts.map((row) => [row.subjectId, row._count]));
  const unfiled = published.get(null) ?? 0;

  const rows: SubjectRowView[] = subjects.map((subject) => ({
    id: subject.id,
    slug: subject.slug,
    name: subject.name,
    blurb: subject.blurb ?? "",
    sortOrder: subject.sortOrder,
    published: formatCount(published.get(subject.id) ?? 0),
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/guide-subjects"
      title={t("subjects.title")}
      eyebrow={t("guide_admin.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("subjects.meta", { count: formatCount(rows.length), unfiled: formatCount(unfiled) })}
        </span>
      }
    >
      <SubjectEditor rows={rows} save={saveSubject} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("subjects.note")}
      </p>
    </AdminPage>
  );
}
