import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import {
  directoryLinks,
  GUIDE_MIN_WORDS,
  guideWords,
  readGuideBlocks,
  type GuideBlock,
} from "./blocks";
import { freshness } from "./freshness";
import { guideSlugCollision } from "./subjects";

/**
 * Boards 10b and 6d — guide authoring.
 *
 * Twenty-two articles, and per `CLAUDE.md` they belong in the database behind
 * this screen rather than in a seed constant: a guide written through the admin
 * costs no deploy, and one written as a constant costs a build, a deploy and a
 * cold cache for every page on the site.
 *
 * Two rules the service owns, because neither survives being left to the form:
 *
 *   1. **A published slug is frozen.** `Redirect` states the rule and this is
 *      one of the surfaces it governs. A URL that has been crawled and linked
 *      is the whole asset an article builds; moving it without a 301 spends
 *      exactly what the article was written to earn.
 *   2. **A guide publishes above the word floor.** Not the board 6f matrix —
 *      that counts listings and verified share, and a guide about payment terms
 *      has neither — but the same 250, read from `DEFAULT_THRESHOLDS`.
 */

export type GuideRefusal =
  | "not_found"
  | "not_a_slug"
  | "slug_taken"
  | "slug_frozen"
  | "too_thin"
  | "no_summary"
  | "no_directory_link"
  | "still_published"
  | "slug_reserved"
  | "subject_holds_slug"
  | "not_published";

export type GuideResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: GuideRefusal; message: string; have?: number; need?: number };

const MESSAGE: Record<GuideRefusal, string> = {
  not_found: "That guide is not here.",
  not_a_slug: "Lowercase letters, digits and hyphens, like getting-a-supplier-to-turn-up.",
  slug_taken: "Another guide already has that address.",
  /*
     Three refusals rather than one, because "another guide already has that
     address" was false for two of the three cases and a person reading it would
     go looking for a guide that does not exist.
  */
  slug_reserved:
    "That address is a page in its own right. Pick another — a guide cannot sit on top of it, because the fixed route answers first and the guide would have no URL at all.",
  subject_holds_slug:
    "A guide subject already has that address. Guides and subjects both live directly under /guides/, so one segment cannot be both.",
  not_published:
    "Publish it first. The start-here slot is a link on the index, and a draft in it is a link to a 404.",
  slug_frozen:
    "This guide is published, so its address is fixed. Unpublish it to move it, and add a redirect from the old address.",
  too_thin: "",
  no_summary: "A summary of at least 20 characters. It is the index card and the meta description.",
  /*
     Acceptance 10, and the reason is the whole point of the programme. Guides
     exist to earn the links that make the 84 area pages rank; one that keeps
     all of that authority in its own footer has done the expensive half of the
     job and skipped the cheap half.
  */
  no_directory_link:
    "No link from the body into the directory. The closing call to action is not enough — a category or area page named in a paragraph is what passes this guide's authority to the pages that need it.",
  still_published: "Unpublish it first. A published address that disappears is a 404 somebody has linked to.",
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Segments under `/guides/` that are not articles — board 10b.
 *
 * The index's subject chips are real URLs at the same depth as an article, and
 * so is the page the author strip links to. Next matches a static segment
 * before the dynamic one, so a guide minted at `how-we-check` would not merely
 * be confusing: it would be unreachable, because the static route would answer
 * first and the guide would have no URL at all.
 *
 * Subjects are checked against the table rather than listed here, because they
 * are editable content. This set is the routes that exist in the tree.
 */
const RESERVED_GUIDE_SLUGS = new Set(["how-we-check"]);

function refuse<T>(error: GuideRefusal, extra?: { have: number; need: number }): GuideResult<T> {
  if (error === "too_thin" && extra) {
    return {
      ok: false,
      error,
      // The number, not "too short" — §08, and it is the number somebody acts on.
      message: `${extra.have} words. A guide publishes at ${extra.need}.`,
      have: extra.have,
      need: extra.need,
    };
  }
  return { ok: false, error, message: MESSAGE[error] };
}

export interface GuideRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  byline: string | null;
  ctaCategoryId: string | null;
  ctaCategoryName: string | null;
  words: number;
  publishedAt: Date | null;
  updatedAt: Date;
  /** Whether publish would be accepted right now. */
  publishable: boolean;

  /* Board 10b — the fields the index reads, so the editor can fill them. */
  standfirst: string | null;
  topic: string | null;
  bylineRole: string | null;
  subjectId: string | null;
  subjectName: string | null;
  sortOrder: number;
  reviewCadenceMonths: number | null;
  regulatoryCheckedAt: Date | null;
  featured: boolean;
  featuredNote: string | null;
}

const SELECT = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  body: true,
  byline: true,
  ctaCategoryId: true,
  publishedAt: true,
  updatedAt: true,
  standfirst: true,
  topic: true,
  bylineRole: true,
  subjectId: true,
  sortOrder: true,
  reviewCadenceMonths: true,
  regulatoryCheckedAt: true,
  featuredAt: true,
  featuredNote: true,
  ctaCategory: { select: { name: true } },
  subject: { select: { name: true } },
} as const;

type GuideRecord = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: unknown;
  byline: string | null;
  standfirst: string | null;
  topic: string | null;
  bylineRole: string | null;
  subjectId: string | null;
  sortOrder: number;
  reviewCadenceMonths: number | null;
  regulatoryCheckedAt: Date | null;
  featuredAt: Date | null;
  featuredNote: string | null;
  subject: { name: string } | null;
  ctaCategoryId: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  ctaCategory: { name: string } | null;
};

function toRow(guide: GuideRecord): GuideRow {
  const words = guideWords(readGuideBlocks(guide.body));
  return {
    id: guide.id,
    slug: guide.slug,
    title: guide.title,
    summary: guide.summary,
    byline: guide.byline,
    ctaCategoryId: guide.ctaCategoryId,
    ctaCategoryName: guide.ctaCategory?.name ?? null,
    words,
    publishedAt: guide.publishedAt,
    updatedAt: guide.updatedAt,
    publishable: words >= GUIDE_MIN_WORDS,
    standfirst: guide.standfirst,
    topic: guide.topic,
    bylineRole: guide.bylineRole,
    subjectId: guide.subjectId,
    subjectName: guide.subject?.name ?? null,
    sortOrder: guide.sortOrder,
    reviewCadenceMonths: guide.reviewCadenceMonths,
    regulatoryCheckedAt: guide.regulatoryCheckedAt,
    featured: guide.featuredAt !== null,
    featuredNote: guide.featuredNote,
  };
}

/**
 * Every guide, drafts first.
 *
 * The screen is for writing, and the drafts are the work. Same reason every
 * queue in the console leads with what is still pending rather than with what
 * is already decided.
 */
export async function guideList(): Promise<GuideRow[]> {
  const rows = await prisma.guide.findMany({
    orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { updatedAt: "desc" }],
    select: SELECT,
  });
  return rows.map(toRow);
}

export async function guideById(id: string): Promise<(GuideRow & { blocks: GuideBlock[] }) | null> {
  const guide = await prisma.guide.findUnique({ where: { id }, select: SELECT });
  if (!guide) return null;
  return { ...toRow(guide), blocks: readGuideBlocks(guide.body) };
}

export interface SaveGuideInput {
  actor: Actor;
  id?: string;
  slug: string;
  title: string;
  summary: string;
  byline: string | null;
  ctaCategoryId: string | null;
  blocks: GuideBlock[];
  reason: string;

  /*
     Board 10b. Everything the index prints, and nothing could write.

     Board 6d added `standfirst`, `topic`, `bylineRole` and
     `reviewCadenceMonths` and wired none of them to a form, so the only thing
     that has ever set them is `prisma/seed-guides.mts` — guide content living
     in a commit, which costs a build and a cold cache for every page on the
     site to change one sentence.
  */
  /** The sentence that states the problem. Null falls back to the summary. */
  standfirst?: string | null;
  /** The kicker's middle term on the article. Not the index's shelf. */
  topic?: string | null;
  /** What the byline says the author does. Null renders the name alone. */
  bylineRole?: string | null;
  /** Which shelf the index files it under. */
  subjectId?: string | null;
  /** Sequence within that shelf. Board 10b Q1: sequence, not recency. */
  sortOrder?: number;
  /**
   * Months between regulatory re-checks, or null for an article that makes no
   * claim about the world. Null is never overdue rather than always overdue.
   */
  reviewCadenceMonths?: number | null;
}

/**
 * Create or edit. One path, because the two differ only in whether the slug is
 * allowed to move — and that difference is publication, not creation.
 */
export async function saveGuide(input: SaveGuideInput): Promise<GuideResult<{ id: string }>> {
  const slug = input.slug.trim().toLowerCase();
  const title = input.title.trim();
  const summary = input.summary.trim();

  if (!SLUG.test(slug)) return refuse("not_a_slug");
  if (RESERVED_GUIDE_SLUGS.has(slug)) return refuse("slug_reserved");

  /*
     And not a subject's slug either. `/guides/buying-safely` is one segment
     that resolves an article first and a shelf second, so a guide taking a
     subject's slug would take the shelf's page away from it silently.
  */
  const held = await guideSlugCollision(slug, "guide", input.id ? { id: input.id } : undefined);
  if (held) return refuse("subject_holds_slug");
  if (summary.length < 20 || title.length < 3) return refuse("no_summary");

  const existing = input.id
    ? await prisma.guide.findUnique({
        where: { id: input.id },
        // `byline` and `bylineRole` are here for the audit row, not for the
        // write. Board 6d's answer names a real person on a published article,
        // and a change of credit that leaves no record is the one edit on this
        // screen somebody could make and deny.
        select: {
          id: true,
          slug: true,
          title: true,
          byline: true,
          bylineRole: true,
          publishedAt: true,
        },
      })
    : null;
  if (input.id && !existing) return refuse("not_found");

  if (existing && existing.slug !== slug && existing.publishedAt) {
    return refuse("slug_frozen");
  }

  if (!existing || existing.slug !== slug) {
    const clash = await prisma.guide.findUnique({ where: { slug }, select: { id: true } });
    if (clash) return refuse("slug_taken");
  }

  // Unknown kinds are dropped on the way in as well as on the way out. A body
  // that round-trips through the editor should not accumulate blocks nothing
  // renders, silently counting toward a word floor no reader ever sees.
  const blocks = readGuideBlocks(input.blocks);
  /*
     `undefined` leaves a column alone; `null` clears it.

     Every board-10b field is optional on the input so a caller that does not
     know about them — the seed's own path, or a future editor that edits only
     the body — cannot blank them by omission.
  */
  const optional = (value: string | null | undefined) =>
    value === undefined ? undefined : value?.trim() || null;

  const data = {
    slug,
    title,
    summary,
    byline: input.byline?.trim() || null,
    ctaCategoryId: input.ctaCategoryId,
    body: blocks as unknown as object,
    standfirst: optional(input.standfirst),
    topic: optional(input.topic),
    bylineRole: optional(input.bylineRole),
    ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
    ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
    ...(input.reviewCadenceMonths === undefined
      ? {}
      : { reviewCadenceMonths: input.reviewCadenceMonths }),
  };

  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `Guide:${slug}`,
        reason: input.reason,
        tx,
      },
      async () => {
        if (existing) {
          await tx.guide.update({ where: { id: existing.id }, data });
          return {
            result: existing.id,
            before: {
              slug: existing.slug,
              title: existing.title,
              byline: existing.byline,
              bylineRole: existing.bylineRole,
            },
            after: {
              slug,
              title,
              words: guideWords(blocks),
              byline: data.byline,
              bylineRole: data.bylineRole ?? null,
            },
          };
        }
        const row = await tx.guide.create({ data, select: { id: true } });
        return {
          result: row.id,
          before: null,
          after: {
            slug,
            title,
            words: guideWords(blocks),
            byline: data.byline,
            bylineRole: data.bylineRole ?? null,
          },
        };
      },
    ),
  );

  return { ok: true, id };
}

export async function publishGuide(
  actor: Actor,
  id: string,
  reason: string,
): Promise<GuideResult<{ publishedAt: Date }>> {
  const guide = await prisma.guide.findUnique({
    where: { id },
    select: { id: true, slug: true, body: true, publishedAt: true },
  });
  if (!guide) return refuse("not_found");

  const blocks = readGuideBlocks(guide.body);
  const words = guideWords(blocks);
  if (words < GUIDE_MIN_WORDS) {
    return refuse("too_thin", { have: words, need: GUIDE_MIN_WORDS });
  }

  // Acceptance 10. Body links only — the CTA is guaranteed by the template and
  // is not what carries authority to an area page.
  if (directoryLinks(blocks).length === 0) {
    return refuse("no_directory_link");
  }

  const publishedAt = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `Guide:${guide.slug}`,
        reason,
        tx,
      },
      async () => {
        const row = await tx.guide.update({
          where: { id: guide.id },
          // Re-publishing an already-published guide keeps the original date.
          // `lastmod` is meant to say when the content changed, and `updatedAt`
          // carries that; moving `publishedAt` would tell a crawler the article
          // is new every time somebody fixes a typo.
          data: { publishedAt: guide.publishedAt ?? new Date() },
          select: { publishedAt: true },
        });
        return {
          result: row.publishedAt as Date,
          before: { publishedAt: guide.publishedAt },
          after: { publishedAt: row.publishedAt, words },
        };
      },
    ),
  );

  return { ok: true, publishedAt };
}

export async function unpublishGuide(
  actor: Actor,
  id: string,
  reason: string,
): Promise<GuideResult> {
  const guide = await prisma.guide.findUnique({
    where: { id },
    select: { id: true, slug: true, publishedAt: true },
  });
  if (!guide) return refuse("not_found");

  await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor, capability: "taxonomy.write", subject: `Guide:${guide.slug}`, reason, tx },
      async () => {
        await tx.guide.update({ where: { id: guide.id }, data: { publishedAt: null } });
        return {
          result: null,
          before: { publishedAt: guide.publishedAt },
          after: { publishedAt: null },
        };
      },
    ),
  );

  return { ok: true };
}

/**
 * Delete, and only while unpublished.
 *
 * The schema comment on `Redirect` says deleting a published page without one
 * is blocked at the service layer. Here that is the whole rule: unpublish
 * first, which is a decision with a reason on it, and then the address is
 * already gone from the index before the row goes.
 */
export async function deleteGuide(actor: Actor, id: string, reason: string): Promise<GuideResult> {
  const guide = await prisma.guide.findUnique({
    where: { id },
    select: { id: true, slug: true, title: true, publishedAt: true },
  });
  if (!guide) return refuse("not_found");
  if (guide.publishedAt) return refuse("still_published");

  await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor, capability: "taxonomy.write", subject: `Guide:${guide.slug}`, reason, tx },
      async () => {
        await tx.guide.delete({ where: { id: guide.id } });
        return {
          result: null,
          // The row is gone; the audit row is the only record it existed.
          before: { slug: guide.slug, title: guide.title },
          after: null,
        };
      },
    ),
  );

  return { ok: true };
}

/**
 * Board 6d §Evergreen — the regulatory re-check, and the queue it feeds.
 *
 * Guides make factual claims about the world: a named authority, a VAT rate, a
 * renewal cadence. Those change, and an article with a 2026 publication date
 * and 2029 traffic is a liability on a page whose subject is trustworthiness.
 *
 * ## Overdue does not unpublish
 *
 * The deliberate difference from a curated list, and the reason is worth
 * keeping in one sentence: a stale list misrepresents named sellers, while a
 * stale guide is merely old. So `6b`'s SLA takes a list down and this one does
 * not — overdue articles stay live and surface in the editorial queue, and if a
 * specific claim is found wrong the fix is an edit and a new check date rather
 * than a takedown.
 *
 * ## Why a re-check is its own mutation
 *
 * `regulatoryCheckedAt` is the one field an editor moves without touching a
 * word of the article, and moving it is a claim: somebody read the external
 * facts again and they still hold. That is a decision with an actor, so it
 * writes an audit row with a written reason like every other one.
 *
 * It is deliberately not a side effect of saving the body. A typo fix is not a
 * regulatory check, and a field that moved whenever anybody touched the article
 * would make the date meaningless in exactly the way `updatedAt` already is.
 */
export async function recordRegulatoryCheck(
  actor: Actor,
  id: string,
  reason: string,
  now = new Date(),
): Promise<GuideResult<{ checkedAt: Date }>> {
  const guide = await prisma.guide.findUnique({
    where: { id },
    select: { id: true, slug: true, regulatoryCheckedAt: true },
  });
  if (!guide) return refuse("not_found");

  await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor, capability: "taxonomy.write", subject: `Guide:${guide.slug}`, reason, tx },
      async () => {
        await tx.guide.update({ where: { id: guide.id }, data: { regulatoryCheckedAt: now } });
        return {
          result: null,
          before: { regulatoryCheckedAt: guide.regulatoryCheckedAt },
          after: { regulatoryCheckedAt: now },
        };
      },
    ),
  );

  return { ok: true, checkedAt: now };
}

export interface OverdueGuide {
  id: string;
  slug: string;
  title: string;
  checkedAt: Date | null;
  dueAt: Date;
  cadenceMonths: number;
}

/**
 * Articles whose external facts are past their cadence — the board 6f queue.
 *
 * Only articles that carry a cadence: one about how to write a good RFQ makes
 * no claim about the world and is never overdue. Published only, because an
 * unpublished draft is nobody's deadline.
 *
 * Oldest first, which is the order to work it.
 */
export async function overdueGuides(now = new Date()): Promise<OverdueGuide[]> {
  const rows = await prisma.guide.findMany({
    where: { publishedAt: { not: null }, reviewCadenceMonths: { not: null } },
    select: {
      id: true,
      slug: true,
      title: true,
      publishedAt: true,
      regulatoryCheckedAt: true,
      reviewCadenceMonths: true,
    },
  });

  const overdue: OverdueGuide[] = [];
  for (const row of rows) {
    const cadence = row.reviewCadenceMonths as number;
    /*
       Through `freshness`, which board 10b's public index reads for the same
       row. `6d`'s rule is that an overdue article stays published, so the index
       says "review overdue" out loud — and a queue that disagreed with the page
       it links to would be the version of that rule nobody could defend.

       It also fixes the arithmetic this loop had. `setMonth` rolls 31 August
       plus six months into 3 March, because February has no 31st, so an article
       checked on a month end reported a due date days into the following month
       and read as less overdue than it was.
    */
    const state = freshness(row, now);
    if (!state.overdue || state.dueAt === null) continue;

    overdue.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      checkedAt: row.regulatoryCheckedAt,
      dueAt: state.dueAt,
      cadenceMonths: cadence,
    });
  }

  return overdue.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/**
 * The `START HERE` slot — board 10b §4.
 *
 * Editorial, one at a time, and the label on the page says editorial rather
 * than claiming a ranking. The board called the slot `MOST READ`, which is
 * either a computed ranking or an editorial choice and cannot be both: computed
 * it rotates on traffic and the standfirst has to work for whichever article
 * wins, and nobody has written one for every article.
 *
 * Clearing the old holder and setting the new one happen in one transaction,
 * because the database refuses two featured rows — a unique index over a
 * constant expression filtered to `featured_at IS NOT NULL` — and doing it in
 * the other order would refuse the write rather than move the slot.
 *
 * Published only. A draft in the hero is a link to a 404.
 */
export async function setFeaturedGuide(
  actor: Actor,
  id: string | null,
  reason: string,
  /** The line under the standfirst saying why this one is first. */
  note: string | null = null,
  now = new Date(),
): Promise<GuideResult> {
  const before = await prisma.guide.findFirst({
    where: { featuredAt: { not: null } },
    select: { id: true, slug: true },
  });

  const next = id
    ? await prisma.guide.findUnique({
        where: { id },
        select: { id: true, slug: true, publishedAt: true },
      })
    : null;

  if (id && !next) return refuse("not_found");
  if (next && next.publishedAt === null) return refuse("not_published");
  if (before?.id === next?.id && (before || next)) return { ok: true };

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `Guide:${next?.slug ?? before?.slug ?? "none"}`,
        reason,
        tx,
      },
      async () => {
        /*
           The note is cleared with the slot, and a CHECK refuses one without a
           slot. A sentence explaining why an article is first, still on the
           page after the slot moved, is the frozen-claim failure this board's
           §Ordering exists to prevent.
        */
        if (before) {
          await tx.guide.update({
            where: { id: before.id },
            data: { featuredAt: null, featuredNote: null },
          });
        }
        if (next) {
          await tx.guide.update({
            where: { id: next.id },
            data: { featuredAt: now, featuredNote: note?.trim() || null },
          });
        }
        return {
          result: null,
          before: { featured: before?.slug ?? null },
          after: { featured: next?.slug ?? null },
        };
      },
    ),
  );

  return { ok: true };
}

export interface SaveSubjectInput {
  actor: Actor;
  id?: string;
  slug: string;
  name: string;
  blurb: string | null;
  sortOrder: number;
  reason: string;
}

/**
 * Create or rename a shelf — board 10b §3.
 *
 * A shelf is content, not a code constant, which is the whole reason the
 * taxonomy is a table: board 10b Q2 says the four subjects have never been
 * agreed and recommends dropping one, and a taxonomy in an enum costs a
 * migration and a deploy to change its own mind.
 *
 * The slug shares one namespace with every article, because both live directly
 * under `/guides/` and one route resolves both.
 */
export async function saveGuideSubject(input: SaveSubjectInput): Promise<GuideResult<{ id: string }>> {
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();

  if (!SLUG.test(slug)) return refuse("not_a_slug");
  if (RESERVED_GUIDE_SLUGS.has(slug)) return refuse("slug_reserved");
  if (name.length < 3) return refuse("no_summary");

  const held = await guideSlugCollision(slug, "subject", input.id ? { id: input.id } : undefined);
  if (held) {
    return refuse(held.heldBy === "guide" ? "slug_taken" : "subject_holds_slug");
  }

  const data = {
    slug,
    name,
    blurb: input.blurb?.trim() || null,
    sortOrder: input.sortOrder,
  };

  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `GuideSubject:${slug}`,
        reason: input.reason,
        tx,
      },
      async () => {
        if (input.id) {
          const row = await tx.guideSubject.update({
            where: { id: input.id },
            data,
            select: { id: true },
          });
          return { result: row.id, before: { slug: input.slug }, after: data };
        }
        const row = await tx.guideSubject.create({ data, select: { id: true } });
        return { result: row.id, before: null, after: data };
      },
    ),
  );

  return { ok: true, id };
}
