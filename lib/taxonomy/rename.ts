import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { SubjectRef } from "@/lib/audit/types";
import { slugProblem } from "./rules";
import type { TaxonomyResult } from "./service";
import { lockCategories } from "./write";

/**
 * Criterion 7 — "renaming a category or merging two listings produces a working
 * 301; deleting a published page without one is blocked." Board 4d `B7`: slug
 * changes create a 301 and never happen silently.
 *
 * The merge half landed in handoff 4: `lib/dedupe/service.ts` writes a redirect
 * from the absorbed listing and takes it away again on an unmerge. This is the
 * other half.
 *
 * The part that is easy to get wrong is how many addresses one rename moves.
 * Renaming a **sector** changes its own page, every subcategory page under it —
 * because `/c/:category/:sub` carries the parent's slug — every area page for
 * it, and every emirate page for it. One rename, dozens of 301s, and a redirect
 * table that has to hold all of them or the links go dark.
 *
 * The rows were written for a year before anything served them: no category
 * route called `redirectIfMoved`, so every rename 404'd its old address. Board
 * 4d wired the four routes; `tests/e2e/admin-taxonomy.spec.ts` follows one.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Every public address that carries this category's slug, before and after.
 *
 * Read inside the rename's transaction, under the category's lock, so the set
 * of redirects written is the set of addresses that existed at the moment of
 * the write rather than a moment before it.
 */
export async function addressesFor(
  categoryId: string,
  slug: string,
  db: Db = prisma,
): Promise<{ from: string; to: string }[]> {
  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: {
      slug: true,
      parent: { select: { slug: true } },
      children: { select: { slug: true }, orderBy: [{ slug: "asc" }] },
      areaPages: {
        where: { publishedAt: { not: null } },
        select: { area: { select: { slug: true, emirate: true } } },
        orderBy: [{ id: "asc" }],
      },
      emiratePages: {
        where: { publishedAt: { not: null } },
        select: { emirate: true },
        orderBy: [{ id: "asc" }],
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

  /*
     Emirate pages, `/:emirate/:category`. Missing until board 4d: a sector
     renamed while "HVAC in Dubai" was live took that page's address with it and
     wrote nothing, which is exactly the silent slug change `B7` rules out.
  */
  for (const page of category.emiratePages) {
    pairs.push({ from: `/${page.emirate}/${old}`, to: `/${page.emirate}/${slug}` });
  }

  return pairs;
}

/**
 * Point every pair at its new address, and every older redirect that landed on
 * an old address at the new one too.
 *
 * Upsert, not create: an address may already redirect somewhere — a category
 * renamed twice — and the second rename has to point the old address at the
 * newest one rather than fail on a unique constraint or leave a visitor on a
 * chain. Shared with the merge, which moves addresses the same way.
 */
export async function writeRedirects(tx: Prisma.TransactionClient, pairs: readonly { from: string; to: string }[]) {
  for (const pair of pairs) {
    if (pair.from === pair.to) continue;
    await tx.redirect.upsert({
      where: { fromPath: pair.from },
      create: { fromPath: pair.from, toPath: pair.to, statusCode: 301 },
      update: { toPath: pair.to, statusCode: 301 },
    });
    // A chain is two hops for a visitor and a discount for a crawler.
    await tx.redirect.updateMany({ where: { toPath: pair.from }, data: { toPath: pair.to } });
  }
  /*
     A redirect from an address to itself is a loop. It arises when a category
     is renamed back to a slug it once had: the old row for that address still
     points onward, and the chain fix above has just pointed it home.
  */
  const targets = pairs.map((pair) => pair.to);
  if (targets.length) {
    await tx.redirect.deleteMany({ where: { fromPath: { in: targets } } });
  }
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
): Promise<TaxonomyResult & { moved?: number }> {
  const slug = newSlug.trim().toLowerCase();

  if (slugProblem(slug)) {
    return {
      ok: false,
      error: "slug_taken",
      detail: { reason: "malformed" },
      message: "Lowercase letters, digits and hyphens, like valves-and-fittings.",
    };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    await lockCategories(tx, [categoryId]);

    const category = await tx.category.findUnique({
      where: { id: categoryId },
      select: { id: true, slug: true },
    });
    if (!category) {
      return { ok: false, error: "not_found", message: "That category is not in the taxonomy." } as const;
    }
    if (slug === category.slug) {
      return { ok: false, error: "slug_taken", detail: { reason: "same" }, message: "That is already its address." } as const;
    }
    const clash = await tx.category.findUnique({ where: { slug }, select: { id: true } });
    if (clash) {
      return {
        ok: false,
        error: "slug_taken",
        detail: { reason: "taken" },
        message: "Another category already has that address.",
      } as const;
    }

    const pairs = await addressesFor(category.id, slug, tx);
    const subject: SubjectRef = `Category:${category.id}`;

    await staffMutation({ actor, capability: "taxonomy.write", subject, reason, tx }, async () => {
      await tx.category.update({ where: { id: category.id }, data: { slug } });
      await writeRedirects(tx, pairs);
      return {
        result: null,
        before: { slug: category.slug },
        after: { slug, redirects: pairs.length },
        /*
           B4: the redirects written from this category's own addresses — one
           upsert per entry of `pairs`, each exactly one row. Older redirects
           re-pointed by the chain fix are not in the count.
        */
        blastRadius: { count: pairs.length, unit: "redirects" },
      };
    });

    return { ok: true, moved: pairs.length } as const;
  });

  return outcome;
}

/** What still points at a category, counted the way a delete would trip over it. */
export async function dependentsOf(categoryId: string, db: Db = prisma) {
  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: {
      _count: {
        select: {
          children: true,
          primaryFor: true,
          businesses: true,
          products: true,
          services: true,
          serviceBriefs: true,
          placements: true,
          curatedLists: true,
          areaPages: { where: { publishedAt: { not: null } } },
          emiratePages: { where: { publishedAt: { not: null } } },
        },
      },
    },
  });
  return category?._count ?? null;
}

/**
 * Delete a category, and only where nothing is left pointing at it.
 *
 * A category with children, with listings filed under it, or with a published
 * area page is a category whose deletion would take live pages down with it.
 *
 * Board 4d found four more, each of which reached the database as a foreign-key
 * error — a 500 with nothing for the person to act on — or worse, as a cascade
 * nobody was told about: a product or a service filed here (`Restrict`), a
 * listing holding it as a second category (`Cascade`, silently dropping the listing from a trade it
 * asked to be in), a paid placement slot (`Cascade`, silently ending something a
 * seller bought), a curated list, and a published emirate page.
 *
 * Where it is deletable, its addresses redirect to its parent — or to the
 * category index for a sector.
 */
export async function deleteCategory(
  actor: Actor,
  categoryId: string,
  reason: string,
): Promise<TaxonomyResult> {
  return prisma.$transaction(async (tx) => {
    await lockCategories(tx, [categoryId]);

    const category = await tx.category.findUnique({
      where: { id: categoryId },
      select: { id: true, slug: true, name: true, parentId: true, parent: { select: { slug: true } } },
    });
    if (!category) {
      return { ok: false, error: "not_found", message: "That category is not in the taxonomy." } as const;
    }

    const counts = (await dependentsOf(category.id, tx))!;
    const blocking: [string, number][] = [
      ["children", counts.children],
      ["listings", counts.primaryFor],
      ["second_category", counts.businesses],
      ["products", counts.products],
      ["services", counts.services + counts.serviceBriefs],
      ["placements", counts.placements],
      ["curated_lists", counts.curatedLists],
      ["area_pages", counts.areaPages],
      ["emirate_pages", counts.emiratePages],
    ];
    const first = blocking.find(([, count]) => count > 0);
    if (first) {
      return {
        ok: false,
        error: "would_orphan",
        detail: { reason: first[0], count: first[1] },
        message: `${first[1]} ${first[0].replace(/_/g, " ")} depend on it.`,
      } as const;
    }

    const destination = category.parent ? `/c/${category.parent.slug}` : "/categories";
    const from = category.parent ? `/c/${category.parent.slug}/${category.slug}` : `/c/${category.slug}`;
    const subject: SubjectRef = `Category:${category.id}`;

    await staffMutation({ actor, capability: "taxonomy.write", subject, reason, tx }, async () => {
      // The redirect first, so there is no instant in the transaction where the
      // page is gone and the address answers nothing.
      await writeRedirects(tx, [{ from, to: destination }]);
      await tx.category.delete({ where: { id: category.id } });
      return {
        result: null,
        before: { slug: category.slug, name: category.name, parentId: category.parentId },
        after: { redirectedTo: destination },
      };
    });

    return { ok: true } as const;
  });
}
