import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";

/**
 * A listing's sector: the top-level ancestor of its primary category.
 *
 * `Business.sectorId` is denormalised because the store count — how many live
 * storefronts a template edit changes — is on every builder screen, and a
 * recursive walk per render is not that.
 *
 * **Nothing in this codebase writes it.** A trigger does, from
 * `primary_category_id`, in `20260827130000_sector_trigger`. The first version
 * of this module asked every writer to set it by hand; both application writers
 * were wired and the assertion still failed the first time the whole suite ran,
 * because a dozen test fixtures create listings directly. That is an argument
 * against the rule rather than against the fixtures — the value is a pure
 * function of another column in the same row, so the database can keep it and
 * there is no fifth writer to forget.
 *
 * `tests/integration/storefront.test.ts` still walks the whole table and
 * asserts the two agree. A denormalisation nothing checks is one that is
 * already wrong, trigger or no trigger.
 *
 * `BusinessCategory` rows are ignored on purpose. About a third of businesses
 * carry a second one, and a listing that belonged to two sectors would belong
 * to two templates — which makes the store count, and the whole fan-out model,
 * undefined.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The top-level ancestor of a category, or the category itself if it is one.
 *
 * A read helper, for code that has a category and needs the sector it belongs
 * to — resolving which template applies, mostly. It is not how `sectorId` gets
 * written; see above.
 *
 * Bounded, like the trigger, so a cycle cannot hang a request.
 */
export async function sectorFor(db: Db, categoryId: string): Promise<string | null> {
  let current: string | null = categoryId;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const category: { id: string; parentId: string | null } | null = await db.category.findUnique({
      where: { id: current },
      select: { id: true, parentId: true },
    });
    if (!category) return null;
    if (category.parentId === null) return category.id;
    current = category.parentId;
  }
  return null;
}

/** Every top-level category, which is the list of sectors. */
export async function sectors() {
  return prisma.category.findMany({
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, slug: true },
  });
}
