import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { dubaiDayStart } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  DEFAULT_BROWSE_RELEVANCE_MODE,
  DEFAULT_WEIGHTS,
  isBrowseRelevanceMode,
  PLAN_TIER_CEILING,
  WEIGHT_KEYS,
  WEIGHT_TOTAL,
  weightsForBrowse,
  weightsTotal,
  type BrowseRelevanceMode,
  type RankingWeights,
} from "./ranking";
import type { ImpactPreview } from "./impact";

/**
 * Board 12c — the ranking, as something staff can change and then publish.
 *
 * ## Why there is a draft
 *
 * There was not one. `saveWeights` wrote straight to `RankingWeights:current`
 * and the copy said so — *"Saved. Search results reorder on the next request."*
 * A staff member had no way to look at a change before every buyer did, and the
 * spec's *"can weights change without firing the disclosure?"* was therefore not
 * a flag to add but four pieces of work: split save from publish, put an impact
 * preview between them, refuse to publish on a stale or running preview, and
 * fire the seller disclosure from the publish and from nothing else.
 *
 * ## What fires the disclosure
 *
 * Nothing here sends a message. The position amendment shipped first, in PR 146,
 * and state 09 — *"We changed how search results are ordered on 9 Sep"* — is
 * derived by `lib/analytics/attribution.ts` from the weights stored on each
 * night's `ListingFactorDay`. So the disclosure is fired by the live vector
 * moving, which is exactly what a publish does and exactly what saving a draft
 * does not. Criterion 5 is structural rather than a notification, which is the
 * stronger version of it: there is no code path that could send the sentence
 * without the ranking having actually changed.
 *
 * What the publish adds is the *claim*: the seller count that labelled the
 * button is written to the history row, so what an ops lead was told they were
 * about to do is recoverable afterwards.
 */

// Re-exported so server callers have one import. The values live in
// `ranking.ts`, which is pure — the editor is a client component and cannot
// reach anything that touches Prisma.
export {
  BROWSE_RELEVANCE_MODES,
  MAX_BOOST_DAYS,
  MAX_BOOST_POINTS,
  PLAN_TIER_CEILING,
  WEIGHT_KEYS,
  WEIGHT_TOTAL,
  type BrowseRelevanceMode,
} from "./ranking";

/**
 * The live weights.
 *
 * Falls back to the constant if the row is missing rather than throwing: a
 * search that returns nothing because a settings row was deleted is a worse
 * outcome than one ranked by the defaults.
 */
export async function liveWeights(): Promise<RankingWeights> {
  const row = await prisma.rankingWeights.findUnique({ where: { id: "current" } });
  if (!row) return DEFAULT_WEIGHTS;
  return {
    relevance: row.relevance,
    verificationTier: row.verificationTier,
    responseTime: row.responseTime,
    specCompleteness: row.specCompleteness,
    distance: row.distance,
    planTier: row.planTier,
  };
}

/**
 * The named mode for a page with no query — board 6a §Ranking.
 *
 * Read separately from the weights because the callers differ: every search
 * reads the weights and only the landing templates read this. Falls back to the
 * default on a missing row or an unrecognised string, for the reason
 * `liveWeights` falls back — a landing page ranked by the recommendation is a
 * better outcome than one that throws because a settings row is missing or
 * because somebody wrote a mode into the column by hand.
 */
export async function liveBrowseRelevanceMode(): Promise<BrowseRelevanceMode> {
  const row = await prisma.rankingWeights.findUnique({
    where: { id: "current" },
    select: { browseRelevanceMode: true },
  });
  if (!row || !isBrowseRelevanceMode(row.browseRelevanceMode)) {
    return DEFAULT_BROWSE_RELEVANCE_MODE;
  }
  return row.browseRelevanceMode;
}

export type WeightsRefusal =
  | "out_of_range"
  | "total_not_100"
  | "plan_tier_too_high"
  | "browse_plan_tier_too_high"
  | "unknown_browse_mode"
  | "nothing_changed";

export type WeightsResult =
  | { ok: true }
  | { ok: false; error: WeightsRefusal; message: string };

function refusal(error: WeightsRefusal, params?: Record<string, string | number>): WeightsResult {
  return { ok: false, error, message: t(`ranking.refuse.${error}` as never, params) };
}

/**
 * Everything a vector must be true of before it can be a draft or go live.
 *
 * Pure, and checked on save as well as on publish. A draft that cannot be
 * published is a trap: the refusal belongs where the number was typed.
 */
export function validateWeights(next: RankingWeights, browseMode: string): WeightsResult {
  for (const key of WEIGHT_KEYS) {
    const value = next[key];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      return refusal("out_of_range");
    }
  }

  const total = weightsTotal(next);
  if (total !== WEIGHT_TOTAL) {
    return refusal("total_not_100", { total, expected: WEIGHT_TOTAL });
  }

  if (next.planTier > PLAN_TIER_CEILING) {
    return refusal("plan_tier_too_high", { ceiling: PLAN_TIER_CEILING });
  }

  if (!isBrowseRelevanceMode(browseMode)) {
    return refusal("unknown_browse_mode");
  }

  /*
     `B9`, and the one thing this pass found by drawing a control that was
     already on the screen.

     `redistribute` spreads relevance's points across the other five in
     proportion, which lifts plan tier's *effective* weight on every area and
     emirate landing page — the highest-traffic template in the product. The
     ceiling was checked against the authored number, so at relevance 50 the
     effective plan weight is 12 and the cap is breached by moving a slider that
     has nothing to do with plan, on a screen reporting plan tier as 6 the whole
     time.

     The refusal names relevance rather than plan, because relevance is what the
     staff member moved and plan is where it landed. Telling somebody their plan
     weight is too high when they did not touch it is a refusal they cannot act
     on.
  */
  const browse = weightsForBrowse(next, browseMode);
  if (browse.planTier > PLAN_TIER_CEILING) {
    return refusal("browse_plan_tier_too_high", {
      ceiling: PLAN_TIER_CEILING,
      effective: browse.planTier,
      authored: next.planTier,
    });
  }

  return { ok: true };
}

function vectorOf(row: {
  relevance: number;
  verificationTier: number;
  responseTime: number;
  specCompleteness: number;
  distance: number;
  planTier: number;
}): RankingWeights {
  return {
    relevance: row.relevance,
    verificationTier: row.verificationTier,
    responseTime: row.responseTime,
    specCompleteness: row.specCompleteness,
    distance: row.distance,
    planTier: row.planTier,
  };
}

function sameVector(a: RankingWeights, b: RankingWeights): boolean {
  return WEIGHT_KEYS.every((key) => a[key] === b[key]);
}

/**
 * What step 2 of the publish strip says.
 *
 * `stale` is a comparison and not a timer: the preview stores the exact vector
 * it describes, and the draft moving past it is the only thing that can make it
 * stale. A timestamp would have made criterion 7 a race between two clocks.
 */
export type PreviewState = "none" | "running" | "stale" | "fresh";

export interface DraftView {
  weights: RankingWeights;
  browseMode: BrowseRelevanceMode;
  savedAt: Date;
  savedBy: string;
  previewState: PreviewState;
  previewRanAt: Date | null;
  /** Null unless the state is `fresh` — a stale preview is not shown as a result. */
  preview: ImpactPreview | null;
}

function previewStateOf(row: {
  weights: RankingWeights;
  browseMode: string;
  previewStartedAt: Date | null;
  previewRanAt: Date | null;
  previewFor: unknown;
}): PreviewState {
  if (row.previewStartedAt && !row.previewRanAt) return "running";
  if (!row.previewRanAt || !row.previewFor) return "none";

  const against = row.previewFor as Partial<RankingWeights> & { browseRelevanceMode?: string };
  const sameWeights = WEIGHT_KEYS.every((key) => against[key] === row.weights[key]);
  const sameMode = against.browseRelevanceMode === row.browseMode;
  return sameWeights && sameMode ? "fresh" : "stale";
}

export async function draftState(): Promise<DraftView | null> {
  const row = await prisma.rankingDraft.findUnique({
    where: { id: "current" },
    include: { savedBy: { select: { fullName: true, email: true } } },
  });
  if (!row) return null;

  const weights = vectorOf(row);
  const state = previewStateOf({
    weights,
    browseMode: row.browseRelevanceMode,
    previewStartedAt: row.previewStartedAt,
    previewRanAt: row.previewRanAt,
    previewFor: row.previewFor,
  });

  return {
    weights,
    browseMode: isBrowseRelevanceMode(row.browseRelevanceMode)
      ? row.browseRelevanceMode
      : DEFAULT_BROWSE_RELEVANCE_MODE,
    savedAt: row.savedAt,
    savedBy: row.savedBy.fullName ?? row.savedBy.email ?? "",
    previewState: state,
    previewRanAt: row.previewRanAt,
    preview: state === "fresh" ? (row.preview as unknown as ImpactPreview) : null,
  };
}

/**
 * Save the draft. Search is unchanged until somebody publishes it.
 *
 * Audited like every other staff state change, with a written reason: a draft
 * is a decision somebody made, and the fact that it is not live yet does not
 * make it nobody's.
 */
export async function saveDraft(
  actor: Actor,
  next: RankingWeights,
  browseMode: string,
  reason: string,
): Promise<WeightsResult> {
  const valid = validateWeights(next, browseMode);
  if (!valid.ok) return valid;

  const [live, liveMode, existing] = await Promise.all([
    liveWeights(),
    liveBrowseRelevanceMode(),
    prisma.rankingDraft.findUnique({ where: { id: "current" } }),
  ]);

  const currentDraft = existing ? vectorOf(existing) : null;
  const currentMode = existing?.browseRelevanceMode ?? liveMode;
  if (currentDraft && sameVector(currentDraft, next) && currentMode === browseMode) {
    return refusal("nothing_changed");
  }
  if (!currentDraft && sameVector(live, next) && liveMode === browseMode) {
    return refusal("nothing_changed");
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "search.ranking.write",
        subject: "RankingDraft:current",
        reason,
        tx,
      },
      async () => {
        await tx.rankingDraft.upsert({
          where: { id: "current" },
          create: {
            id: "current",
            ...next,
            browseRelevanceMode: browseMode,
            savedById: actor.id,
          },
          update: {
            ...next,
            browseRelevanceMode: browseMode,
            savedById: actor.id,
            savedAt: new Date(),
            /*
               The preview describes the draft it was run against, and the draft
               has just moved. Clearing the run marks it stale rather than
               deleting it, because `previewFor` is what proves the staleness and
               the board says so out loud on step 2.
            */
            previewStartedAt: null,
          },
        });
        return {
          result: null,
          before: currentDraft
            ? { ...currentDraft, browseRelevanceMode: currentMode }
            : { ...live, browseRelevanceMode: liveMode },
          after: { ...next, browseRelevanceMode: browseMode },
        };
      },
    ),
  );

  return { ok: true };
}

/**
 * Throw the draft away.
 *
 * On the board beside publish, because a draft that cannot be abandoned is a
 * draft nobody will risk making.
 */
export async function discardDraft(actor: Actor, reason: string): Promise<WeightsResult> {
  const existing = await prisma.rankingDraft.findUnique({ where: { id: "current" } });
  if (!existing) return refusal("nothing_changed");

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "search.ranking.write",
        subject: "RankingDraft:current",
        reason,
        tx,
      },
      async () => {
        await tx.rankingDraft.delete({ where: { id: "current" } });
        return {
          result: null,
          before: { ...vectorOf(existing), browseRelevanceMode: existing.browseRelevanceMode },
          after: null,
        };
      },
    ),
  );

  return { ok: true };
}

/** Record that a preview run has started, so step 2 can say `running`. */
export async function markPreviewRunning(): Promise<void> {
  await prisma.rankingDraft.update({
    where: { id: "current" },
    data: { previewStartedAt: new Date(), previewRanAt: null },
  });
}

/**
 * Clear a run marker after a failed preview.
 *
 * A run that threw must not leave the board reading `running` for ever. The
 * draft is untouched, so this returns the state to `stale` or `none`, which is
 * what it truthfully is. Swallows a missing row: a draft discarded while its
 * preview was running is not an error to report to anybody.
 */
export async function clearPreviewRun(): Promise<void> {
  await prisma.rankingDraft
    .update({ where: { id: "current" }, data: { previewStartedAt: null } })
    .catch(() => undefined);
}

/**
 * Store a finished preview against the exact draft it describes.
 *
 * The vector is written with the result rather than read back later: between
 * the run starting and the row being written the draft may have moved, and a
 * preview filed against the newer vector would claim to describe a draft it had
 * never seen.
 */
export async function storePreview(
  against: RankingWeights,
  browseMode: BrowseRelevanceMode,
  preview: ImpactPreview,
): Promise<void> {
  await prisma.rankingDraft.update({
    where: { id: "current" },
    data: {
      previewStartedAt: null,
      previewRanAt: new Date(),
      previewFor: { ...against, browseRelevanceMode: browseMode },
      preview: preview as unknown as object,
    },
  });
}

export type PublishRefusal =
  | "no_draft"
  | "preview_missing"
  | "preview_running"
  | "preview_stale"
  | WeightsRefusal;

export type PublishResult =
  | { ok: true; sellersTold: number }
  | { ok: false; error: PublishRefusal; message: string };

/**
 * Promote the draft to live, and record what it was claimed to do.
 *
 * The order inside the transaction matters only in that all four happen or none
 * do: the live row moves, the history row is written, the draft is cleared, and
 * `staffMutation` files the audit row with the written reason.
 *
 * Publishing on a stale or running preview is refused rather than warned about.
 * A count from a superseded draft is worse than no count, because it is the only
 * thing standing between a staff member and several hundred dashboards.
 */
export async function publishDraft(
  actor: Actor,
  reason: string,
  now = new Date(),
): Promise<PublishResult> {
  const draft = await draftState();
  if (!draft) return { ok: false, error: "no_draft", message: t("ranking.refuse.no_draft") };

  if (draft.previewState === "running") {
    return { ok: false, error: "preview_running", message: t("ranking.refuse.preview_running") };
  }
  if (draft.previewState === "stale") {
    return { ok: false, error: "preview_stale", message: t("ranking.refuse.preview_stale") };
  }
  if (draft.previewState === "none" || !draft.preview) {
    return { ok: false, error: "preview_missing", message: t("ranking.refuse.preview_missing") };
  }

  const valid = validateWeights(draft.weights, draft.browseMode);
  if (!valid.ok) return { ok: false, error: valid.error, message: valid.message };

  const [live, liveMode] = await Promise.all([liveWeights(), liveBrowseRelevanceMode()]);
  if (sameVector(live, draft.weights) && liveMode === draft.browseMode) {
    return {
      ok: false,
      error: "nothing_changed",
      message: t("ranking.refuse.nothing_changed"),
    };
  }

  const preview = draft.preview;

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "search.ranking.write",
        subject: "RankingWeights:current",
        reason,
        tx,
      },
      async () => {
        await tx.rankingWeights.upsert({
          where: { id: "current" },
          create: {
            id: "current",
            ...draft.weights,
            browseRelevanceMode: draft.browseMode,
          },
          update: { ...draft.weights, browseRelevanceMode: draft.browseMode },
        });

        await tx.rankingPublish.create({
          data: {
            day: dubaiDayStart(now),
            publishedAt: now,
            ...draft.weights,
            browseRelevanceMode: draft.browseMode,
            reason,
            categoriesMoved: preview.categoriesMoved,
            listingsMoved: preview.listingsMoved,
            sellersTold: preview.sellersTold,
            publishedById: actor.id,
          },
        });

        await tx.rankingDraft.delete({ where: { id: "current" } });

        return {
          result: null,
          before: { ...live, browseRelevanceMode: liveMode },
          after: { ...draft.weights, browseRelevanceMode: draft.browseMode },
        };
      },
    ),
  );

  return { ok: true, sellersTold: preview.sellersTold };
}

export interface PublishRecord {
  id: string;
  publishedAt: Date;
  weights: RankingWeights;
  browseMode: string;
  reason: string;
  author: string;
  categoriesMoved: number | null;
  listingsMoved: number | null;
  sellersTold: number | null;
  /** What each weight was on the publish before this one. Null on the first. */
  moved: Partial<Record<keyof RankingWeights | "browseRelevanceMode", string>> | null;
}

/**
 * The Weight history tab.
 *
 * Each row carries what moved relative to the publish before it, computed here
 * rather than stored: a stored diff and a stored vector are two facts that can
 * disagree, and only one of them is the thing that went live.
 */
export async function publishHistory(take = 50): Promise<PublishRecord[]> {
  const rows = await prisma.rankingPublish.findMany({
    orderBy: { publishedAt: "desc" },
    take: take + 1,
    include: { publishedBy: { select: { fullName: true, email: true } } },
  });

  return rows.slice(0, take).map((row, index) => {
    const previous = rows[index + 1];
    const weights = vectorOf(row);
    const moved: Record<string, string> = {};

    if (previous) {
      for (const key of WEIGHT_KEYS) {
        if (previous[key] !== weights[key]) moved[key] = `${previous[key]} → ${weights[key]}`;
      }
      if (previous.browseRelevanceMode !== row.browseRelevanceMode) {
        moved["browseRelevanceMode"] =
          `${t(`ranking.browse.${previous.browseRelevanceMode}` as never)} → ${t(`ranking.browse.${row.browseRelevanceMode}` as never)}`;
      }
    }

    return {
      id: row.id,
      publishedAt: row.publishedAt,
      weights,
      browseMode: row.browseRelevanceMode,
      reason: row.reason,
      author: row.publishedBy.fullName ?? row.publishedBy.email ?? "",
      categoriesMoved: row.categoriesMoved,
      listingsMoved: row.listingsMoved,
      sellersTold: row.sellersTold,
      moved: previous ? moved : null,
    };
  });
}
