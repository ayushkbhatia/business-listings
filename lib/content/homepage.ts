import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 12g — homepage curation.
 *
 * `Category.showOnHome` decides which trades the directory home leads with, and
 * `getHomeCategories` has read it since handoff 1. This is the screen that sets
 * it.
 *
 * The rule worth having: a trade on the home page whose own landing page does
 * not publish is a link to a thin page from the most-linked page on the site.
 * That is refused, and the refusal names the reason — which is the page matrix
 * from step 7a, doing a second job.
 */

export type HomeRefusal = "not_found" | "not_publishable" | "not_a_sector";

export type HomeResult =
  | { ok: true; shown: number }
  | { ok: false; error: HomeRefusal; message: string };

const MESSAGE: Record<HomeRefusal, string> = {
  not_found: "That trade is not here.",
  not_publishable:
    "Its own landing page does not publish yet, so the home page would link to a thin one. Write its intro or wait for the listings.",
  not_a_sector: "Only a top-level trade goes on the home page.",
};

export interface HomeRow {
  id: string;
  name: string;
  slug: string;
  showOnHome: boolean;
  listings: number;
  /** From the same three gates the page matrix uses. */
  publishable: boolean;
}

export async function homeCandidates(): Promise<HomeRow[]> {
  const { pageMatrix } = await import("./matrix");
  const [matrix, categories] = await Promise.all([
    pageMatrix(),
    prisma.category.findMany({
      where: { parentId: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, slug: true, showOnHome: true },
    }),
  ]);

  return categories.map((category) => {
    const row = matrix.rows.find((candidate) => candidate.id === category.id);
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      showOnHome: category.showOnHome,
      listings: row?.listings ?? 0,
      publishable: row?.publishable ?? false,
    };
  });
}

export async function setOnHome(
  actor: Actor,
  categoryId: string,
  showOnHome: boolean,
  reason: string,
): Promise<HomeResult> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, parentId: true, showOnHome: true },
  });
  if (!category) return { ok: false, error: "not_found", message: MESSAGE.not_found };
  if (category.parentId !== null) {
    return { ok: false, error: "not_a_sector", message: MESSAGE.not_a_sector };
  }

  if (showOnHome) {
    const candidates = await homeCandidates();
    const row = candidates.find((candidate) => candidate.id === categoryId);
    // Only on the way in. Taking a trade off the home page is always allowed,
    // including one that stopped publishing.
    if (!row?.publishable) {
      return { ok: false, error: "not_publishable", message: MESSAGE.not_publishable };
    }
  }

  const shown = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `Category:${category.id}`,
        reason,
        tx,
      },
      async () => {
        await tx.category.update({ where: { id: category.id }, data: { showOnHome } });
        const count = await tx.category.count({ where: { showOnHome: true, parentId: null } });
        return {
          result: count,
          before: { showOnHome: category.showOnHome },
          after: { showOnHome, onHome: count },
        };
      },
    ),
  );

  return { ok: true, shown };
}
