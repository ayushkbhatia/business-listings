import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { SubjectRef } from "@/lib/audit/types";
import { VERIFIED_TIER } from "@/lib/verification";
import {
  countWords,
  evaluateHold,
  evaluatePublish,
  isSupply,
  listingsNeeded,
  type PublishFailure,
} from "@/lib/publish-threshold";
/*
   The one builder, imported rather than restated.

   This file carried a private `thresholdsFor` and a private `countWords` whose
   bodies were byte-identical to the exported pair — while its own docblock
   below argued that "two gates that agree until somebody changes one is the
   defect this project repeats most". Board 6f adds three columns to the
   threshold bag, and a copy would have meant the 84 emirate pages publishing on
   the old rule while the area pages under them published on the new one: a URL
   in the sitemap that the route 404s.
*/
import { CATEGORY_RULES_SELECT, thresholdsFor } from "@/lib/taxonomy/service";
import {
  landingState,
  refreshFreshness,
  resolveEmirateScope,
  type LandingFaqRow,
  type LandingRelatedRow,
  type LandingScope,
  type LandingState,
} from "@/lib/seo/landing";

/**
 * The emirate × sector landing page — `/:emirate/:category`.
 *
 * Board 6c's matrix is twelve sectors by seven emirates and calls the result
 * "84 pages". Until now those pages did not exist: `AreaPage` is keyed on
 * (area, category), and an area is "Al Quoz Industrial 1" rather than Dubai, so
 * "HVAC in Dubai" had no URL for the matrix to point at. This is that URL.
 *
 * ## Where the intro comes from
 *
 * `EmiratePage`, one row per (emirate, sector), holding the paragraph and the
 * staff intent to publish. It is `AreaPage`'s twin on purpose — same two
 * authored fields, same floors, same reading of live — because the two page
 * types differ in what they are about and not in how they behave.
 *
 * This started out reading the sector's own `Category.intro` instead, to avoid
 * a table. That meant seven emirate pages sharing one paragraph: thin-content
 * risk on exactly the pages the acquisition engine depends on, and no way to
 * write something true about Sharjah that is not also true about Fujairah. The
 * table is the smaller cost.
 *
 * ## Why the floors are re-checked and never cached
 *
 * `livePages` in the area module makes the same choice for the same reason: a
 * page whose supply dropped this morning must stop being indexable in the same
 * request, not when a job next runs. The matrix, the page's own robots tag and
 * the sitemap all call in here, so they cannot disagree.
 */

/**
 * One emirate page's state — `landingState` plus the two keys callers use.
 *
 * A superset rather than a hand-written projection, for the reason the file
 * argues about everything else here: the projection listed fifteen fields, and
 * board 6f added seven that it would have silently dropped.
 */
export interface EmiratePageState extends LandingState {
  emirate: string;
  categoryId: string;
}

/*
   The per-cell supply query that lived here is gone: `emirateCategoryState`
   delegates to `landingState`, which counts a scope the one way every surface
   counts it. The matrix below still counts in bulk, because 84 cells in one
   round trip is the spec's own requirement and 84 state calls is not.
*/

/**
 * The four conditions for one emirate page.
 *
 * Delegated to `landingState` rather than implemented twice. It was implemented
 * twice until board 6a added the FAQ condition, and two gates that agree until
 * somebody changes one is the defect this project repeats most — here it would
 * mean the 84 pages board 6c's matrix links publishing on a different rule from
 * the area pages that link to them.
 */
export async function emirateCategoryState(
  emirate: string,
  categoryId: string,
  now = new Date(),
): Promise<EmiratePageState | null> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { slug: true },
  });
  if (!category) return null;

  const scope = await resolveEmirateScope({ emirate, category: category.slug });
  if (!scope) return null;

  const state = await landingState(scope, now);
  return { ...state, emirate, categoryId };
}

// ─────────────────────────────────────────────────────────────────────────────
// The matrix
// ─────────────────────────────────────────────────────────────────────────────

export interface MatrixCell {
  emirate: string;
  listings: number;
  /** The floor this cell is measured against — board 6f's `have / need`. */
  need: number;
  /** Live means indexable: the count is a link and the URL is in the sitemap. */
  live: boolean;
}

export interface MatrixRow {
  id: string;
  slug: string;
  name: string;
  code: string;
  listings: number;
  /** This sector's own listing floor. The footnote quotes it. */
  publishThreshold: number;
  cells: MatrixCell[];
}

/** The seven, in the order the federal government lists them by size. */
export const MATRIX_EMIRATES = [
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "ras_al_khaimah",
  "fujairah",
  "umm_al_quwain",
] as const;

interface SupplyRow {
  sector_id: string;
  emirate: string;
  listings: bigint;
  verified: bigint;
}

/**
 * Every cell in one query, which is the spec's own requirement — "one query for
 * the matrix, not 84. This page must render in a single round trip."
 *
 * `Business.sectorId` is what makes that possible. It is the denormalised
 * top-level ancestor of `primaryCategoryId`, kept in step by a database
 * trigger, so a sector's total is one indexed column rather than a recursive
 * walk per cell. Counting `DISTINCT b.id` because a business with three
 * published locations in Dubai is one Dubai supplier, not three.
 */
const DAY_MS = 86_400_000;

export async function emirateMatrix(now = new Date()): Promise<MatrixRow[]> {
  const [sectors, rows, pages, demand] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: null },
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
        ...CATEGORY_RULES_SELECT,
      },
    }),
    prisma.$queryRaw<SupplyRow[]>`
      SELECT b.sector_id,
             l.emirate::text AS emirate,
             COUNT(DISTINCT b.id) AS listings,
             COUNT(DISTINCT b.id) FILTER (WHERE b.verification_tier >= ${VERIFIED_TIER}) AS verified
        FROM business b
        JOIN location l ON l.business_id = b.id AND l.published = true
       WHERE b.suspended_at IS NULL
         AND b.published_at IS NOT NULL
         AND b.sector_id IS NOT NULL
       GROUP BY b.sector_id, l.emirate
    `,
    /*
       Every authored page in one read. Eighty-four rows at most, and usually
       far fewer — the alternative is a lookup per cell, which is the 84 queries
       the spec forbids wearing a different hat.
    */
    prisma.emiratePage.findMany({
      select: {
        id: true,
        emirate: true,
        categoryId: true,
        intro: true,
        publishedAt: true,
        /*
           Board 6a's fourth condition, counted in the same read.

           Not a `_count`, because the condition is two numbers — four rows, of
           which two must be scope-specific — and a bare count cannot answer the
           second. Two booleans per row is a small payload against 84 cells and
           it keeps `cell.live` identical to what `landingState` decides on the
           page itself. If those two ever disagree, the sitemap contains a URL
           that 404s, which is criterion 13 failing in the expensive direction.
        */
        faq: { select: { scopeSpecific: true } },
        /*
           Board 6f. `cell.live` is what the sitemap and `/categories` read, so
           it has to answer the same question `landingState` answers on the page
           itself — which since 6f is the hysteresis band, the minimum-live
           window and the editorial hold, not the publish floor. Left on
           `decision.publishable` this function would have kept the sitemap on
           the old rule while the route served the new one.
        */
        firstPublishedAt: true,
        heldAt: true,
      },
    }),
    /*
       Recorded demand for the emirate-wide scopes, in one read. `areaId: null`
       is the emirate page's row; the area rows belong to a different matrix.
    */
    prisma.scopeDemand.findMany({
      where: { areaId: null },
      select: { categoryId: true, emirate: true, monthlySearches: true, capturedAt: true },
    }),
  ]);

  const pageFor = new Map(
    pages.map((page) => [`${page.categoryId}:${page.emirate}`, page]),
  );
  const demandFor = new Map(demand.map((row) => [`${row.categoryId}:${row.emirate}`, row]));

  const bySector = new Map<string, Map<string, { listings: number; verified: number }>>();
  for (const row of rows) {
    const perEmirate = bySector.get(row.sector_id) ?? new Map();
    perEmirate.set(row.emirate, {
      listings: Number(row.listings),
      verified: Number(row.verified),
    });
    bySector.set(row.sector_id, perEmirate);
  }

  return sectors
    .map((sector) => {
      const perEmirate = bySector.get(sector.id) ?? new Map();
      const thresholds = thresholdsFor(sector);

      const cells = MATRIX_EMIRATES.map((emirate) => {
        const found = perEmirate.get(emirate) ?? { listings: 0, verified: 0 };
        const page = pageFor.get(`${sector.id}:${emirate}`);
        const searches = demandFor.get(`${sector.id}:${emirate}`)?.monthlySearches;
        const input = {
          listings: found.listings,
          verified: found.verified,
          // Each cell's own paragraph now, not the sector's one shared one.
          introWords: countWords(page?.intro),
          /*
             Absent where no row exists yet, which reads as nought once the
             row does. A cell with no `EmiratePage` at all fails on copy
             anyway, so the distinction never decides a cell — it keeps the
             shape honest for a reader.
          */
          faqRows: page?.faq.length ?? 0,
          scopeSpecificFaqRows: (page?.faq ?? []).filter((row) => row.scopeSpecific).length,
          // Never `?? 0`: absent demand is the absolute floor.
          monthlySearches: searches ?? undefined,
        };
        const hold = evaluateHold(input, thresholds);
        const withinGrace =
          page?.firstPublishedAt != null &&
          now.getTime() - page.firstPublishedAt.getTime() < sector.minLiveDays * DAY_MS;
        return {
          emirate,
          listings: found.listings,
          need: listingsNeeded(input, thresholds).need,
          /*
             The same three clauses `landingState` applies, in the same order.
             If these two ever disagree the sitemap contains a URL that 404s.
          */
          live:
            page?.publishedAt != null &&
            page.heldAt == null &&
            (hold.publishable ||
              (withinGrace && hold.failures.every((f) => f.reason === "listings"))),
        };
      });

      return {
        id: sector.id,
        slug: sector.slug,
        name: sector.name,
        code: sector.code,
        // The row's own total is the sum of its cells. A business with
        // locations in two emirates counts in both, which is what a
        // per-emirate matrix means and what each cell already says.
        listings: cells.reduce((total, cell) => total + cell.listings, 0),
        publishThreshold: sector.publishThreshold,
        cells,
      };
    })
    .sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name));
}

/**
 * The emirate pages that may be indexed, for `sitemap.ts`.
 *
 * Derived from the same matrix the page renders, so criterion 4 — the set of
 * hrefs on `/categories` equals the set of URLs in the sitemap — holds by
 * construction rather than by two functions being kept in step by hand.
 *
 * `cell.live` is staff intent and supply together, so an unpublished page is
 * absent from both and a published one whose supply fell this morning leaves
 * both on the next read.
 */
export async function liveEmiratePages(
  now = new Date(),
): Promise<{ emirate: string; categorySlug: string }[]> {
  const matrix = await emirateMatrix(now);
  return matrix.flatMap((row) =>
    row.cells
      .filter((cell) => cell.live)
      .map((cell) => ({ emirate: cell.emirate, categorySlug: row.slug })),
  );
}

/** The one place the URL shape is written down. */
export function emiratePagePath(emirate: string, categorySlug: string): string {
  return `/${emirate}/${categorySlug}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The service half
//
// `AreaPage`'s, mirrored. Every function here writes an audit row with a
// written reason, because a staff member deciding that a page may be indexed is
// a state change somebody should be able to look up in six months.
// ─────────────────────────────────────────────────────────────────────────────

export type EmiratePageRefusal = "not_found" | "below_floors" | "not_published" | "held";

export type EmiratePageResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: EmiratePageRefusal; message: string; failing?: PublishFailure[] };

/**
 * The refusal, in numbers somebody can act on.
 *
 * "Needs 60, has 41" tells a recruiter how many calls to make. "Not eligible"
 * tells them to go and find out, which is the same information one screen
 * further away — §08.
 */
function refusalMessage(failing: readonly PublishFailure[]): string {
  return failing
    .map((failure) => {
      switch (failure.reason) {
        case "listings":
          return `${failure.have} listings, and it publishes at ${failure.need}.`;
        case "verified_share":
          return `${Math.round(failure.have * 100)}% verified, and it publishes at ${Math.round(
            failure.need * 100,
          )}%.`;
        case "intro_words":
          return `${failure.have} words of intro, and it publishes at ${failure.need}.`;
        case "faq_rows":
          return `${failure.have} questions in the FAQ, and it publishes at ${failure.need}.`;
        default:
          return `${failure.have} of those questions are specific to this scope, and it publishes at ${failure.need}.`;
      }
    })
    .join(" ");
}

async function subjectFor(emirate: string, categoryId: string): Promise<SubjectRef> {
  const category = await prisma.category.findUniqueOrThrow({
    where: { id: categoryId },
    select: { slug: true },
  });
  return `EmiratePage:${emirate}/${category.slug}` as SubjectRef;
}

export interface SaveEmirateIntroInput {
  actor: Actor;
  emirate: string;
  categoryId: string;
  intro: string;
  reason: string;
}

/** Write the paragraph. Creates the row on first save. */
export async function saveEmirateIntro(
  input: SaveEmirateIntroInput,
): Promise<EmiratePageResult<{ words: number }>> {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true },
  });
  if (!category) {
    return { ok: false, error: "not_found", message: "That trade is not here." };
  }

  const intro = input.intro.trim();
  const key = { emirate: input.emirate as never, categoryId: input.categoryId };
  const subject = await subjectFor(input.emirate, input.categoryId);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor: input.actor, capability: "taxonomy.write", subject, reason: input.reason, tx },
      async () => {
        const before = await tx.emiratePage.findUnique({
          where: { emirate_categoryId: key },
          select: { intro: true },
        });
        // §Freshness: a copy edit is one of the three reasons `UPDATED` moves.
        const now = new Date();
        await tx.emiratePage.upsert({
          where: { emirate_categoryId: key },
          create: { ...key, intro: intro || null, contentUpdatedAt: now },
          update: { intro: intro || null, contentUpdatedAt: now },
        });
        return {
          result: null,
          // The words, not the prose. An audit row is a record of a decision,
          // and pasting two paragraphs into it twice a week is not that.
          before: { words: countWords(before?.intro) },
          after: { words: countWords(intro) },
        };
      },
    ),
  );

  return { ok: true, words: countWords(intro) };
}

/**
 * Publish one emirate page.
 *
 * The floors are checked here, in the service, which is what "cannot be
 * published by API or by admin action" means — the screen and any future API
 * call go through this and there is no second path.
 */
export async function publishEmiratePage(
  actor: Actor,
  emirate: string,
  categoryId: string,
  reason: string,
): Promise<EmiratePageResult<{ publishedAt: Date }>> {
  const state = await emirateCategoryState(emirate, categoryId);
  if (!state) return { ok: false, error: "not_found", message: "That trade is not here." };

  // `Held · editorial`, as on the area class. A person's decision, checked
  // before the arithmetic so the refusal states the true reason.
  if (state.heldAt) {
    return {
      ok: false,
      error: "held",
      message: `Held by a person on ${state.heldAt.toISOString().slice(0, 10)}: ${state.heldReason ?? ""}`.trim(),
    };
  }

  if (!state.clearsFloors) {
    return {
      ok: false,
      error: "below_floors",
      message: refusalMessage(state.failing),
      failing: [...state.failing],
    };
  }

  const key = { emirate: emirate as never, categoryId };
  const subject = await subjectFor(emirate, categoryId);

  const now = new Date();
  const publishedAt = await prisma.$transaction(async (tx) =>
    staffMutation({ actor, capability: "taxonomy.write", subject, reason, tx }, async () => {
      const row = await tx.emiratePage.update({
        where: { emirate_categoryId: key },
        // An already-published page keeps its original date: `lastmod` is a
        // claim about when the content changed, not when somebody clicked.
        //
        // `firstPublishedAt` is stamped once and never again, so board 6f's
        // minimum-live window measures from the first time this page was live
        // rather than restarting on every republish.
        data: {
          publishedAt: state.publishedAt ?? now,
          firstPublishedAt: state.firstPublishedAt ?? now,
        },
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
    }),
  );

  return { ok: true, publishedAt };
}

/** Take one back out of the index. Always allowed, floors or no floors. */
export async function unpublishEmiratePage(
  actor: Actor,
  emirate: string,
  categoryId: string,
  reason: string,
): Promise<EmiratePageResult> {
  const state = await emirateCategoryState(emirate, categoryId);
  if (!state) return { ok: false, error: "not_found", message: "That trade is not here." };
  if (state.publishedAt === null) {
    return { ok: false, error: "not_published", message: "That page is not published." };
  }

  const key = { emirate: emirate as never, categoryId };
  const subject = await subjectFor(emirate, categoryId);

  await prisma.$transaction(async (tx) =>
    staffMutation({ actor, capability: "taxonomy.write", subject, reason, tx }, async () => {
      await tx.emiratePage.update({
        where: { emirate_categoryId: key },
        data: { publishedAt: null },
      });
      return { result: null, before: { publishedAt: state.publishedAt }, after: { publishedAt: null } };
    }),
  );

  return { ok: true };
}

export interface EmirateSweepResult {
  checked: number;
  unpublished: { emirate: string; categorySlug: string; failing: PublishFailure[] }[];
  /** How many had supply move under them, and so moved their `UPDATED` date. */
  refreshed: number;
  /** Below the band but inside their minimum-live window — board 6f §6. */
  heldByGrace: number;
}

/**
 * The emirate class's half of the nightly bookkeeping.
 *
 * `sweepAreaPages`'s twin, and it did not exist: the area pages have been swept
 * since board 6a's first cut and the 84 emirate pages have never been, so a
 * published one whose supply dropped kept a `published_at` that disagreed with
 * what the site served. Nothing broke, because `live` is computed at read time
 * either way — but the matrix told a staff member a page was published while
 * the page itself 404'd, which is the failure the sweep exists to prevent.
 *
 * Board 6a §Freshness adds the second reason to run it: `content_updated_at`
 * moves when supply moves, and this is where that is noticed.
 *
 * Not audited, for the reason `sweepAreaPages` is not: the platform following
 * its own published rule has no actor, and `AuditEvent.actorId` is NOT NULL
 * because the log records decisions.
 */
export async function sweepEmiratePages(now = new Date()): Promise<EmirateSweepResult> {
  const published = await prisma.emiratePage.findMany({
    where: { publishedAt: { not: null } },
    select: { emirate: true, categoryId: true, category: { select: { slug: true } } },
  });

  const unpublished: EmirateSweepResult["unpublished"] = [];
  let refreshed = 0;
  let held = 0;

  for (const page of published) {
    const state = await emirateCategoryState(page.emirate, page.categoryId, now);
    if (!state) continue;

    const freshness = await refreshFreshness(state.scope);
    if (freshness?.moved) refreshed += 1;

    // The band and the window, as on the area class — board 6f §6.
    if (state.holdsFloors) continue;
    if (state.withinGrace && state.holdFailing.every(isSupply)) {
      held += 1;
      continue;
    }

    await prisma.emiratePage.update({
      where: { emirate_categoryId: { emirate: page.emirate, categoryId: page.categoryId } },
      data: { publishedAt: null },
    });
    unpublished.push({
      emirate: page.emirate,
      categorySlug: page.category.slug,
      failing: [...state.holdFailing],
    });
  }

  return { checked: published.length, unpublished, refreshed, heldByGrace: held };
}

export interface EmiratePageRow extends EmiratePageState {
  categoryName: string;
  categorySlug: string;
  path: string;
}

/**
 * Every (emirate, sector) pair for the admin screen, whether or not a row
 * exists yet.
 *
 * Eighty-four rows, and the ones nobody has written are the interesting ones —
 * a screen that only listed authored pages would hide exactly the work that
 * needs doing.
 */
export async function emiratePageRows(now = new Date()): Promise<EmiratePageRow[]> {
  const matrix = await emirateMatrix(now);
  const rows: EmiratePageRow[] = [];

  for (const sector of matrix) {
    for (const emirate of MATRIX_EMIRATES) {
      const state = await emirateCategoryState(emirate, sector.id);
      if (!state) continue;
      rows.push({
        ...state,
        categoryName: sector.name,
        categorySlug: sector.slug,
        path: emiratePagePath(emirate, sector.slug),
      });
    }
  }

  // Closest to publishing first: that is the order somebody working the list
  // wants, rather than alphabetical.
  return rows.sort((a, b) => b.listings - a.listings);
}
