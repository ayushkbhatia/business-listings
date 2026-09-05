import "server-only";
import { prisma } from "@/lib/db/client";
import { resolveAreaScope, resolveEmirateScope, type LandingScope } from "./scope";

/**
 * A scope from the ids an admin screen holds.
 *
 * The public routes resolve from slugs, which is what the URL gives them. The
 * matrix, the sweep and the publish services hold `(areaId, categoryId)` or
 * `(emirate, categoryId)` because that is what the rows are keyed on.
 *
 * One extra read either way, and the alternative is a second scope constructor
 * — which is how a page ends up gated on one set of category ids and rendered
 * from another.
 */

export async function scopeForArea(
  areaId: string,
  categoryId: string,
): Promise<LandingScope | null> {
  const [area, category] = await Promise.all([
    prisma.area.findUnique({ where: { id: areaId }, select: { slug: true, emirate: true } }),
    prisma.category.findUnique({ where: { id: categoryId }, select: { slug: true } }),
  ]);
  if (!area || !category) return null;
  return resolveAreaScope({
    emirate: area.emirate as string,
    area: area.slug,
    category: category.slug,
  });
}

export async function scopeForEmirate(
  emirate: string,
  categoryId: string,
): Promise<LandingScope | null> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { slug: true },
  });
  if (!category) return null;
  return resolveEmirateScope({ emirate, category: category.slug });
}
