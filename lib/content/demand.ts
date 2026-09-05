import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";

/**
 * Recording third-party search volume for one scope — board 6f.
 *
 * Imported, not observed. It is keyword data bought from outside and it is the
 * input to a decision about where to spend recruitment effort, so the source
 * and the date it was true travel with it and are rendered beside it. The
 * alternative — a bare number on an admin screen — is a figure nobody can
 * check, deciding which of eight thousand pages exist.
 *
 * Audited, because it is a staff state change that moves a publish threshold.
 * Recording 3,940 searches against a trade with a floor of 60 raises that
 * scope's need to 99 and takes the page down: strictly more consequential than
 * the category edit beside it, which has been audited since handoff 0.
 *
 * It is not derived from `SearchQueryLog`. That table has no area dimension, so
 * area × category — the population that dominates the sitemap — could not be
 * given a figure from it at all; and board 8e already refused this exact
 * derivation in code, on the grounds that there is no honest way to say how
 * many people searched that combination. A page nobody can reach generates no
 * on-site searches either, which makes the derivation circular as well as
 * impossible.
 */

export type DemandRefusal = "not_found" | "out_of_range" | "bad_source";

export type DemandResult = { ok: true } | { ok: false; error: DemandRefusal; message: string };

const MAX_SEARCHES = 10_000_000;

export interface RecordDemandInput {
  actor: Actor;
  categoryId: string;
  emirate: string;
  /** Null records the emirate-wide page rather than one area. */
  areaId: string | null;
  monthlySearches: number;
  source: string;
  capturedAt: Date;
  reason: string;
}

export async function recordScopeDemand(input: RecordDemandInput): Promise<DemandResult> {
  if (
    !Number.isInteger(input.monthlySearches) ||
    input.monthlySearches < 0 ||
    input.monthlySearches > MAX_SEARCHES
  ) {
    return {
      ok: false,
      error: "out_of_range",
      message: `A monthly search figure is a whole number from 0 to ${MAX_SEARCHES.toLocaleString("en-AE")}.`,
    };
  }
  if (input.source.trim().length < 2) {
    return {
      ok: false,
      error: "bad_source",
      message: "Say where the figure came from. A number with no source cannot be checked.",
    };
  }

  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { slug: true },
  });
  if (!category) {
    return { ok: false, error: "not_found", message: "That trade is not in the taxonomy." };
  }

  const existing = await prisma.scopeDemand.findFirst({
    where: { categoryId: input.categoryId, emirate: input.emirate as never, areaId: input.areaId },
    select: { id: true, monthlySearches: true, source: true, capturedAt: true },
  });

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `ScopeDemand:${input.emirate}/${input.areaId ?? "all"}/${category.slug}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const data = {
          monthlySearches: input.monthlySearches,
          source: input.source.trim(),
          capturedAt: input.capturedAt,
          recordedById: input.actor.id,
        };
        if (existing) {
          await tx.scopeDemand.update({ where: { id: existing.id }, data });
        } else {
          await tx.scopeDemand.create({
            data: {
              ...data,
              categoryId: input.categoryId,
              emirate: input.emirate as never,
              areaId: input.areaId,
            },
          });
        }
        return {
          result: null,
          before: existing
            ? {
                monthlySearches: existing.monthlySearches,
                source: existing.source,
                capturedAt: existing.capturedAt,
              }
            : null,
          after: data,
        };
      },
    ),
  );

  return { ok: true };
}

/**
 * The oldest figure on the screen — board 6f criterion 16.
 *
 * One date, because the question the header answers is "how stale is the worst
 * of this", not "when did each row arrive". A screen that averaged its vintages
 * would hide the one that is a year old.
 */
export async function demandVintage(): Promise<{ oldest: Date; sources: string[] } | null> {
  const rows = await prisma.scopeDemand.findMany({
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true, source: true },
  });
  if (rows.length === 0) return null;
  return {
    oldest: rows[0]!.capturedAt,
    sources: [...new Set(rows.map((row) => row.source))].sort(),
  };
}
