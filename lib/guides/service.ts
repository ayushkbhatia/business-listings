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
  | "still_published";

export type GuideResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: GuideRefusal; message: string; have?: number; need?: number };

const MESSAGE: Record<GuideRefusal, string> = {
  not_found: "That guide is not here.",
  not_a_slug: "Lowercase letters, digits and hyphens, like getting-a-supplier-to-turn-up.",
  slug_taken: "Another guide already has that address.",
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
  ctaCategory: { select: { name: true } },
} as const;

type GuideRecord = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: unknown;
  byline: string | null;
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
  if (summary.length < 20 || title.length < 3) return refuse("no_summary");

  const existing = input.id
    ? await prisma.guide.findUnique({
        where: { id: input.id },
        select: { id: true, slug: true, title: true, publishedAt: true },
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
  const data = { slug, title, summary, byline: input.byline?.trim() || null, ctaCategoryId: input.ctaCategoryId, body: blocks as unknown as object };

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
            before: { slug: existing.slug, title: existing.title },
            after: { slug, title, words: guideWords(blocks) },
          };
        }
        const row = await tx.guide.create({ data, select: { id: true } });
        return { result: row.id, before: null, after: { slug, title, words: guideWords(blocks) } };
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
       An article never re-checked is measured from publication. On the day it
       went out its facts had just been read, which is the honest baseline —
       and treating "never checked" as infinitely overdue would put every new
       article in the queue the moment it published.
    */
    const from = row.regulatoryCheckedAt ?? (row.publishedAt as Date);
    const due = new Date(from);
    due.setMonth(due.getMonth() + cadence);
    if (due > now) continue;

    overdue.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      checkedAt: row.regulatoryCheckedAt,
      dueAt: due,
      cadenceMonths: cadence,
    });
  }

  return overdue.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
