import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Criterion 7 — *"Area and sector slugs are unique across one namespace; admin
 * cannot create a collision."*
 *
 * ## What the collision actually is
 *
 * Open question 3 recommended flattening the emirate class to
 * `/:emirate/:category`, and the router already does that: two segments is the
 * emirate class, three is the area class, and Next matches on segment count. So
 * there is no ambiguous *middle position* to resolve and no `type` column
 * needed to resolve it — which is the part of the criterion the flattening
 * answered.
 *
 * What it did not answer is the namespace itself. If an area and a category
 * both take the slug `industrial-mep`, then `/dubai/industrial-mep` reads the
 * category table and `/dubai/industrial-mep/hvac` reads the area table, and the
 * two pages have the same name, sit at adjacent depths, and are about different
 * things. Nothing crashes. A buyer, a crawler and the person writing the intro
 * copy all have to hold two meanings of one word, and the first time somebody
 * writes a redirect or a canonical between them it is wrong.
 *
 * So: one namespace, checked before a write, in the service — because "admin
 * cannot create a collision" is a rule about a code path and not about a
 * database constraint that cannot span two tables anyway.
 *
 * ## Where this is called
 *
 * `editCategory` and `createCategory` in `lib/taxonomy/service.ts`, which is
 * every path that can write a category slug today. Areas are written by the
 * licence importer and the seed; `/admin/areas` is board 12h and unbuilt, and
 * this is the function it calls when it lands. Exported as one predicate so
 * there is one answer rather than two that agree until they do not.
 */

export type SlugKind = "area" | "category";

export interface SlugCollision {
  slug: string;
  /** What already holds it. */
  heldBy: SlugKind;
  name: string;
}

/**
 * Whatever else already holds this slug, or null.
 *
 * `exclude` skips the row being edited: renaming a category to the slug it
 * already has is not a collision with itself.
 */
export async function slugCollision(
  slug: string,
  kind: SlugKind,
  exclude?: { id: string },
): Promise<SlugCollision | null> {
  const trimmed = slug.trim().toLowerCase();
  if (trimmed === "") return null;

  if (kind === "category") {
    const area = await prisma.area.findUnique({
      where: { slug: trimmed },
      select: { id: true, name: true },
    });
    if (area && area.id !== exclude?.id) {
      return { slug: trimmed, heldBy: "area", name: area.name };
    }
    return null;
  }

  const category = await prisma.category.findUnique({
    where: { slug: trimmed },
    select: { id: true, name: true },
  });
  if (category && category.id !== exclude?.id) {
    return { slug: trimmed, heldBy: "category", name: category.name };
  }
  return null;
}

/**
 * The refusal, in the words somebody can act on.
 *
 * §08: say what is wrong and what correct looks like, and never blame the user.
 */
export function slugCollisionMessage(collision: SlugCollision): string {
  return collision.heldBy === "area"
    ? `"${collision.slug}" is already the area ${collision.name}. Areas and trades share one namespace on the landing-page URLs, so a trade cannot take it — pick another slug.`
    : `"${collision.slug}" is already the trade ${collision.name}. Areas and trades share one namespace on the landing-page URLs, so an area cannot take it — pick another slug.`;
}
