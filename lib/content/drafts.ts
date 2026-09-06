import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { areaMatrix } from "@/lib/content/matrix";

/**
 * Board 6f §2 — "Generate 38 drafts", not "Generate queued pages".
 *
 * The label was the only thing on the board saying which button this was, and
 * they are materially different buttons. One creates work for a writer; the
 * other publishes thirty-eight pages into a live index in a single click. This
 * is the first one, and it cannot become the second: nothing here writes
 * `publishedAt`, and where a trade requires human review it refuses even to be
 * asked.
 *
 * A draft is an `AreaPage` row with no copy on it. That is all it needs to be —
 * the row is what puts the scope on the content-ops queue and gives the editor
 * somewhere to type. Generating prose is not in scope for this board, and a
 * generated paragraph that published itself is the doorway-page farm the whole
 * publish gate exists to prevent.
 */

export type DraftRefusal = "none_queued" | "review_off";

export type DraftResult =
  | { ok: true; created: number; paths: string[] }
  | { ok: false; error: DraftRefusal; message: string };

/**
 * How many drafts the button would create, for the label.
 *
 * The same query the action runs, so the count on the button is the count the
 * click produces rather than a number computed a different way and drifting.
 */
export async function draftableScopes(categoryId?: string, now = new Date()) {
  const matrix = await areaMatrix(
    { ...(categoryId ? { categoryId } : {}), perPage: Number.MAX_SAFE_INTEGER },
    now,
  );
  // `queued_copy` is exactly the state: supply clears the floors and nobody has
  // written the page. Criterion 9 asks the button's count to match this row
  // count, and it does because it is this row count.
  return matrix.rows.filter((row) => row.status === "queued_copy" && row.intro === null);
}

export async function generateDrafts(
  actor: Actor,
  categoryId: string | undefined,
  reason: string,
  now = new Date(),
): Promise<DraftResult> {
  const scopes = await draftableScopes(categoryId, now);
  if (scopes.length === 0) {
    return {
      ok: false,
      error: "none_queued",
      message: "Nothing is waiting on copy. Every scope above its floors already has a page.",
    };
  }

  /*
     The human-review toggle, and the reason the refusal is worded this way.

     Off, a draft would be a page the platform could publish without a person
     having read it. Nothing here does that today — this only creates empty rows
     — but the toggle is a promise about what a "Generate" button on this screen
     is allowed to become, and the honest place to enforce a promise is before
     anybody relies on it.
  */
  const categories = await prisma.category.findMany({
    where: { id: { in: [...new Set(scopes.map((scope) => scope.categoryId))] } },
    select: { id: true, name: true, humanReviewRequired: true },
  });
  const unreviewed = categories.filter((category) => !category.humanReviewRequired);
  if (unreviewed.length > 0) {
    return {
      ok: false,
      error: "review_off",
      message: `Human review is off for ${unreviewed.map((c) => c.name).join(", ")}. Drafts are only generated where a person is going to read them.`,
    };
  }

  const created = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: categoryId ? `Category:${categoryId}` : "Category:all",
        reason,
        tx,
      },
      async () => {
        let count = 0;
        for (const scope of scopes) {
          /*
             `createMany` with `skipDuplicates` would be one round trip, and it
             would also silently swallow the case this loop exists to make
             impossible: a scope that gained a page between the count and the
             click. Counting what was actually written is what makes the audit
             row's number true.
          */
          const existing = await tx.areaPage.findUnique({
            where: { areaId_categoryId: { areaId: scope.areaId, categoryId: scope.categoryId } },
            select: { id: true },
          });
          if (existing) continue;
          await tx.areaPage.create({
            data: { areaId: scope.areaId, categoryId: scope.categoryId },
          });
          count += 1;
        }
        return {
          result: count,
          before: { drafts: 0 },
          after: { drafts: count, paths: scopes.map((scope) => scope.path) },
        };
      },
    ),
  );

  return { ok: true, created, paths: scopes.map((scope) => scope.path) };
}
