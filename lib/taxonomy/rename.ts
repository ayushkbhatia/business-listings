import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { SubjectRef } from "@/lib/audit/types";
import type { TaxonomyResult } from "./service";

/**
 * Criterion 7 — "renaming a category or merging two listings produces a working
 * 301; deleting a published page without one is blocked."
 *
 * The merge half landed in handoff 4: `lib/dedupe/service.ts` writes a redirect
 * from the absorbed listing and takes it away again on an unmerge. This is the
 * other half, and until now there was no rename path at all — `TaxonomyResult`
 * has declared `slug_taken` and `would_orphan` since handoff 4 and nothing has
 * ever returned either.
 *
 * The part that is easy to get wrong is how many addresses one rename moves.
 * Renaming a **sector** changes its own page, every subcategory page under it —
 * because `/c/:category/:sub` carries the parent's slug — and every area page
 * for it. One rename, dozens of 301s, and a redirect table that has to hold all
 * of them or the links go dark.
 */

/** Lowercase, digits and hyphens. The same shape every other slug answers to. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * "1 subcategory sits", not "1 subcategories sit".
 *
 * These messages are built here rather than in the catalogue because they are
 * refusals with a count in them and the count decides the verb. §08 is explicit
 * that an error says what is wrong; saying it ungrammatically is a smaller
 * failure than saying nothing, and still a failure.
 */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Every public address that carries this category's slug, before and after.
 *
 * Read before the update and written as redirects, so a link printed on a van
 * last year still lands on the page it named.
 */
export async function addressesFor(
  categoryId: string,
  slug: string,
): Promise<{ from: string; to: string }[]> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: {
      slug: true,
      parent: { select: { slug: true } },
      children: { select: { slug: true } },
      areaPages: {
        where: { publishedAt: { not: null } },
        select: { area: { select: { slug: true, emirate: true } } },
      },
    },
  });
  if (!category) return [];

  const old = category.slug;
  const pairs: { from: string; to: string }[] = [];

  if (category.parent) {
    pairs.push({ from: `/c/${category.parent.slug}/${old}`, to: `/c/${category.parent.slug}/${slug}` });
  } else {
    pairs.push({ from: `/c/${old}`, to: `/c/${slug}` });
    /*
       Every child, because `/c/:category/:sub` carries the parent's slug. A
       rename that moved the sector page and left 418 subcategory addresses
       dangling is the failure this list exists to prevent.
    */
    for (const child of category.children) {
      pairs.push({ from: `/c/${old}/${child.slug}`, to: `/c/${slug}/${child.slug}` });
    }
  }

  // Area pages carry the category slug as their last segment, whether the
  // category is a sector or a subcategory.
  for (const page of category.areaPages) {
    pairs.push({
      from: `/${page.area.emirate}/${page.area.slug}/${old}`,
      to: `/${page.area.emirate}/${page.area.slug}/${slug}`,
    });
  }

  return pairs;
}

/**
 * Rename a category, and move every address it owns with it.
 *
 * One transaction: the slug and its redirects commit together or not at all. A
 * rename that succeeded with half its 301s written would be worse than one that
 * failed, because the failure is visible and the half is not.
 */
export async function renameCategory(
  actor: Actor,
  categoryId: string,
  newSlug: string,
  reason: string,
): Promise<TaxonomyResult> {
  const slug = newSlug.trim().toLowerCase();

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, slug: true, name: true },
  });
  if (!category) {
    return { ok: false, error: "not_found", message: "That category is not in the taxonomy." };
  }

  if (!SLUG.test(slug)) {
    return {
      ok: false,
      error: "slug_taken",
      message: "Lowercase letters, digits and hyphens, like valves-and-fittings.",
    };
  }
  if (slug === category.slug) {
    return { ok: false, error: "slug_taken", message: "That is already its address." };
  }

  const clash = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  if (clash) {
    return { ok: false, error: "slug_taken", message: "Another trade already has that address." };
  }

  const pairs = await addressesFor(categoryId, slug);
  const subject: SubjectRef = `Category:${category.id}`;

  await prisma.$transaction(async (tx) =>
    staffMutation({ actor, capability: "taxonomy.write", subject, reason, tx }, async () => {
      await tx.category.update({ where: { id: category.id }, data: { slug } });

      for (const pair of pairs) {
        /*
           Upsert, not create. An address may already redirect somewhere — a
           category renamed twice — and the second rename has to point the old
           address at the newest one rather than fail on a unique constraint or
           leave a visitor on a chain.
        */
        await tx.redirect.upsert({
          where: { fromPath: pair.from },
          create: { fromPath: pair.from, toPath: pair.to, statusCode: 301 },
          update: { toPath: pair.to },
        });

        // A chain is two hops for a visitor and a discount for a crawler. Any
        // redirect that pointed at the old address now points at the new one.
        await tx.redirect.updateMany({
          where: { toPath: pair.from },
          data: { toPath: pair.to },
        });
      }

      return {
        result: null,
        before: { slug: category.slug },
        after: { slug, redirects: pairs.length },
      };
    }),
  );

  return { ok: true };
}

/**
 * Delete a category, and only where nothing is left pointing at it.
 *
 * `would_orphan` has been in `TaxonomyResult` since handoff 4 with nothing to
 * return it. This is what it was for: a category with children, with listings
 * filed under it, or with a published area page is a category whose deletion
 * would take live pages down with it.
 *
 * Where it is deletable, its addresses redirect to its parent — or to the
 * category index for a sector. Criterion 7's "deleting a published page without
 * one is blocked" is satisfied by there being no path that deletes without
 * writing them.
 */
export async function deleteCategory(
  actor: Actor,
  categoryId: string,
  reason: string,
): Promise<TaxonomyResult> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      slug: true,
      name: true,
      parent: { select: { slug: true } },
      _count: {
        select: {
          children: true,
          primaryFor: true,
          areaPages: { where: { publishedAt: { not: null } } },
        },
      },
    },
  });
  if (!category) {
    return { ok: false, error: "not_found", message: "That category is not in the taxonomy." };
  }

  if (category._count.children > 0) {
    return {
      ok: false,
      error: "would_orphan",
      message: plural(category._count.children, "subcategory sits", "subcategories sit") +
        " under it. Move or remove those first.",
    };
  }
  if (category._count.primaryFor > 0) {
    return {
      ok: false,
      error: "would_orphan",
      message: plural(category._count.primaryFor, "listing is", "listings are") +
        " filed under it. Re-file those first.",
    };
  }
  if (category._count.areaPages > 0) {
    return {
      ok: false,
      error: "would_orphan",
      message: plural(category._count.areaPages, "area page is", "area pages are") +
        " published for it. Unpublish those first.",
    };
  }

  const destination = category.parent ? `/c/${category.parent.slug}` : "/categories";
  const from = category.parent
    ? `/c/${category.parent.slug}/${category.slug}`
    : `/c/${category.slug}`;
  const subject: SubjectRef = `Category:${category.id}`;

  await prisma.$transaction(async (tx) =>
    staffMutation({ actor, capability: "taxonomy.write", subject, reason, tx }, async () => {
      // The redirect first, so there is no instant in the transaction where the
      // page is gone and the address answers nothing.
      await tx.redirect.upsert({
        where: { fromPath: from },
        create: { fromPath: from, toPath: destination, statusCode: 301 },
        update: { toPath: destination },
      });
      await tx.category.delete({ where: { id: category.id } });

      return {
        result: null,
        before: { slug: category.slug, name: category.name },
        after: { redirectedTo: destination },
      };
    }),
  );

  return { ok: true };
}
