import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { SubjectRef } from "@/lib/audit/types";
import { MAX_FAQ_ROWS, MAX_RELATED_SEARCHES, META_DESCRIPTION_MAX } from "./limits";
import { landingPageRow, type LandingScope } from "./scope";

/**
 * Board 6a §5 and §the-publish-gate — the content records, and who may write
 * them.
 *
 * *"The intro copy, FAQ rows and related searches are content records on the
 * scope, not queries."* And copy is a publish blocker, which makes writing it
 * the thing that ships the acquisition machine: a scope can clear 60 listings
 * and 30% verified and stay dark for want of 250 words and four questions.
 *
 * ## Why `taxonomy.write` and not a new capability
 *
 * Every content-ops mutation in handoff 4 went through it — homepage curation,
 * redirects, notification templates, the category intros this sits beside on
 * the same screen. A `content.write` capability would be a fourth name for the
 * same seat.
 *
 * ## Why writing is always allowed and publishing is not
 *
 * These functions never check the floors. A writer must be able to put 250
 * words against a scope that has 41 listings — that is how the queue works, and
 * refusing the copy until the supply arrives would mean nobody could get ahead
 * of recruitment. `publishAreaPage` is where the four conditions are enforced,
 * and it is the only path that sets `publishedAt`.
 *
 * ## Freshness
 *
 * Every mutation here moves `contentUpdatedAt`, because §Freshness names "the
 * intro copy or FAQ is edited" as one of the three reasons the date moves. The
 * digest is left alone: supply did not change, and rewriting it here would make
 * the next sweep think it had.
 */

export type ContentRefusal =
  | "not_found"
  | "too_many"
  | "empty"
  | "external_link"
  | "too_long";

export type ContentResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: ContentRefusal; message: string };

// The caps live in `./limits.ts`, which imports nothing: board 6f's editor is a
// client component and cannot reach a `server-only` module.
export { MAX_FAQ_ROWS, MAX_RELATED_SEARCHES, META_DESCRIPTION_MAX } from "./limits";

export interface FaqInput {
  question: string;
  answer: string;
  scopeSpecific: boolean;
  /** `quote_range`, or nothing. See `quote-range.ts`. */
  liveToken?: string | null;
}

export interface RelatedSearchInput {
  label: string;
  href: string;
}

function subjectFor(scope: LandingScope, areaSlug: string | null): SubjectRef {
  return scope.area
    ? `AreaPage:${areaSlug}/${scope.category.slug}`
    : `EmiratePage:${scope.emirate}/${scope.category.slug}`;
}

/**
 * The page row, created if it does not exist yet.
 *
 * A writer putting the first FAQ row against a scope should not have to publish
 * an empty intro first to bring the row into being.
 */
async function ensurePage(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  scope: LandingScope,
): Promise<string> {
  if (scope.area) {
    const row = await tx.areaPage.upsert({
      where: { areaId_categoryId: { areaId: scope.area.id, categoryId: scope.category.id } },
      create: { areaId: scope.area.id, categoryId: scope.category.id },
      update: {},
      select: { id: true },
    });
    return row.id;
  }
  const row = await tx.emiratePage.upsert({
    where: { emirate_categoryId: { emirate: scope.emirate, categoryId: scope.category.id } },
    create: { emirate: scope.emirate, categoryId: scope.category.id },
    update: {},
    select: { id: true },
  });
  return row.id;
}

async function stampContent(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  scope: LandingScope,
  now: Date,
): Promise<void> {
  if (scope.area) {
    await tx.areaPage.update({
      where: { areaId_categoryId: { areaId: scope.area.id, categoryId: scope.category.id } },
      data: { contentUpdatedAt: now },
    });
    return;
  }
  await tx.emiratePage.update({
    where: { emirate_categoryId: { emirate: scope.emirate, categoryId: scope.category.id } },
    data: { contentUpdatedAt: now },
  });
}

/**
 * Replace the FAQ for one scope.
 *
 * Whole-list rather than per-row, because `position` is unique per page and
 * moving row 3 to row 1 through individual updates walks through a state where
 * two rows share a position. Deleting and re-inserting inside the transaction
 * is the shape that cannot deadlock against itself, and the rows carry no
 * identity a reader depends on — nothing links to a question.
 */
export async function saveLandingFaq(
  actor: Actor,
  scope: LandingScope,
  rows: readonly FaqInput[],
  reason: string,
  now = new Date(),
): Promise<ContentResult<{ rows: number; scopeSpecific: number }>> {
  if (rows.length > MAX_FAQ_ROWS) {
    return {
      ok: false,
      error: "too_many",
      message: `Board 6a draws four to six questions. ${MAX_FAQ_ROWS} is the ceiling — past that the block is longer than the results above it.`,
    };
  }
  const cleaned = rows
    .map((row) => ({
      question: row.question.trim(),
      answer: row.answer.trim(),
      scopeSpecific: row.scopeSpecific,
      liveToken: row.liveToken?.trim() || null,
    }))
    .filter((row) => row.question !== "" && row.answer !== "");

  if (cleaned.length !== rows.length) {
    return {
      ok: false,
      error: "empty",
      message: "Every row needs a question and an answer. An empty row is a question the page cannot ask.",
    };
  }

  const before = await landingPageRow(scope);
  const areaSlug = scope.area?.slug ?? null;

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: subjectFor(scope, areaSlug),
        reason,
        tx,
      },
      async () => {
        const pageId = await ensurePage(tx, scope);
        await tx.landingFaq.deleteMany({
          where: scope.area ? { areaPageId: pageId } : { emiratePageId: pageId },
        });
        for (const [index, row] of cleaned.entries()) {
          await tx.landingFaq.create({
            data: {
              ...(scope.area ? { areaPageId: pageId } : { emiratePageId: pageId }),
              position: index,
              question: row.question,
              answer: row.answer,
              scopeSpecific: row.scopeSpecific,
              liveToken: row.liveToken,
            },
          });
        }
        await stampContent(tx, scope, now);
        return {
          result: null,
          before: {
            rows: before?.faq.length ?? 0,
            scopeSpecific: (before?.faq ?? []).filter((row) => row.scopeSpecific).length,
          },
          after: {
            rows: cleaned.length,
            scopeSpecific: cleaned.filter((row) => row.scopeSpecific).length,
          },
        };
      },
    ),
  );

  return {
    ok: true,
    rows: cleaned.length,
    scopeSpecific: cleaned.filter((row) => row.scopeSpecific).length,
  };
}

/**
 * Replace the RELATED SEARCHES card.
 *
 * Internal paths only. This card is five anchors on the highest-authority
 * template we own; an external one spends that authority on somebody else, and
 * the failure is silent — nobody notices a link block leaking until the
 * rankings move.
 */
export async function saveRelatedSearches(
  actor: Actor,
  scope: LandingScope,
  rows: readonly RelatedSearchInput[],
  reason: string,
  now = new Date(),
): Promise<ContentResult<{ rows: number }>> {
  if (rows.length > MAX_RELATED_SEARCHES) {
    return {
      ok: false,
      error: "too_many",
      message: `Five, capped. §5 says so, and a sixth link is one the reader does not read.`,
    };
  }

  const cleaned = rows
    .map((row) => ({ label: row.label.trim(), href: row.href.trim() }))
    .filter((row) => row.label !== "" && row.href !== "");
  if (cleaned.length !== rows.length) {
    return {
      ok: false,
      error: "empty",
      message: "Every row needs a label and a path.",
    };
  }
  const external = cleaned.find((row) => !row.href.startsWith("/"));
  if (external) {
    return {
      ok: false,
      error: "external_link",
      message: `"${external.href}" leaves the site. Related searches point at pages of ours — start the path with a slash.`,
    };
  }

  const before = await landingPageRow(scope);
  const areaSlug = scope.area?.slug ?? null;

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: subjectFor(scope, areaSlug),
        reason,
        tx,
      },
      async () => {
        const pageId = await ensurePage(tx, scope);
        await tx.landingRelatedSearch.deleteMany({
          where: scope.area ? { areaPageId: pageId } : { emiratePageId: pageId },
        });
        for (const [index, row] of cleaned.entries()) {
          await tx.landingRelatedSearch.create({
            data: {
              ...(scope.area ? { areaPageId: pageId } : { emiratePageId: pageId }),
              position: index,
              label: row.label,
              href: row.href,
            },
          });
        }
        await stampContent(tx, scope, now);
        return {
          result: null,
          before: { rows: before?.relatedSearches.length ?? 0 },
          after: { rows: cleaned.length },
        };
      },
    ),
  );

  return { ok: true, rows: cleaned.length };
}

/** The one written sentence. Empty clears it and the page falls back to a derived one. */
export async function saveMetaDescription(
  actor: Actor,
  scope: LandingScope,
  text: string,
  reason: string,
  now = new Date(),
): Promise<ContentResult<{ characters: number }>> {
  const trimmed = text.trim();
  if (trimmed.length > META_DESCRIPTION_MAX) {
    return {
      ok: false,
      error: "too_long",
      message: `${trimmed.length} characters. Google shows about 155 and this stops at ${META_DESCRIPTION_MAX} — a sentence that is cut in half in the result is worse than a shorter one.`,
    };
  }

  const before = await landingPageRow(scope);
  const areaSlug = scope.area?.slug ?? null;

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: subjectFor(scope, areaSlug),
        reason,
        tx,
      },
      async () => {
        await ensurePage(tx, scope);
        if (scope.area) {
          await tx.areaPage.update({
            where: {
              areaId_categoryId: { areaId: scope.area.id, categoryId: scope.category.id },
            },
            data: { metaDescription: trimmed || null, contentUpdatedAt: now },
          });
        } else {
          await tx.emiratePage.update({
            where: { emirate_categoryId: { emirate: scope.emirate, categoryId: scope.category.id } },
            data: { metaDescription: trimmed || null, contentUpdatedAt: now },
          });
        }
        return {
          result: null,
          before: { characters: before?.metaDescription?.length ?? 0 },
          after: { characters: trimmed.length },
        };
      },
    ),
  );

  return { ok: true, characters: trimmed.length };
}
