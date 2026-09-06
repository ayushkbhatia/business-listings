import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * The shelves the guide index browses by — board 10b §3.
 *
 * One namespace with guide slugs, because both live directly under `/guides/`:
 * `/guides/buying-safely` and `/guides/check-a-uae-trade-licence` are the same
 * shape, and Next resolves both through the same `[slug]` segment. So a subject
 * that took a guide's slug would not merely be confusing — one of the two pages
 * would stop existing.
 *
 * The guard is the one `lib/seo/landing/slug-namespace.ts` already makes for
 * areas and categories: checked before a write, in the service, because "admin
 * cannot create a collision" is a rule about a code path and not a constraint
 * that can span two tables.
 */

export type GuideSlugKind = "guide" | "subject";

export interface GuideSlugCollision {
  slug: string;
  heldBy: GuideSlugKind;
  name: string;
}

/**
 * Whatever else already holds this slug under `/guides/`, or null.
 *
 * `exclude` skips the row being edited: renaming a subject to the slug it
 * already has is not a collision with itself.
 */
export async function guideSlugCollision(
  slug: string,
  kind: GuideSlugKind,
  exclude?: { id: string },
): Promise<GuideSlugCollision | null> {
  const trimmed = slug.trim().toLowerCase();
  if (trimmed === "") return null;

  if (kind === "subject") {
    const guide = await prisma.guide.findUnique({
      where: { slug: trimmed },
      select: { id: true, title: true },
    });
    if (guide && guide.id !== exclude?.id) {
      return { slug: trimmed, heldBy: "guide", name: guide.title };
    }
    const subject = await prisma.guideSubject.findUnique({
      where: { slug: trimmed },
      select: { id: true, name: true },
    });
    if (subject && subject.id !== exclude?.id) {
      return { slug: trimmed, heldBy: "subject", name: subject.name };
    }
    return null;
  }

  const subject = await prisma.guideSubject.findUnique({
    where: { slug: trimmed },
    select: { id: true, name: true },
  });
  if (subject) return { slug: trimmed, heldBy: "subject", name: subject.name };

  /*
     Guide-against-guide is already a unique index, so this only has to answer
     the cross-table half. `saveGuide` keeps its own duplicate check for the
     message it gives.
  */
  return null;
}

export interface SubjectRow {
  id: string;
  slug: string;
  name: string;
  blurb: string | null;
  sortOrder: number;
}

/** Every subject, in the editor's order. The admin form reads this. */
export async function guideSubjects(): Promise<SubjectRow[]> {
  return prisma.guideSubject.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, slug: true, name: true, blurb: true, sortOrder: true },
  });
}

/** One subject by its URL segment, or null. The chip's page reads this. */
export async function subjectBySlug(slug: string): Promise<SubjectRow | null> {
  return prisma.guideSubject.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, blurb: true, sortOrder: true },
  });
}
