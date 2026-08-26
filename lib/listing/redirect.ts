import "server-only";
import { permanentRedirect } from "next/navigation";
import { prisma } from "@/lib/db/client";

/**
 * Serve the 301s the platform has been writing.
 *
 * `docs/routes.md` says slugs are immutable once published and that renaming a
 * category or merging two listings creates a 301 automatically. The `Redirect`
 * model has existed since handoff 0 and **nothing has ever read it** — so every
 * row written by a rename or a merge has been inert, and a buyer following a
 * bookmarked address after either got a 404.
 *
 * Called where the 404 would otherwise be thrown, so it costs one query only on
 * the path that was already about to fail.
 *
 * `permanentRedirect` rather than `redirect`: a 308 preserves the method and
 * tells a crawler the move is permanent, which is the whole point of writing
 * the row. Next's `permanentRedirect` throws, so this never returns when it
 * finds one.
 */
export async function redirectIfMoved(fromPath: string): Promise<void> {
  const row = await prisma.redirect.findUnique({
    where: { fromPath },
    select: { toPath: true },
  });
  if (row) permanentRedirect(row.toPath);
}

/**
 * Where a listing lives now, following a merge.
 *
 * A merged listing keeps its row so its reviews survive and the merge stays
 * reversible — see `lib/dedupe/service.ts`. It should not render as itself:
 * a buyer who reaches it wants the company that absorbed it.
 */
export async function absorbedInto(slug: string): Promise<string | null> {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { mergedInto: { select: { slug: true } } },
  });
  return business?.mergedInto?.slug ?? null;
}
