import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { resolveTemplateId } from "@/lib/spec/resolve";
import { writeRedirects } from "./rename";
import { normaliseSynonyms } from "./rules";
import { loadTradeKinds } from "./service";
import { resolveTradeKind } from "./trade-kind";
import { lockCategories } from "./write";

/**
 * Board 4d — the merge tool. Two categories become one.
 *
 * The source is absorbed and deleted; the target stays and gains everything
 * that was filed under the source. **B5: a merge writes a redirect
 * automatically** — every address the source owned 301s to the target's
 * equivalent, the same path `12b`'s listing merge takes through
 * `Redirect`. Without it every ranking the source's pages had is lost.
 *
 * ## What moves
 *
 * Everything that names the source by id: listings filed under it and listings
 * holding it as a second category, products, services and briefs, the spec
 * templates serving it, its landing pages and the demand recorded against them,
 * the day-by-day position history sellers read on `3a`, placements, alerts,
 * saved searches, import mappings, and — for a sector — its subcategories. Its
 * synonyms and its own name join the target's synonyms, because a buyer who
 * typed the old name should still land (`B4`).
 *
 * Where both sides hold a row the target may only hold once, the two are
 * combined rather than one silently lost: position history keeps the better
 * position and sums impressions, recorded demand sums its searches. Where
 * combining is not honest — two paid placement slots for one category, two
 * authored landing pages for one area — the merge is refused and says which, or
 * keeps the target's page and writes the source's copy into the audit row so
 * nothing authored disappears unrecorded.
 *
 * ## What is refused
 *
 *   - Different levels. A sector merges into a sector and a subcategory into a
 *     subcategory: two levels is what every reader of the tree walks.
 *   - Different trade kinds. Merging a trade sold by the job into one sold by
 *     the item flips what every listing moved renders, which is a `4d-s`
 *     decision with its own confirmation, not a side effect of tidying (`B8`).
 *   - Two paid placement slots — only one can exist, and one of them was
 *     bought.
 *   - A publish-rule change still awaiting its second approver on the source.
 *   - Two subcategories of the same name when two sectors merge.
 *
 * ## "Merge in progress"
 *
 * The board's state: *both categories locked, redirect written on completion.*
 * Both advisory locks are taken first and held for the transaction, and every
 * editor write takes the same lock, so an edit to either side waits for the
 * merge rather than landing on a row about to vanish.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export type MergeRefusal =
  | "not_found"
  | "same_category"
  | "level_mismatch"
  | "trade_kind_differs"
  | "placement_conflict"
  | "rule_change_pending"
  | "child_name_clash";

export interface MergeSide {
  id: string;
  name: string;
  slug: string;
  isSector: boolean;
  parentName: string | null;
  listings: number;
}

export interface MergePreview {
  source: MergeSide;
  target: MergeSide;
  refusal: { error: MergeRefusal; name?: string } | null;
  moves: {
    /** Public listings filed under the source — the figure its row in the tree shows. */
    listings: number;
    /** Unpublished, suspended or merged listings filed there, which move too and are not in the tree's figure. */
    unlistedListings: number;
    secondCategoryLinks: number;
    products: number;
    services: number;
    subcategories: number;
    areaPages: number;
    emiratePages: number;
    /** Pages the target already has for the same place; the source's copy goes to the audit row. */
    pagesKept: number;
    redirects: number;
    synonymsAdded: string[];
  };
  /** The template a moved product's form resolves to afterwards (`B6`: no product is rewritten). */
  targetTemplate: { name: string; version: number } | null;
}

export type MergeResult =
  | { ok: true; moved: MergePreview["moves"] }
  | { ok: false; error: MergeRefusal; name?: string };

async function side(db: Db, id: string) {
  return db.category.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      nameAr: true,
      slug: true,
      parentId: true,
      synonyms: true,
      defaultTemplateId: true,
      parent: { select: { name: true, slug: true } },
      defaultTemplate: { select: { name: true, version: true } },
      children: { select: { id: true, name: true, slug: true }, orderBy: [{ slug: "asc" }] },
    },
  });
}

/** Public listings under a category and its children, the figure the tree shows. */
async function listingsUnder(db: Db, ids: readonly string[]) {
  return db.business.count({
    where: { primaryCategoryId: { in: [...ids] }, publishedAt: { not: null }, suspendedAt: null },
  });
}

/**
 * Everything the confirmation states, and the reason it would be refused.
 *
 * The merge itself calls this inside its transaction, under both locks, so the
 * refusal it acts on is the one true at the moment of the write — not the one
 * true when the dialog opened.
 */
export async function previewMerge(sourceId: string, targetId: string, db: Db = prisma, now = new Date()): Promise<MergePreview | null> {
  const [source, target] = await Promise.all([side(db, sourceId), side(db, targetId)]);
  if (!source || !target) return null;

  const [
    sourceListings,
    targetListings,
    moveListings,
    unlisted,
    secondLinks,
    products,
    services,
    sourceAreaPages,
    targetAreaPages,
    sourceEmiratePages,
    targetEmiratePages,
    sourceSlots,
    targetSlots,
    pendingRules,
    kinds,
  ] = await Promise.all([
    listingsUnder(db, [source.id, ...source.children.map((child) => child.id)]),
    listingsUnder(db, [target.id, ...target.children.map((child) => child.id)]),
    db.business.count({ where: { primaryCategoryId: source.id, publishedAt: { not: null }, suspendedAt: null } }),
    db.business.count({ where: { primaryCategoryId: source.id, OR: [{ publishedAt: null }, { suspendedAt: { not: null } }] } }),
    db.businessCategory.count({ where: { categoryId: source.id } }),
    db.product.count({ where: { categoryId: source.id } }),
    db.service.count({ where: { categoryId: source.id } }),
    db.areaPage.findMany({ where: { categoryId: source.id }, select: { areaId: true } }),
    db.areaPage.findMany({ where: { categoryId: target.id }, select: { areaId: true } }),
    db.emiratePage.findMany({ where: { categoryId: source.id }, select: { emirate: true } }),
    db.emiratePage.findMany({ where: { categoryId: target.id }, select: { emirate: true } }),
    db.placementSlot.count({ where: { categoryId: source.id, OR: [{ endsOn: null }, { endsOn: { gt: now } }] } }),
    db.placementSlot.count({ where: { categoryId: target.id, OR: [{ endsOn: null }, { endsOn: { gt: now } }] } }),
    db.publishRuleChange.count({ where: { categoryId: source.id, state: "proposed" } }),
    loadTradeKinds(db),
  ]);

  const targetAreas = new Set(targetAreaPages.map((page) => page.areaId));
  const targetEmirates = new Set(targetEmiratePages.map((page) => page.emirate));
  const pagesKept =
    sourceAreaPages.filter((page) => targetAreas.has(page.areaId)).length +
    sourceEmiratePages.filter((page) => targetEmirates.has(page.emirate)).length;

  const merged = normaliseSynonyms([...target.synonyms, source.name, ...(source.nameAr ? [source.nameAr] : []), ...source.synonyms]);
  const held = new Set(target.synonyms.map((term) => term.toLocaleLowerCase("en")));
  held.add(target.name.toLocaleLowerCase("en"));
  const synonymsAdded = merged.value.filter((term) => !held.has(term.toLocaleLowerCase("en")));

  const addresses = mergeAddresses(source, target, {
    areaPages: await db.areaPage.findMany({
      where: { categoryId: source.id, OR: [{ publishedAt: { not: null } }, { firstPublishedAt: { not: null } }] },
      select: { area: { select: { slug: true, emirate: true } } },
      orderBy: [{ id: "asc" }],
    }),
    emiratePages: await db.emiratePage.findMany({
      where: { categoryId: source.id, OR: [{ publishedAt: { not: null } }, { firstPublishedAt: { not: null } }] },
      select: { emirate: true },
      orderBy: [{ id: "asc" }],
    }),
  });

  const clash = source.children.find((child) =>
    target.children.some((other) => other.name.toLocaleLowerCase("en") === child.name.toLocaleLowerCase("en")),
  );

  const refusal: MergePreview["refusal"] =
    source.id === target.id
      ? { error: "same_category" }
      : (source.parentId === null) !== (target.parentId === null)
        ? { error: "level_mismatch" }
        : resolveTradeKind(kinds, source.id) !== resolveTradeKind(kinds, target.id)
          ? { error: "trade_kind_differs" }
          : sourceSlots > 0 && targetSlots > 0
            ? { error: "placement_conflict" }
            : pendingRules > 0
              ? { error: "rule_change_pending" }
              : clash
                ? { error: "child_name_clash", name: clash.name }
                : null;

  return {
    source: {
      id: source.id,
      name: source.name,
      slug: source.slug,
      isSector: source.parentId === null,
      parentName: source.parent?.name ?? null,
      listings: sourceListings,
    },
    target: {
      id: target.id,
      name: target.name,
      slug: target.slug,
      isSector: target.parentId === null,
      parentName: target.parent?.name ?? null,
      listings: targetListings,
    },
    refusal,
    moves: {
      listings: moveListings,
      unlistedListings: unlisted,
      secondCategoryLinks: secondLinks,
      products,
      services,
      subcategories: source.parentId === null ? source.children.length : 0,
      areaPages: sourceAreaPages.length,
      emiratePages: sourceEmiratePages.length,
      pagesKept,
      redirects: addresses.length,
      synonymsAdded,
    },
    targetTemplate: await templateAfter(db, target, source),
  };
}

type Side = NonNullable<Awaited<ReturnType<typeof side>>>;

/**
 * The template a moved product's form opens on once the merge has run.
 *
 * The resolver's answer for the target, except where the target has no default
 * of its own and the source had one: the merge carries that default across, so
 * the products that move keep opening on the fields they were filled against.
 */
async function templateAfter(db: Db, target: Side, source: Side): Promise<{ name: string; version: number } | null> {
  if (target.defaultTemplateId === null && source.defaultTemplate) return source.defaultTemplate;
  const id = await resolveTemplateId(db, target.id);
  if (!id) return null;
  return db.specTemplate.findUnique({ where: { id }, select: { name: true, version: true } });
}

/** Every address the source owns, pointed at the target's equivalent. */
function mergeAddresses(
  source: Side,
  target: Side,
  pages: {
    areaPages: { area: { slug: string; emirate: string } }[];
    emiratePages: { emirate: string }[];
  },
): { from: string; to: string }[] {
  const pairs: { from: string; to: string }[] = [];
  if (source.parent && target.parent) {
    pairs.push({ from: `/c/${source.parent.slug}/${source.slug}`, to: `/c/${target.parent.slug}/${target.slug}` });
  } else {
    pairs.push({ from: `/c/${source.slug}`, to: `/c/${target.slug}` });
    // The subcategories keep their own slugs and move under the target's.
    for (const child of source.children) {
      pairs.push({ from: `/c/${source.slug}/${child.slug}`, to: `/c/${target.slug}/${child.slug}` });
    }
  }
  for (const page of pages.areaPages) {
    pairs.push({
      from: `/${page.area.emirate}/${page.area.slug}/${source.slug}`,
      to: `/${page.area.emirate}/${page.area.slug}/${target.slug}`,
    });
  }
  for (const page of pages.emiratePages) {
    pairs.push({ from: `/${page.emirate}/${source.slug}`, to: `/${page.emirate}/${target.slug}` });
  }
  return pairs;
}

/**
 * Fold the source into the target.
 *
 * One transaction. Every move, every redirect and the delete commit together,
 * and the audit rows with them; a failure anywhere leaves both categories as
 * they were.
 */
export async function mergeCategories(input: {
  actor: Actor;
  sourceId: string;
  targetId: string;
  reason: string;
  now?: Date;
}): Promise<MergeResult> {
  assertCan(input.actor, "taxonomy.merge");
  const now = input.now ?? new Date();

  return prisma.$transaction(
    async (tx) => {
      await lockCategories(tx, [input.sourceId, input.targetId]);

      const preview = await previewMerge(input.sourceId, input.targetId, tx, now);
      if (!preview) return { ok: false, error: "not_found" } as const;
      if (preview.refusal) return { ok: false, ...preview.refusal } as const;

      const source = (await side(tx, input.sourceId))!;
      const target = (await side(tx, input.targetId))!;
      const S = source.id;
      const T = target.id;

      const addresses = mergeAddresses(source, target, {
        areaPages: await tx.areaPage.findMany({
          where: { categoryId: S, OR: [{ publishedAt: { not: null } }, { firstPublishedAt: { not: null } }] },
          select: { area: { select: { slug: true, emirate: true } } },
          orderBy: [{ id: "asc" }],
        }),
        emiratePages: await tx.emiratePage.findMany({
          where: { categoryId: S, OR: [{ publishedAt: { not: null } }, { firstPublishedAt: { not: null } }] },
          select: { emirate: true },
          orderBy: [{ id: "asc" }],
        }),
      });

      const kept = await keptPages(tx, S, T);
      /*
         Board `6a-s` — the absorbed trade's landing-page wording. The target
         keeps its own, as it keeps its own pages; the source's plural noun,
         credential, template switch and questions survive in the audit row,
         which is where a merge writes whatever it does not carry over.
      */
      const [sourceLanding, sourceAsks] = await Promise.all([
        tx.category.findUnique({
          where: { id: S },
          select: { pluralHuman: true, credentialKind: true, servicesLandingOpenedAt: true },
        }),
        tx.categoryAsk.findMany({
          where: { categoryId: S },
          orderBy: { position: "asc" },
          select: { question: true, why: true },
        }),
      ]);

      await staffMutation(
        {
          actor: input.actor,
          capability: "taxonomy.merge",
          subject: `Category:${T}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await moveEverything(tx, source, target, now);
          await writeRedirects(tx, addresses);
          await tx.category.delete({ where: { id: S } });
          return {
            result: null,
            before: {
              absorbed: {
                id: S,
                name: source.name,
                slug: source.slug,
                parentId: source.parentId,
                synonyms: source.synonyms,
                servicesLanding: {
                  pluralHuman: sourceLanding?.pluralHuman ?? null,
                  credentialKind: sourceLanding?.credentialKind ?? null,
                  openedAt: sourceLanding?.servicesLandingOpenedAt ?? null,
                  asks: sourceAsks,
                },
              },
              // The authored copy of every page the target already had for the
              // same place. The page row is gone; this is where it survives.
              pagesKeptFromTarget: kept,
            },
            after: { mergedInto: T, moved: preview.moves },
            // Every listing row that moved, published or not — the audit counts rows written.
            blastRadius: { count: preview.moves.listings + preview.moves.unlistedListings, unit: "listings" },
          };
        },
      );

      // The absorbed category's own trail ends with where it went. The row is
      // gone, and a person reading the log by subject should not find a
      // category that simply stops.
      await staffMutation(
        { actor: input.actor, capability: "taxonomy.merge", subject: `Category:${S}`, reason: input.reason, tx },
        async () => ({ result: null, before: { name: source.name, slug: source.slug }, after: { mergedInto: T, name: target.name } }),
      );

      return { ok: true, moved: preview.moves } as const;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** Pages both sides hold for the same place: the source's copy, for the audit row. */
async function keptPages(tx: Tx, S: string, T: string) {
  const [area, emirate] = await Promise.all([
    tx.$queryRaw<{ area_id: string; intro: string | null; meta_description: string | null }[]>`
      SELECT s.area_id, s.intro, s.meta_description
        FROM area_page s JOIN area_page t ON t.area_id = s.area_id AND t.category_id = ${T}
       WHERE s.category_id = ${S}
       ORDER BY s.area_id`,
    tx.$queryRaw<{ emirate: string; intro: string | null; meta_description: string | null }[]>`
      SELECT s.emirate::text AS emirate, s.intro, s.meta_description
        FROM emirate_page s JOIN emirate_page t ON t.emirate = s.emirate AND t.category_id = ${T}
       WHERE s.category_id = ${S}
       ORDER BY s.emirate`,
  ]);
  const faqs = await tx.landingFaq.findMany({
    where: {
      OR: [
        { areaPage: { categoryId: S, areaId: { in: area.map((row) => row.area_id) } } },
        { emiratePage: { categoryId: S, emirate: { in: emirate.map((row) => row.emirate as never) } } },
      ],
    },
    select: { areaPage: { select: { areaId: true } }, emiratePage: { select: { emirate: true } }, question: true, answer: true },
    orderBy: [{ areaPageId: "asc" }, { emiratePageId: "asc" }, { position: "asc" }],
  });
  return {
    areaPages: area.map((row) => ({
      areaId: row.area_id,
      intro: row.intro,
      metaDescription: row.meta_description,
      faq: faqs.filter((faq) => faq.areaPage?.areaId === row.area_id).map(({ question, answer }) => ({ question, answer })),
    })),
    emiratePages: emirate.map((row) => ({
      emirate: row.emirate,
      intro: row.intro,
      metaDescription: row.meta_description,
      faq: faqs.filter((faq) => faq.emiratePage?.emirate === row.emirate).map(({ question, answer }) => ({ question, answer })),
    })),
  };
}

async function moveEverything(tx: Tx, source: Side, target: Side, now: Date): Promise<void> {
  const S = source.id;
  const T = target.id;
  const isSector = source.parentId === null;

  // ── The tree ─────────────────────────────────────────────────────────────
  if (isSector) {
    await tx.category.updateMany({ where: { parentId: S }, data: { parentId: T } });
    /*
       `business.sector_id` is kept by a trigger on `primary_category_id`, and
       re-parenting a subcategory does not touch that column — so a listing
       under a moved subcategory would keep naming the absorbed sector, and the
       delete below would fail on it.
    */
    await tx.$executeRaw`UPDATE business SET sector_id = ${T} WHERE sector_id = ${S}`;
    await tx.$executeRaw`
      INSERT INTO sector_suggestion (category_id, slug, label, picked_by, computed_at)
      SELECT ${T}, s.slug, s.label, s.picked_by, s.computed_at FROM sector_suggestion s WHERE s.category_id = ${S}
      ON CONFLICT (category_id, slug) DO UPDATE
        SET picked_by = sector_suggestion.picked_by + EXCLUDED.picked_by,
            computed_at = GREATEST(sector_suggestion.computed_at, EXCLUDED.computed_at)`;
  }

  // ── Listings ─────────────────────────────────────────────────────────────
  // The trigger recomputes `sector_id` for each row, including a subcategory
  // merged across sectors.
  await tx.business.updateMany({ where: { primaryCategoryId: S }, data: { primaryCategoryId: T } });

  // A second category the listing already holds, or that is now its primary, is
  // dropped rather than duplicated.
  await tx.$executeRaw`
    DELETE FROM business_category bc
     WHERE bc.category_id = ${S}
       AND (EXISTS (SELECT 1 FROM business_category x WHERE x.business_id = bc.business_id AND x.category_id = ${T})
            OR EXISTS (SELECT 1 FROM business b WHERE b.id = bc.business_id AND b.primary_category_id = ${T}))`;
  await tx.$executeRaw`
    DELETE FROM business_category bc
     WHERE bc.category_id = ${T}
       AND EXISTS (SELECT 1 FROM business b WHERE b.id = bc.business_id AND b.primary_category_id = ${T})`;
  await tx.businessCategory.updateMany({ where: { categoryId: S }, data: { categoryId: T } });

  // ── What listings sell ───────────────────────────────────────────────────
  await tx.product.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.service.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.serviceBrief.updateMany({ where: { categoryId: S }, data: { categoryId: T } });

  // ── Spec templates (B6: links, never product values) ─────────────────────
  await tx.$executeRaw`
    INSERT INTO spec_template_category (template_id, category_id)
    SELECT template_id, ${T} FROM spec_template_category WHERE category_id = ${S}
    ON CONFLICT DO NOTHING`;
  if (target.defaultTemplateId === null && source.defaultTemplateId !== null) {
    // The products that moved were described by this template. Keeping it the
    // one offered first means their forms still open on the fields they filled.
    await tx.category.update({ where: { id: T }, data: { defaultTemplateId: source.defaultTemplateId } });
  }

  // ── Routing ──────────────────────────────────────────────────────────────
  const synonyms = normaliseSynonyms([
    ...target.synonyms,
    source.name,
    ...(source.nameAr ? [source.nameAr] : []),
    ...source.synonyms,
  ]).value.filter((term) => term.toLocaleLowerCase("en") !== target.name.toLocaleLowerCase("en"));
  await tx.category.update({ where: { id: T }, data: { synonyms } });

  // ── Landing pages ────────────────────────────────────────────────────────
  // Where the target already has a page for the place, the target's stays; the
  // source's copy was read into the audit row before this ran.
  await tx.$executeRaw`
    DELETE FROM area_page s USING area_page t
     WHERE s.category_id = ${S} AND t.category_id = ${T} AND t.area_id = s.area_id`;
  await tx.areaPage.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.$executeRaw`
    DELETE FROM emirate_page s USING emirate_page t
     WHERE s.category_id = ${S} AND t.category_id = ${T} AND t.emirate = s.emirate`;
  await tx.emiratePage.updateMany({ where: { categoryId: S }, data: { categoryId: T } });

  // Recorded demand for one scope is the searches for both trades in it.
  await tx.$executeRaw`
    UPDATE scope_demand t
       SET monthly_searches = t.monthly_searches + s.monthly_searches,
           captured_at = GREATEST(t.captured_at, s.captured_at),
           updated_at = ${now}
      FROM scope_demand s
     WHERE s.category_id = ${S} AND t.category_id = ${T}
       AND t.emirate = s.emirate AND t.area_id IS NOT DISTINCT FROM s.area_id`;
  await tx.$executeRaw`
    DELETE FROM scope_demand s USING scope_demand t
     WHERE s.category_id = ${S} AND t.category_id = ${T}
       AND t.emirate = s.emirate AND t.area_id IS NOT DISTINCT FROM s.area_id`;
  await tx.scopeDemand.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  // History of rules decided about the source. Pending ones refused the merge.
  await tx.publishRuleChange.updateMany({ where: { categoryId: S }, data: { categoryId: T } });

  // ── Position history (3a / 3l) ───────────────────────────────────────────
  // A listing in both categories on one day held two positions in two lists;
  // the merged list keeps the better one and every impression.
  await tx.$executeRaw`
    UPDATE category_position_day t
       SET position = LEAST(t.position, s.position), impressions = t.impressions + s.impressions
      FROM category_position_day s
     WHERE s.category_id = ${S} AND t.category_id = ${T}
       AND t.business_id = s.business_id AND t.day = s.day AND t.emirate IS NOT DISTINCT FROM s.emirate`;
  await tx.$executeRaw`
    DELETE FROM category_position_day s USING category_position_day t
     WHERE s.category_id = ${S} AND t.category_id = ${T}
       AND t.business_id = s.business_id AND t.day = s.day AND t.emirate IS NOT DISTINCT FROM s.emirate`;
  await tx.categoryPositionDay.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.$executeRaw`
    UPDATE category_rank_day t
       SET position = LEAST(t.position, s.position), total = GREATEST(t.total, s.total)
      FROM category_rank_day s
     WHERE s.category_id = ${S} AND t.category_id = ${T}
       AND t.business_id = s.business_id AND t.day = s.day AND t.emirate IS NOT DISTINCT FROM s.emirate`;
  await tx.$executeRaw`
    DELETE FROM category_rank_day s USING category_rank_day t
     WHERE s.category_id = ${S} AND t.category_id = ${T}
       AND t.business_id = s.business_id AND t.day = s.day AND t.emirate IS NOT DISTINCT FROM s.emirate`;
  await tx.categoryRankDay.updateMany({ where: { categoryId: S }, data: { categoryId: T } });

  // ── Placement and alerts ─────────────────────────────────────────────────
  await tx.placementSlot.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.$executeRaw`
    DELETE FROM placement_waitlist s USING placement_waitlist t
     WHERE s.category_id = ${S} AND t.category_id = ${T}
       AND t.business_id = s.business_id AND t.emirate IS NOT DISTINCT FROM s.emirate`;
  await tx.placementWaitlist.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.listingBoost.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.productAlert.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.savedSearch.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.curatedList.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.guide.updateMany({ where: { ctaCategoryId: S }, data: { ctaCategoryId: T } });
  await tx.campaign.updateMany({ where: { ctaCategoryId: S }, data: { ctaCategoryId: T } });

  // ── The importer's memory and the search log ─────────────────────────────
  await tx.importMapping.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.stagedListing.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.licenceActivityMapping.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.searchQueryLog.updateMany({ where: { categoryId: S }, data: { categoryId: T } });
  await tx.zeroResultQuery.updateMany({ where: { categoryId: S }, data: { categoryId: T } });

}

/** Businesses whose search text names the target now — the ones a reindex must touch. */
export async function businessesUnder(categoryId: string, db: Db = prisma): Promise<string[]> {
  const rows = await db.business.findMany({
    where: { OR: [{ primaryCategoryId: categoryId }, { categories: { some: { categoryId } } }] },
    select: { id: true },
    orderBy: [{ id: "asc" }],
  });
  return rows.map((row) => row.id);
}
