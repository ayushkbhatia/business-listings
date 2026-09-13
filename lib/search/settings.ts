import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { dubaiDayStart } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getTradeKinds } from "@/lib/taxonomy/service";
import { resolveTradeKind } from "@/lib/taxonomy/trade-kind";
import {
  appliedVector,
  DEFAULT_BROWSE_RELEVANCE_MODE,
  DEFAULT_WEIGHTS,
  isBrowseRelevanceMode,
  PLAN_TIER_CEILING,
  planTierAgrees,
  RANKING_KINDS,
  unwiredSlots,
  WEIGHT_KEYS,
  WEIGHT_TOTAL,
  weightsForBrowse,
  weightsTotal,
  type BrowseRelevanceMode,
  type RankingKind,
  type RankingWeights,
  type VectorSet,
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
 *
 * ## Two vectors, one of everything else — board `12c-s`
 *
 * Every function that reads or writes a weight takes the kind, and none has a
 * default for it. That is the amendment's fourth item — *"anything that reads
 * or writes a weight needs the key"* — made into something the compiler checks
 * rather than something a reviewer remembers. The draft, the preview, the
 * three-step publish and the history are the same code for both; what they act
 * on is keyed.
 *
 * **The services vector may be unpublished**, and on the day this ships it is.
 * `publishedWeights("services")` is then null, and every reader that asks what
 * a services listing *ranks on* is told the goods vector — because that is true
 * until somebody presses publish.
 */

// Re-exported so server callers have one import. The values live in
// `ranking.ts`, which is pure — the editor is a client component and cannot
// reach anything that touches Prisma.
export {
  BROWSE_RELEVANCE_MODES,
  MAX_BOOST_DAYS,
  MAX_BOOST_POINTS,
  PLAN_TIER_CEILING,
  RANKING_KINDS,
  WEIGHT_KEYS,
  WEIGHT_TOTAL,
  type BrowseRelevanceMode,
  type RankingKind,
} from "./ranking";

/**
 * The legacy primary key each kind's rows are pinned to.
 *
 * `current` for goods, because that is the only row the code before `12c-s`
 * ever read, and the migration has to apply ahead of the deploy with that code
 * still serving. The database pins the pair with a check constraint; this is the
 * same pair, written once, for the writers.
 */
export function rowIdFor(kind: RankingKind): string {
  return kind === "goods" ? "current" : "services";
}

const VECTOR_SELECT = {
  kind: true,
  relevance: true,
  verificationTier: true,
  responseTime: true,
  specCompleteness: true,
  distance: true,
  planTier: true,
  browseRelevanceMode: true,
} as const;

/** Both published vectors and their browse modes, from one read. */
export interface LiveVectors extends VectorSet {
  /** Null for a vector nobody has published. */
  modes: Record<RankingKind, BrowseRelevanceMode | null>;
}

/**
 * Everything live, in one query.
 *
 * The goods vector falls back to the constant if its row is missing rather than
 * throwing: a search that returns nothing because a settings row was deleted is a
 * worse outcome than one ranked by the defaults. The services vector does not
 * fall back — a missing services row is a real state, *not published*, and
 * inventing one would rank half the directory on a vector nobody chose.
 *
 * An unrecognised browse mode falls back to the default, because a landing page
 * ranked by the recommendation is a better outcome than one that throws because
 * somebody wrote a mode into the column by hand.
 */
export async function liveVectors(): Promise<LiveVectors> {
  const rows = await prisma.rankingWeights.findMany({ select: VECTOR_SELECT });
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  const goods = byKind.get("goods");
  const services = byKind.get("services");

  const modeOf = (row: { browseRelevanceMode: string } | undefined) =>
    !row
      ? null
      : isBrowseRelevanceMode(row.browseRelevanceMode)
        ? row.browseRelevanceMode
        : DEFAULT_BROWSE_RELEVANCE_MODE;

  return {
    goods: goods ? vectorOf(goods) : DEFAULT_WEIGHTS,
    services: services ? vectorOf(services) : null,
    modes: {
      goods: modeOf(goods) ?? DEFAULT_BROWSE_RELEVANCE_MODE,
      services: modeOf(services),
    },
  };
}

/** The vector staff published for this kind, or null where nobody has. */
export async function publishedWeights(kind: RankingKind): Promise<RankingWeights | null> {
  const live = await liveVectors();
  return kind === "goods" ? live.goods : live.services;
}

/**
 * The weights a listing of this kind actually ranks on.
 *
 * For goods, the goods vector. For services, the services vector once one is
 * published and the goods vector until then — `12c-s` §States, *"the goods
 * vector serves everything; services rank on it"*. A
 * seller's screen that stated the services weights before they applied would
 * describe a ranking the seller is not subject to.
 */
export async function liveWeights(kind: RankingKind): Promise<RankingWeights> {
  const live = await liveVectors();
  return kind === "services" && live.services ? live.services : live.goods;
}

/**
 * The vector one seller's listing ranks on, and its weights.
 *
 * For the seller's own screens — the setup card that draws the six factors, the
 * team page that says what reply time is worth. Resolved from the primary
 * category, because those screens speak about the listing as a whole and the
 * primary trade is the one a listing has outside a category page; on a category
 * page it is the page's category that decides (`12c-s` B11), and those screens
 * do not render one.
 *
 * `vector` rather than `kind`: a services firm ranks on the goods vector until
 * a services vector is published, and a card labelled *scope completeness* over
 * a ranking that still scores spec completeness would describe a ranking the
 * seller is not subject to.
 */
export async function vectorForBusiness(
  businessId: string,
): Promise<{ vector: RankingKind; weights: RankingWeights }> {
  const [business, kinds, live] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { primaryCategoryId: true } }),
    getTradeKinds(),
    liveVectors(),
  ]);
  const kind = business ? resolveTradeKind(kinds, business.primaryCategoryId) : "goods";
  const vector = appliedVector(kind, live.services !== null);
  return { vector, weights: vector === "services" && live.services ? live.services : live.goods };
}

/**
 * The named mode for a page with no query — board 6a §Ranking — for the vector
 * a listing of this kind ranks on.
 *
 * Read with the weights rather than beside them: `12c-s` says browse mode is not
 * a goods-only control, because a services area page carries no query either.
 */
export async function liveBrowseRelevanceMode(kind: RankingKind): Promise<BrowseRelevanceMode> {
  const live = await liveVectors();
  return kind === "services" && live.services
    ? (live.modes.services ?? DEFAULT_BROWSE_RELEVANCE_MODE)
    : live.modes.goods ?? DEFAULT_BROWSE_RELEVANCE_MODE;
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
 *
 * **The same five rules on both vectors** — `12c-s` B10. The services vector is
 * not the place a second convention appears, in either direction: no rule is
 * relaxed for it and none is added. The handoff says `setWeights` has no
 * total-100 rule and asks that none be added; it has had one since `12c`'s
 * second pass (criterion 2, and the argument is on `WEIGHT_TOTAL`), so what
 * holds identically for both kinds is that rule rather than its absence.
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

     `12c-s` B6: this holds for both vectors, and it does because both come
     through here. The services vector lands 1.4 points short of the cap at its
     proposed numbers, which is luck rather than safety — at relevance 50 it
     breaches exactly as the goods vector does.
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
  kind: RankingKind;
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

export async function draftState(kind: RankingKind): Promise<DraftView | null> {
  const row = await prisma.rankingDraft.findUnique({
    where: { kind },
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
    kind,
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

/** The other vector. There are two. */
export function otherKind(kind: RankingKind): RankingKind {
  return kind === "goods" ? "services" : "goods";
}

/**
 * The plan tier the other vector has live and in draft — what `planTierAgrees`
 * checks against, and what the editor states beside the plan slider.
 */
export async function otherPlanTier(
  kind: RankingKind,
): Promise<{ kind: RankingKind; live: number | null; draft: number | null }> {
  const other = otherKind(kind);
  const [live, draft] = await Promise.all([
    publishedWeights(other),
    prisma.rankingDraft.findUnique({ where: { kind: other }, select: { planTier: true } }),
  ]);
  return { kind: other, live: live?.planTier ?? null, draft: draft?.planTier ?? null };
}

/**
 * Save the draft. Search is unchanged until somebody publishes it.
 *
 * Audited like every other staff state change, with a written reason: a draft
 * is a decision somebody made, and the fact that it is not live yet does not
 * make it nobody's.
 *
 * **A plan tier that disagrees with the other vector saves.** It is refused at
 * publish instead, which departs from this file's own rule that a refusal
 * belongs where the number was typed — because a rule about a *pair* refused at
 * save deadlocks: neither vector could ever take the first step to a new plan
 * weight. The editor says so beside the slider before the save.
 */
export async function saveDraft(
  actor: Actor,
  kind: RankingKind,
  next: RankingWeights,
  browseMode: string,
  reason: string,
): Promise<WeightsResult> {
  const valid = validateWeights(next, browseMode);
  if (!valid.ok) return valid;

  const [live, existing] = await Promise.all([
    liveVectors(),
    prisma.rankingDraft.findUnique({ where: { kind } }),
  ]);
  const published = kind === "goods" ? live.goods : live.services;
  const publishedMode = live.modes[kind];

  const currentDraft = existing ? vectorOf(existing) : null;
  const currentMode = existing?.browseRelevanceMode ?? publishedMode;
  if (currentDraft && sameVector(currentDraft, next) && currentMode === browseMode) {
    return refusal("nothing_changed");
  }
  /*
     Against the published vector, where there is one. A services vector nobody
     has published has nothing to be unchanged from: saving the board's own
     proposal as a first draft is a decision, not a no-op.
  */
  if (!currentDraft && published && sameVector(published, next) && publishedMode === browseMode) {
    return refusal("nothing_changed");
  }

  const id = rowIdFor(kind);
  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "search.ranking.write",
        subject: `RankingDraft:${kind}`,
        reason,
        tx,
      },
      async () => {
        await tx.rankingDraft.upsert({
          where: { kind },
          create: {
            id,
            kind,
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
            ? { kind, ...currentDraft, browseRelevanceMode: currentMode }
            : published
              ? { kind, ...published, browseRelevanceMode: publishedMode }
              : null,
          after: { kind, ...next, browseRelevanceMode: browseMode },
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
export async function discardDraft(
  actor: Actor,
  kind: RankingKind,
  reason: string,
): Promise<WeightsResult> {
  const existing = await prisma.rankingDraft.findUnique({ where: { kind } });
  if (!existing) return refusal("nothing_changed");

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "search.ranking.write",
        subject: `RankingDraft:${kind}`,
        reason,
        tx,
      },
      async () => {
        await tx.rankingDraft.delete({ where: { kind } });
        return {
          result: null,
          before: { kind, ...vectorOf(existing), browseRelevanceMode: existing.browseRelevanceMode },
          after: null,
        };
      },
    ),
  );

  return { ok: true };
}

/** Record that a preview run has started, so step 2 can say `running`. */
export async function markPreviewRunning(kind: RankingKind): Promise<void> {
  await prisma.rankingDraft.update({
    where: { kind },
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
export async function clearPreviewRun(kind: RankingKind): Promise<void> {
  await prisma.rankingDraft
    .update({ where: { kind }, data: { previewStartedAt: null } })
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
  kind: RankingKind,
  against: RankingWeights,
  browseMode: BrowseRelevanceMode,
  preview: ImpactPreview,
): Promise<void> {
  await prisma.rankingDraft.update({
    where: { kind },
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
  | "not_wired"
  | "plan_tier_diverges"
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
 *
 * `12c-s` B8: every write is keyed by `kind`, so publishing one vector cannot
 * touch the other's live row, its draft or its history.
 */
export async function publishDraft(
  actor: Actor,
  kind: RankingKind,
  reason: string,
  now = new Date(),
): Promise<PublishResult> {
  const draft = await draftState(kind);
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

  /*
     `12c-s` B2 and criterion 3 — refused, never warned. Publishing a services
     vector whose completeness slot still reads spec completeness re-inflicts
     the twelve-point zero under a new name, and nothing on the board would show
     it: every number would look right.
  */
  const unwired = unwiredSlots(kind);
  if (unwired.length > 0) {
    return {
      ok: false,
      error: "not_wired",
      message: t("ranking.refuse.not_wired", {
        // Lowercase, because they sit mid-sentence: the seller-facing names.
        slots: unwired.map((key) => t(`factors.${key}`)).join(", "),
      }),
    };
  }

  const other = await otherPlanTier(kind);
  if (!planTierAgrees(draft.weights.planTier, other)) {
    return {
      ok: false,
      error: "plan_tier_diverges",
      message: t("ranking.refuse.plan_tier_diverges", {
        planTier: draft.weights.planTier,
        other: t(`ranking.vector_inline.${other.kind}` as never),
        otherPlanTier: other.live ?? other.draft ?? 0,
      }),
    };
  }

  const live = await liveVectors();
  const published = kind === "goods" ? live.goods : live.services;
  if (published && sameVector(published, draft.weights) && live.modes[kind] === draft.browseMode) {
    return {
      ok: false,
      error: "nothing_changed",
      message: t("ranking.refuse.nothing_changed"),
    };
  }

  const preview = draft.preview;
  const id = rowIdFor(kind);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "search.ranking.write",
        subject: `RankingWeights:${kind}`,
        reason,
        tx,
      },
      async () => {
        await tx.rankingWeights.upsert({
          where: { kind },
          create: {
            id,
            kind,
            ...draft.weights,
            browseRelevanceMode: draft.browseMode,
          },
          update: { ...draft.weights, browseRelevanceMode: draft.browseMode },
        });

        await tx.rankingPublish.create({
          data: {
            kind,
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

        await tx.rankingDraft.delete({ where: { kind } });

        return {
          result: null,
          before: published
            ? { kind, ...published, browseRelevanceMode: live.modes[kind] }
            : null,
          after: { kind, ...draft.weights, browseRelevanceMode: draft.browseMode },
        };
      },
    ),
  );

  return { ok: true, sellersTold: preview.sellersTold };
}

export interface PublishRecord {
  id: string;
  kind: RankingKind;
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
 * The Weight history tab, for one vector.
 *
 * Each row carries what moved relative to the publish before it **of the same
 * kind**, computed here rather than stored: a stored diff and a stored vector
 * are two facts that can disagree, and only one of them is the thing that went
 * live. Diffing across kinds would report a services publish as having moved
 * relevance from 34 to 30 on a vector whose relevance nobody touched.
 */
export async function publishHistory(kind: RankingKind, take = 50): Promise<PublishRecord[]> {
  const rows = await prisma.rankingPublish.findMany({
    where: { kind },
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
      kind,
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

/** How many publishes each vector has, for the history tab's toggle. */
export async function publishCounts(): Promise<Record<RankingKind, number>> {
  const rows = await prisma.rankingPublish.groupBy({ by: ["kind"], _count: { _all: true } });
  const counts = Object.fromEntries(RANKING_KINDS.map((kind) => [kind, 0])) as Record<
    RankingKind,
    number
  >;
  for (const row of rows) counts[row.kind] = row._count._all;
  return counts;
}
