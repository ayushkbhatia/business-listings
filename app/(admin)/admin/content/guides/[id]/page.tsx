import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { guideById } from "@/lib/guides/service";
import { guideSubjects } from "@/lib/guides/subjects";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { publish, recordCheck, remove, save, setFeatured, unpublish } from "../actions";
import { GuideEditor } from "./GuideEditor";

/**
 * Boards 10b and 6d — one guide.
 *
 * `new` is a route rather than a separate screen: the create and edit forms are
 * the same fields, and the only thing that differs is whether the slug is still
 * allowed to move.
 */

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function GuideEditorPage({ params }: Props) {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const { id } = await params;
  const isNew = id === "new";

  const [guide, categories, subjects, badges] = await Promise.all([
    isNew ? null : guideById(id),
    prisma.category.findMany({
      where: { parentId: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    guideSubjects(),
    getAdminNavBadges(seat),
  ]);

  if (!isNew && !guide) notFound();

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/guides"
      title={guide ? guide.title : t("guide_admin.new")}
      eyebrow={t("guide_admin.eyebrow")}
      meta={
        guide?.publishedAt ? (
          <span className="text-caption text-muted">
            {t("guide_admin.status.published")} · /guides/{guide.slug}
          </span>
        ) : undefined
      }
    >
      <GuideEditor
        id={guide?.id ?? null}
        slug={guide?.slug ?? ""}
        title={guide?.title ?? ""}
        summary={guide?.summary ?? ""}
        byline={guide?.byline ?? ""}
        ctaCategoryId={guide?.ctaCategoryId ?? ""}
        blocks={guide?.blocks ?? []}
        publishedAt={guide?.publishedAt ? guide.publishedAt.toISOString() : null}
        categories={categories}
        standfirst={guide?.standfirst ?? ""}
        topic={guide?.topic ?? ""}
        bylineRole={guide?.bylineRole ?? ""}
        subjectId={guide?.subjectId ?? ""}
        sortOrder={guide?.sortOrder ?? 0}
        reviewCadenceMonths={
          guide?.reviewCadenceMonths === null || guide?.reviewCadenceMonths === undefined
            ? ""
            : String(guide.reviewCadenceMonths)
        }
        subjects={subjects}
        featured={guide?.featured ?? false}
        featuredNote={guide?.featuredNote ?? ""}
        setFeatured={setFeatured}
        regulatoryCheckedAt={
          guide?.regulatoryCheckedAt ? formatDate(guide.regulatoryCheckedAt) : null
        }
        recordCheck={recordCheck}
        save={save}
        publish={publish}
        unpublish={unpublish}
        remove={remove}
      />
    </AdminPage>
  );
}
