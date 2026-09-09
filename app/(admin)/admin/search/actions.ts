"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { boostListing } from "@/lib/search/boosts";
import { runImpact } from "@/lib/search/impact";
import {
  discardDraft,
  draftState,
  liveBrowseRelevanceMode,
  liveWeights,
  clearPreviewRun,
  markPreviewRunning,
  publishDraft,
  saveDraft,
  storePreview,
} from "@/lib/search/settings";
import { RANKING_CACHE_TAG } from "@/lib/db/queries/pricing";
import { WEIGHT_KEYS } from "@/lib/search/ranking";
import type { Emirate } from "@/lib/db/generated/client";
import type { RankingWeights } from "@/lib/search/ranking";
import { t } from "@/lib/i18n";

/**
 * Board 12c's mutations. Four on the weights, one on the boosts.
 *
 * The weights are three steps rather than one because a save and a publish are
 * different acts with different consequences: a draft changes nothing a buyer
 * sees, and a publish reorders every result on the platform and puts a sentence
 * on several hundred seller dashboards. A single control that did both was the
 * defect this pass exists to fix.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("ranking.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

/**
 * What a publish has to clear so the platform agrees with itself.
 *
 * Search is cached, the landing pages cache for five minutes and rank on the
 * same weights through the browse mode, and `/pricing` states the plan weight's
 * share of the ranking through a tagged cache. Miss any of them and the results
 * reorder while a page goes on quoting the share the weights used to have.
 */
function revalidateRanking(): void {
  revalidatePath("/admin/search");
  revalidatePath("/search");
  /*
     `layout` because the two landing classes are a few hundred URLs under one
     dynamic segment and there is no list of them to walk here — `livePages()`
     has one, but calling it from a mutation to revalidate three hundred paths
     is a fan-out on a screen somebody uses twice a year.
  */
  revalidatePath("/[emirate]/[area]", "layout");
  revalidateTag(RANKING_CACHE_TAG, { expire: 0 });
}

function weightsFrom(formData: FormData): RankingWeights {
  return Object.fromEntries(
    WEIGHT_KEYS.map((key) => [key, Number(formData.get(key) ?? 0)]),
  ) as unknown as RankingWeights;
}

/** Save the draft. Nothing a buyer sees moves until it is published. */
export async function saveDraftWeights(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await saveDraft(
      seat.actor,
      weightsFrom(formData),
      /*
         Board 6a §Ranking. The landing pages have no query, so the relevance
         weight has nothing to score against; this is the named mode that says
         what happens to its points, and it lives on the same audited row as the
         weights themselves so that whoever moves a slider can see it.
      */
      String(formData.get("browseRelevanceMode") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    // Only the board. A draft changes no ranking, so clearing the search and
    // pricing caches here would be work done for a change nobody can see.
    revalidatePath("/admin/search");
    return { ok: true, message: t("ranking.draft_saved") };
  } catch (error) {
    return refused(error);
  }
}

export async function discardDraftWeights(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await discardDraft(seat.actor, String(formData.get("reason") ?? ""));
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/search");
    return { ok: true, message: t("ranking.discarded") };
  } catch (error) {
    return refused(error);
  }
}

/**
 * Rank the directory twice and store the difference.
 *
 * `markPreviewRunning` first, so the board can say `running` rather than
 * appearing to have no preview while one is being computed — and so a publish
 * attempted mid-run is refused for the right reason.
 *
 * The vector is read from the draft and passed to `storePreview` rather than
 * re-read afterwards: between the run starting and the row being written the
 * draft may have moved, and a preview filed against the newer vector would
 * claim to describe a draft it never saw.
 */
export async function runPreview(): Promise<ActionResult> {
  await requireStaff();
  try {
    const draft = await draftState();
    if (!draft) return { ok: false, error: t("ranking.refuse.no_draft") };

    await markPreviewRunning();

    const [live, liveMode] = await Promise.all([liveWeights(), liveBrowseRelevanceMode()]);
    const preview = await runImpact({
      draft: draft.weights,
      draftMode: draft.browseMode,
      live,
      liveMode,
    });

    await storePreview(draft.weights, draft.browseMode, preview);
    revalidatePath("/admin/search");

    return {
      ok: true,
      message: t("ranking.preview_ran", {
        categories: t("ranking.count.categories", { count: preview.categoriesMoved }),
        listings: t("ranking.count.listings", { count: preview.listingsMoved }),
      }),
    };
  } catch (error) {
    // A failed run must not leave the board reading `running` for ever. The
    // draft is untouched, so clearing the marker returns it to `stale` or
    // `none`, which is what it truthfully is.
    await clearPreviewRun();
    revalidatePath("/admin/search");
    return refused(error);
  }
}

/** Promote the draft. This is the one that reorders the platform. */
export async function publishWeights(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await publishDraft(seat.actor, String(formData.get("reason") ?? ""));
    if (!result.ok) return { ok: false, error: result.message };

    revalidateRanking();
    return {
      ok: true,
      message: t("ranking.published", {
        count: t("ranking.count.sellers", { count: result.sellersTold }),
      }),
    };
  } catch (error) {
    return refused(error);
  }
}

export async function addBoost(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const emirate = String(formData.get("emirate") ?? "");

  try {
    const result = await boostListing({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? "") || null,
      categoryId: String(formData.get("categoryId") ?? "") || null,
      emirate: emirate ? (emirate as Emirate) : null,
      points: Number(formData.get("points") ?? 0),
      reason: String(formData.get("reason") ?? ""),
      expiresAt: new Date(String(formData.get("expiresAt") ?? "")),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/search");
    revalidatePath("/search");
    return { ok: true, message: t("ranking.boosted") };
  } catch (error) {
    return refused(error);
  }
}
