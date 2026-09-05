import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { SubjectRef } from "@/lib/audit/types";
import { countWords, type PublishFailure } from "@/lib/publish-threshold";
import {
  landingState,
  refreshFreshness,
  scopeForArea,
  type LandingFaqRow,
  type LandingScope,
  type LandingState,
} from "@/lib/seo/landing";

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

export interface AreaPageState {
  areaId: string;
  categoryId: string;
  listings: number;
  verified: number;
  /** The one authored paragraph, as written. */
  intro: string | null;
  introWords: number;
  /** The per-scope editorial questions. Four of them is the fourth condition. */
  faq: LandingFaqRow[];
  /** Set by staff. Not the same thing as live. */
  publishedAt: Date | null;
  /** Whether all four conditions hold right now. */
  clearsFloors: boolean;
  /** Intent and conditions together. This is what the route and the sitemap read. */
  live: boolean;
  failing: PublishFailure[];
  /** The scope object, so callers do not resolve it a second time. */
  scope: LandingScope;
}

function toAreaState(state: LandingState): AreaPageState {
  return {
    areaId: state.scope.area?.id as string,
    categoryId: state.scope.category.id,
    listings: state.listings,
    verified: state.verified,
    intro: state.intro,
    introWords: state.introWords,
    faq: state.faq,
    publishedAt: state.publishedAt,
    clearsFloors: state.clearsFloors,
    live: state.live,
    failing: [...state.failing],
    scope: state.scope,
  };
}

/**
 * The four conditions for one area page.
 *
 * A thin wrapper over `landingState` now rather than a second implementation.
 * It was a second implementation until board 6a added the FAQ condition, at
 * which point the area class and the emirate class would have had two publish
 * gates that agreed until somebody changed one — the most repeated defect in
 * this project, in the one place where the cost is the whole domain's standing.
 */
export async function areaPageState(
  areaId: string,
  categoryId: string,
): Promise<AreaPageState | null> {
  const scope = await scopeForArea(areaId, categoryId);
  if (!scope) return null;
  return toAreaState(await landingState(scope));
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
        case "faq_rows":
          return `${failure.have} questions in the FAQ, and it publishes at ${failure.need}.`;
        case "faq_scope_specific":
          return `${failure.have} of those questions are specific to this scope, and it publishes at ${failure.need}.`;
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
        /*
           The copy edit moves `contentUpdatedAt` — §Freshness names it as one
           of the three reasons the date moves, and it is the only one a person
           causes directly. The digest is left alone: supply has not changed,
           and rewriting it here would tell the next sweep that it had.
        */
        const now = new Date();
        await tx.areaPage.upsert({
          where: { areaId_categoryId: { areaId: input.areaId, categoryId: input.categoryId } },
          create: {
            areaId: input.areaId,
            categoryId: input.categoryId,
            intro: intro || null,
            contentUpdatedAt: now,
          },
          update: { intro: intro || null, contentUpdatedAt: now },
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
  /** How many pages had supply move under them, and so moved their `UPDATED` date. */
  refreshed: number;
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
  let refreshed = 0;

  for (const page of published) {
    const state = await areaPageState(page.areaId, page.categoryId);
    if (!state) continue;

    /*
       §Freshness, and the reason it is here rather than on the read path.

       `UPDATED` moves when a listing enters or leaves the scope or changes
       verification tier. Recomputing that on every request would put a write
       on the busiest public template in the product and have two crawlers race
       each other for the same row; the sweep already walks exactly this set
       once a night with the numbers in hand.

       Before the unpublish check, so a page dropping out of the index still
       records the change in supply that took it out.
    */
    const freshness = await refreshFreshness(state.scope);
    if (freshness?.moved) refreshed += 1;

    if (state.clearsFloors) continue;

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

  return { checked: published.length, unpublished, refreshed };
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
      contentUpdatedAt: true,
      area: { select: { slug: true, emirate: true } },
      category: { select: { slug: true } },
    },
  });

  const live = [];
  for (const row of rows) {
    // Intent is not enough. The conditions are re-checked here so the sitemap
    // can never contain a page the route would serve as a 404.
    const state = await areaPageState(row.areaId, row.categoryId);
    if (!state?.live) continue;
    live.push({
      areaSlug: row.area.slug,
      emirate: row.area.emirate as string,
      categorySlug: row.category.slug,
      /*
         `contentUpdatedAt`, the same date the page prints — §Freshness.

         `updatedAt` moves whenever any column on the row is touched, including
         the supply digest the sweep writes and the `publishedAt` a staff member
         sets. A `lastmod` that moved for those would tell a crawler the content
         changed when it did not, and a crawler that finds nothing changed
         discounts the next one. Falls back only where a row predates the
         column.
      */
      updatedAt: row.contentUpdatedAt ?? row.updatedAt,
    });
  }
  return live;
}

/*
   The cross-link helpers that used to live here are gone.

   `sameTradeElsewhere` and `otherTradesHere` answered two of board 6a §6's
   three axes and knew nothing about the third — the same trade in the other
   emirates, which is the `/:emirate/:category` class and the column that makes
   the emirate pages reachable from the area pages at all. They also queried the
   area class only, so an emirate page calling them got area links.

   `lib/seo/landing/links.ts` answers all three from one scope object, which is
   what §1 means by one controller. Nothing else imported these.
*/
