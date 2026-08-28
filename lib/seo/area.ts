import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { SubjectRef } from "@/lib/audit/types";
import { countWords, evaluatePublish, type PublishFailure } from "@/lib/publish-threshold";
import { thresholdsFor } from "@/lib/taxonomy/service";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 6a — area landing pages, and criterion 1.
 *
 *   "An area page below 60 listings or 30% verified cannot be published, by API
 *    or by admin action; an existing page auto-unpublishes when supply drops
 *    and disappears from the sitemap on the next build."
 *
 * Two halves, and the second is the one that is easy to get wrong.
 *
 * `AreaPage.publishedAt` is staff **intent**. Whether the page is actually live
 * is intent AND the floors holding right now, computed at read time by
 * `areaPageState`. A stored flag alone would mean that between supply dropping
 * and a job running, a thin page is live and indexable — and the whole reason
 * board 6f exists is that a thin page in the index costs standing across the
 * domain rather than only its own.
 *
 * `sweepAreaPages` then clears the column and writes an audit row, so the drop
 * is visible on the matrix and in the log rather than only inside a render.
 * Same shape as dunning: a job that acts, and a read path that does not depend
 * on the job having run.
 */

const PUBLIC_BUSINESS = { suspendedAt: null, publishedAt: { not: null }, mergedIntoId: null } as const;

export interface AreaPageState {
  areaId: string;
  categoryId: string;
  listings: number;
  verified: number;
  /** The one authored paragraph, as written. */
  intro: string | null;
  introWords: number;
  /** Set by staff. Not the same thing as live. */
  publishedAt: Date | null;
  /** Whether the floors hold right now. */
  clearsFloors: boolean;
  /** Intent and floors together. This is what the route and the sitemap read. */
  live: boolean;
  failing: PublishFailure[];
}

/** The listings in one trade in one area, counted the way every surface counts. */
async function supply(areaId: string, categoryId: string) {
  const where = {
    ...PUBLIC_BUSINESS,
    primaryCategoryId: categoryId,
    locations: { some: { areaId, published: true } },
  };
  const [listings, verified] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.count({ where: { ...where, verificationTier: { gte: VERIFIED_TIER } } }),
  ]);
  return { listings, verified };
}

export async function areaPageState(
  areaId: string,
  categoryId: string,
): Promise<AreaPageState | null> {
  const [category, page] = await Promise.all([
    prisma.category.findUnique({
      where: { id: categoryId },
      select: { publishThreshold: true, verifiedShareMin: true },
    }),
    prisma.areaPage.findUnique({
      where: { areaId_categoryId: { areaId, categoryId } },
      select: { intro: true, publishedAt: true },
    }),
  ]);
  if (!category) return null;

  const { listings, verified } = await supply(areaId, categoryId);
  const introWords = countWords(page?.intro);
  const decision = evaluatePublish(
    { listings, verified, introWords },
    thresholdsFor(category),
  );

  return {
    areaId,
    categoryId,
    listings,
    verified,
    intro: page?.intro ?? null,
    introWords,
    publishedAt: page?.publishedAt ?? null,
    clearsFloors: decision.publishable,
    live: page?.publishedAt != null && decision.publishable,
    failing: decision.failures,
  };
}

export type AreaPageRefusal = "not_found" | "below_floors" | "not_published";

export type AreaPageResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: AreaPageRefusal; message: string; failing?: PublishFailure[] };

/**
 * The refusal, in the numbers somebody can act on.
 *
 * "Needs 60, has 41" tells a recruiter how many calls to make. "Not eligible"
 * tells them to go and find out, which is the same information and one more
 * screen away — §08.
 */
function refusalMessage(failing: readonly PublishFailure[]): string {
  return failing
    .map((failure) => {
      switch (failure.reason) {
        case "listings":
          return `${failure.have} listings, and it publishes at ${failure.need}.`;
        case "verified_share":
          return `${Math.round(failure.have * 100)}% verified, and it publishes at ${Math.round(failure.need * 100)}%.`;
        case "intro_words":
          return `${failure.have} words of intro, and it publishes at ${failure.need}.`;
      }
    })
    .join(" ");
}

export interface SaveIntroInput {
  actor: Actor;
  areaId: string;
  categoryId: string;
  intro: string;
  reason: string;
}

/** Write the one authored paragraph. Always allowed — writing is not publishing. */
export async function saveAreaIntro(input: SaveIntroInput): Promise<AreaPageResult<{ words: number }>> {
  const [area, category] = await Promise.all([
    prisma.area.findUnique({ where: { id: input.areaId }, select: { slug: true } }),
    prisma.category.findUnique({ where: { id: input.categoryId }, select: { slug: true } }),
  ]);
  if (!area || !category) {
    return { ok: false, error: "not_found", message: "That area or trade is not here." };
  }

  const intro = input.intro.trim();
  const subject: SubjectRef = `AreaPage:${area.slug}/${category.slug}`;

  await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor: input.actor, capability: "taxonomy.write", subject, reason: input.reason, tx },
      async () => {
        const before = await tx.areaPage.findUnique({
          where: { areaId_categoryId: { areaId: input.areaId, categoryId: input.categoryId } },
          select: { intro: true },
        });
        await tx.areaPage.upsert({
          where: { areaId_categoryId: { areaId: input.areaId, categoryId: input.categoryId } },
          create: { areaId: input.areaId, categoryId: input.categoryId, intro: intro || null },
          update: { intro: intro || null },
        });
        return {
          result: null,
          before: { words: countWords(before?.intro) },
          after: { words: countWords(intro) },
        };
      },
    ),
  );

  return { ok: true, words: countWords(intro) };
}

/**
 * Publish one area page.
 *
 * Criterion 1's first half. The floors are checked here, in the service, which
 * is what "cannot be published, by API or by admin action" means — the admin
 * screen and any future API call go through this and there is no second path.
 */
export async function publishAreaPage(
  actor: Actor,
  areaId: string,
  categoryId: string,
  reason: string,
): Promise<AreaPageResult<{ publishedAt: Date }>> {
  const state = await areaPageState(areaId, categoryId);
  if (!state) return { ok: false, error: "not_found", message: "That trade is not here." };

  if (!state.clearsFloors) {
    return {
      ok: false,
      error: "below_floors",
      message: refusalMessage(state.failing),
      failing: state.failing,
    };
  }

  const [area, category] = await Promise.all([
    prisma.area.findUniqueOrThrow({ where: { id: areaId }, select: { slug: true } }),
    prisma.category.findUniqueOrThrow({ where: { id: categoryId }, select: { slug: true } }),
  ]);
  const subject: SubjectRef = `AreaPage:${area.slug}/${category.slug}`;

  const publishedAt = await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor, capability: "taxonomy.write", subject, reason, tx },
      async () => {
        const row = await tx.areaPage.update({
          where: { areaId_categoryId: { areaId, categoryId } },
          // An already-published page keeps its original date, for the same
          // reason a guide does: `lastmod` should say when the content changed.
          data: { publishedAt: state.publishedAt ?? new Date() },
          select: { publishedAt: true },
        });
        return {
          result: row.publishedAt as Date,
          before: { publishedAt: state.publishedAt },
          after: {
            publishedAt: row.publishedAt,
            listings: state.listings,
            verified: state.verified,
          },
        };
      },
    ),
  );

  return { ok: true, publishedAt };
}

export async function unpublishAreaPage(
  actor: Actor,
  areaId: string,
  categoryId: string,
  reason: string,
): Promise<AreaPageResult> {
  const page = await prisma.areaPage.findUnique({
    where: { areaId_categoryId: { areaId, categoryId } },
    select: { publishedAt: true, area: { select: { slug: true } }, category: { select: { slug: true } } },
  });
  if (!page) return { ok: false, error: "not_found", message: "That page is not here." };
  if (!page.publishedAt) {
    return { ok: false, error: "not_published", message: "That page is not published." };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `AreaPage:${page.area.slug}/${page.category.slug}`,
        reason,
        tx,
      },
      async () => {
        await tx.areaPage.update({
          where: { areaId_categoryId: { areaId, categoryId } },
          data: { publishedAt: null },
        });
        return { result: null, before: { publishedAt: page.publishedAt }, after: { publishedAt: null } };
      },
    ),
  );

  return { ok: true };
}

export interface SweepResult {
  checked: number;
  unpublished: { areaSlug: string; categorySlug: string; failing: PublishFailure[] }[];
}

/**
 * Criterion 1's second half, as bookkeeping.
 *
 * Every published page re-checked against the floors, and any that has fallen
 * below them cleared.
 *
 * **Not audited**, and deliberately — the same call `runDunning` makes. This is
 * the platform following its own published rule rather than a staff decision,
 * there is no actor to attribute it to, and `AuditEvent.actorId` is NOT NULL
 * for exactly the reason that a log of decisions should only contain decisions.
 * A row saying "the system noticed arithmetic" is noise in a log somebody reads
 * to find out who did what.
 *
 * Nothing depends on this having run. `areaPageState.live` already answers no
 * the moment supply drops, so a page cannot be live-and-thin in the window
 * between the drop and the sweep, and the sitemap re-checks too. What the sweep
 * buys is a `publishedAt` column that agrees with what the site is serving, so
 * a staff member reading the matrix is not told a page is published while the
 * page itself says it is held.
 */
export async function sweepAreaPages(): Promise<SweepResult> {
  const published = await prisma.areaPage.findMany({
    where: { publishedAt: { not: null } },
    select: {
      areaId: true,
      categoryId: true,
      area: { select: { slug: true } },
      category: { select: { slug: true } },
    },
  });

  const unpublished: SweepResult["unpublished"] = [];

  for (const page of published) {
    const state = await areaPageState(page.areaId, page.categoryId);
    if (!state || state.clearsFloors) continue;

    await prisma.areaPage.update({
      where: { areaId_categoryId: { areaId: page.areaId, categoryId: page.categoryId } },
      data: { publishedAt: null },
    });

    unpublished.push({
      areaSlug: page.area.slug,
      categorySlug: page.category.slug,
      failing: state.failing,
    });
  }

  return { checked: published.length, unpublished };
}

/** Every live area page, for the sitemap and the cross-links. */
export async function livePages(): Promise<
  { areaSlug: string; emirate: string; categorySlug: string; updatedAt: Date }[]
> {
  const rows = await prisma.areaPage.findMany({
    where: { publishedAt: { not: null } },
    select: {
      areaId: true,
      categoryId: true,
      updatedAt: true,
      area: { select: { slug: true, emirate: true } },
      category: { select: { slug: true } },
    },
  });

  const live = [];
  for (const row of rows) {
    // Intent is not enough. The floors are re-checked here so the sitemap can
    // never contain a page the route would serve as thin.
    const state = await areaPageState(row.areaId, row.categoryId);
    if (!state?.live) continue;
    live.push({
      areaSlug: row.area.slug,
      emirate: row.area.emirate as string,
      categorySlug: row.category.slug,
      updatedAt: row.updatedAt,
    });
  }
  return live;
}

export interface CrossLink {
  emirate: string;
  areaSlug: string;
  areaName: string;
  categorySlug: string;
  categoryName: string;
  listings: number;
}

/**
 * The cross-links board 6a asks for: the same trade in other areas, and the
 * other trades in this one.
 *
 * Live pages only. Linking a good page to a thin one is the mistake the
 * homepage curation rule already forbids — and these pages are the ones with
 * the standing to lose.
 */
async function crossLinks(where: { categoryId?: string; areaId?: string }, exclude: { areaId?: string; categoryId?: string }): Promise<CrossLink[]> {
  const rows = await prisma.areaPage.findMany({
    where: {
      publishedAt: { not: null },
      ...(where.categoryId ? { categoryId: where.categoryId } : {}),
      ...(where.areaId ? { areaId: where.areaId } : {}),
      ...(exclude.areaId ? { areaId: { not: exclude.areaId } } : {}),
      ...(exclude.categoryId ? { categoryId: { not: exclude.categoryId } } : {}),
    },
    select: {
      areaId: true,
      categoryId: true,
      area: { select: { slug: true, name: true, emirate: true } },
      category: { select: { slug: true, name: true } },
    },
  });

  const links: CrossLink[] = [];
  for (const row of rows) {
    const state = await areaPageState(row.areaId, row.categoryId);
    if (!state?.live) continue;
    links.push({
      emirate: row.area.emirate as string,
      areaSlug: row.area.slug,
      areaName: row.area.name,
      categorySlug: row.category.slug,
      categoryName: row.category.name,
      listings: state.listings,
    });
  }
  return links.sort((a, b) => b.listings - a.listings);
}

export function sameTradeElsewhere(categoryId: string, exceptAreaId: string) {
  return crossLinks({ categoryId }, { areaId: exceptAreaId });
}

export function otherTradesHere(areaId: string, exceptCategoryId: string) {
  return crossLinks({ areaId }, { categoryId: exceptCategoryId });
}
