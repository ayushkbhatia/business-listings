"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { HOME_CACHE_TAG } from "@/lib/db/queries/home";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import {
  MAX_TIER,
  MIN_TIER,
  setVerificationTier,
  type TierResult,
} from "@/lib/verification/service";
import {
  liftSuspension,
  suspendBusiness,
  type LiftResult,
  type SuspendResult,
} from "@/lib/business/service";
import { EXPIRED_LICENCE_TIER } from "@/lib/verification";
import {
  giveLicenceLapseNotice,
  reopenClosedBusiness,
  withdrawClosure,
} from "@/lib/closure/service";
import { revalidateClosure } from "@/lib/closure/revalidate";
import { deleteSegment, saveSegment } from "@/lib/accounts/segments";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4f — the account decisions, and the saved segments.
 *
 * All three services were written, audited and tested, and called by nothing
 * outside their own test file. The logic is theirs; this is the wire.
 *
 * Nothing here re-checks a capability. `staffMutation` inside each service
 * asserts it — `setVerificationTier` included, which is ops lead alone since
 * board 4i retired the field verifier and the visit check went with it. A
 * second check here would be a second place to get it wrong — the screen gates
 * what it *offers*, the service decides what it *permits*, and the two are
 * allowed to disagree in exactly one direction.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

function done(businessId: string, { home = false }: { home?: boolean } = {}): void {
  /*
     Board 6h: a suspension and a tier change are the two decisions that empty
     a "Verified this week" card, and the home page's data is cached for five
     minutes. A suspended business still on the home page for that long is a
     stale claim about verification on the most-linked page on the site.
  */
  if (home) revalidateTag(HOME_CACHE_TAG, { expire: 0 });
  revalidatePath("/admin/businesses");
  // The account's own page, where every decision below is now made (4f B10).
  revalidatePath(`/admin/businesses/${businessId}`);
  // The overview counts suspended accounts and unverified listings.
  revalidatePath("/admin");
}

/**
 * The refusals from the three services behind this screen, worded here.
 *
 * All three returned sentences of raw English that this file handed straight
 * to the user — the last of the five service layers doing it, and the only
 * strings on this screen that never reached `lib/i18n/en.ts`. Three of them
 * also interpolated a bare ISO date or a tier number into that English.
 *
 * The services carry the *facts* now — a tier, a date, a display name — and
 * the wording is here, where every other string on this screen already came
 * from.
 */
function tierRefusal(result: Extract<TierResult, { ok: false }>): string {
  switch (result.error) {
    case "out_of_range":
      return t("admin.businesses.error.out_of_range", {
        min: String(MIN_TIER),
        max: String(MAX_TIER),
      });
    case "unchanged":
      return t("admin.businesses.error.unchanged", { tier: String(result.tier) });
    case "licence_expired":
      return t("admin.businesses.error.licence_expired", {
        date: formatDate(result.expiredOn),
        ceiling: String(EXPIRED_LICENCE_TIER),
      });
    default:
      return t("admin.businesses.error.not_found");
  }
}

function suspendRefusal(result: Extract<SuspendResult, { ok: false }>): string {
  return result.error === "already_suspended"
    ? t("admin.businesses.error.already_suspended", {
        business: result.displayName,
        date: formatDate(result.since),
      })
    : t("admin.businesses.error.not_found");
}

function liftRefusal(result: Extract<LiftResult, { ok: false }>): string {
  return result.error === "not_suspended"
    ? t("admin.businesses.error.not_suspended", { business: result.displayName })
    : t("admin.businesses.error.not_found");
}

export async function setTier(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const raw = String(formData.get("tier") ?? "");
  const tier = Number(raw);

  // Refused here rather than in the service, because a non-numeric tier means
  // the form was posted by something other than the form.
  if (!Number.isInteger(tier)) return { ok: false, error: t("admin.businesses.tier_invalid") };

  try {
    const result = await setVerificationTier({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      tier,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: tierRefusal(result) };
    done(String(formData.get("businessId") ?? ""), { home: true });
    return { ok: true, message: t("admin.businesses.tier_set", { tier: String(result.tier) }) };
  } catch (error) {
    return refused(error);
  }
}

export async function suspend(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await suspendBusiness({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: suspendRefusal(result) };
    done(String(formData.get("businessId") ?? ""), { home: true });
    return { ok: true, message: t("admin.businesses.suspended") };
  } catch (error) {
    return refused(error);
  }
}

export async function lift(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await liftSuspension({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: liftRefusal(result) };
    done(String(formData.get("businessId") ?? ""), { home: true });
    return { ok: true, message: t("admin.businesses.lifted") };
  } catch (error) {
    return refused(error);
  }
}

/**
 * Board 11i build note B8 — notice that a listing will close because its
 * licence lapsed. Nothing comes down today; the seller is told first.
 */
export async function giveNotice(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await giveLicenceLapseNotice({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) {
      return {
        ok: false,
        error: t(`admin.businesses.closure.error.${result.error}` as "admin.businesses.closure.error.not_found"),
      };
    }
    done(String(formData.get("businessId") ?? ""));
    return {
      ok: true,
      message: result.emailDelivered
        ? t("admin.businesses.closure.noticed", { date: formatDate(result.effectiveAt) })
        : t("admin.businesses.closure.noticed_unsent", { date: formatDate(result.effectiveAt) }),
    };
  } catch (error) {
    return refused(error);
  }
}

/** Withdraw an open notice or closure, restoring the listing if it came down. */
export async function withdraw(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await withdrawClosure({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) {
      return {
        ok: false,
        error: t(`admin.businesses.closure.error.${result.error}` as "admin.businesses.closure.error.not_found"),
      };
    }
    if (result.restored) revalidateClosure(result.slug);
    done(String(formData.get("businessId") ?? ""));
    return { ok: true, message: t("admin.businesses.closure.withdrawn") };
  } catch (error) {
    return refused(error);
  }
}

/** Q2 — reopen a closed business for the same licence holder, by their email. */
export async function reopen(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await reopenClosedBusiness({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      ownerEmail: String(formData.get("ownerEmail") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) {
      return {
        ok: false,
        error: t(`admin.businesses.closure.error.${result.error}` as "admin.businesses.closure.error.not_found"),
      };
    }
    done(String(formData.get("businessId") ?? ""));
    return { ok: true, message: t("admin.businesses.closure.reopened") };
  } catch (error) {
    return refused(error);
  }
}

// ── Saved segments (B8) ───────────────────────────────────────────────────────

export type SegmentActionResult = { ok: true; message: string; query: string } | { ok: false; error: string };

const SEGMENT_ERRORS = {
  not_staff: "admin.businesses.segments.error.not_staff",
  empty_name: "admin.businesses.segments.error.empty_name",
  empty_filter: "admin.businesses.segments.error.empty_filter",
  name_taken: "admin.businesses.segments.error.name_taken",
  too_many: "admin.businesses.segments.error.too_many",
  not_found: "admin.businesses.segments.error.not_found",
  not_yours: "admin.businesses.segments.error.not_yours",
} as const;

export async function saveSegmentAction(formData: FormData): Promise<SegmentActionResult> {
  const seat = await requireStaff();
  const result = await saveSegment(seat.actor, {
    name: String(formData.get("name") ?? ""),
    query: String(formData.get("query") ?? ""),
  });
  if (!result.ok) return { ok: false, error: t(SEGMENT_ERRORS[result.error]) };
  revalidatePath("/admin/businesses");
  return { ok: true, message: t("admin.businesses.segments.saved"), query: result.query };
}

export async function deleteSegmentAction(formData: FormData): Promise<SegmentActionResult> {
  const seat = await requireStaff();
  const result = await deleteSegment(seat.actor, String(formData.get("id") ?? ""));
  if (!result.ok) return { ok: false, error: t(SEGMENT_ERRORS[result.error]) };
  revalidatePath("/admin/businesses");
  return { ok: true, message: t("admin.businesses.segments.deleted"), query: result.query };
}
