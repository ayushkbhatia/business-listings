"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { publishAreaPage, saveAreaIntro, unpublishAreaPage } from "@/lib/seo/area";
import {
  publishEmiratePage,
  saveEmirateIntro,
  unpublishEmiratePage,
} from "@/lib/seo/emirate";
import { editCategory, type CategoryRules } from "@/lib/taxonomy/service";
import type { Actor } from "@/lib/auth/roles";
import { recordScopeDemand } from "@/lib/content/demand";
import { generateDrafts } from "@/lib/content/drafts";
import { holdLandingPage, releaseLandingPage } from "@/lib/content/hold";
import {
  approveRuleChange,
  closeRuleChange,
  previewRuleChange,
  proposeRuleChange,
  RULE_FIELDS,
  type RuleImpact,
} from "@/lib/content/publish-rule";
import {
  landingState,
  saveLandingFaq,
  saveMetaDescription,
  saveRelatedSearches,
  type FaqInput,
  type LandingFaqRow,
  type LandingRelatedRow,
  type LandingScope,
  type RelatedSearchInput,
} from "@/lib/seo/landing";
import { scopeForArea, scopeForEmirate } from "@/lib/seo/landing/resolve-by-id";
import { t } from "@/lib/i18n";

/**
 * Board 6f's one mutation: the copy on a landing page.
 *
 * Through `editCategory`, so it writes the same audited row a threshold change
 * does. A paragraph that decides whether a page publishes is a change somebody
 * should have to explain.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveIntro(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await editCategory({
      actor: seat.actor,
      categoryId: String(formData.get("categoryId") ?? ""),
      intro: String(formData.get("intro") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/content/matrix");
    revalidatePath("/admin/categories");
    return { ok: true, message: t("matrix.saved") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
    throw error;
  }
}

/**
 * Board 6a's three: write the paragraph, publish, unpublish.
 *
 * The publish gate is in `lib/seo/area.ts` and not here, which is what
 * criterion 1's "cannot be published, by API or by admin action" means — this
 * action is one caller of a service that refuses, not a second place the rule
 * is written down.
 */
function areaPaths(formData: FormData) {
  revalidatePath("/admin/content/matrix");
  const path = String(formData.get("path") ?? "");
  if (path.startsWith("/")) revalidatePath(path);
}

export async function saveAreaCopy(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await saveAreaIntro({
      actor: seat.actor,
      areaId: String(formData.get("areaId") ?? ""),
      categoryId: String(formData.get("categoryId") ?? ""),
      intro: String(formData.get("intro") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    areaPaths(formData);
    return { ok: true, message: t("matrix.saved") };
  } catch (error) {
    return refusedBy(error);
  }
}

export async function publishArea(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await publishAreaPage(
      seat.actor,
      String(formData.get("areaId") ?? ""),
      String(formData.get("categoryId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    areaPaths(formData);
    return { ok: true, message: t("matrix.area_published") };
  } catch (error) {
    return refusedBy(error);
  }
}

export async function unpublishArea(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await unpublishAreaPage(
      seat.actor,
      String(formData.get("areaId") ?? ""),
      String(formData.get("categoryId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    areaPaths(formData);
    return { ok: true, message: t("matrix.area_unpublished") };
  } catch (error) {
    return refusedBy(error);
  }
}

function refusedBy(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
  throw error;
}

/*
 * The emirate pages — board 6c's matrix, authored the same way as an area page.
 *
 * `/categories` is revalidated too: its matrix reads the same rows, so a cell
 * that just went live has to stop rendering as plain text.
 */
function emiratePaths(formData: FormData) {
  revalidatePath("/admin/content/matrix");
  revalidatePath("/categories");
  const path = String(formData.get("path") ?? "");
  if (path.startsWith("/")) revalidatePath(path);
}

export async function saveEmirateCopy(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await saveEmirateIntro({
      actor: seat.actor,
      emirate: String(formData.get("emirate") ?? ""),
      categoryId: String(formData.get("categoryId") ?? ""),
      intro: String(formData.get("intro") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    emiratePaths(formData);
    return { ok: true, message: t("matrix.saved") };
  } catch (error) {
    return refusedBy(error);
  }
}

export async function publishEmirate(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await publishEmiratePage(
      seat.actor,
      String(formData.get("emirate") ?? ""),
      String(formData.get("categoryId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    emiratePaths(formData);
    return { ok: true, message: t("matrix.area_published") };
  } catch (error) {
    return refusedBy(error);
  }
}

export async function unpublishEmirate(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await unpublishEmiratePage(
      seat.actor,
      String(formData.get("emirate") ?? ""),
      String(formData.get("categoryId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    emiratePaths(formData);
    return { ok: true, message: t("matrix.area_unpublished") };
  } catch (error) {
    return refusedBy(error);
  }
}

/*
 * Board 6a's content records: the FAQ, the related searches and the written
 * meta description.
 *
 * One action for all four fields — intro included — because a writer works on a
 * scope rather than on a column, and asking for four written reasons to publish
 * one page would produce four copies of the same sentence.
 *
 * Each service is called only where its value actually changed, so the audit
 * log carries one row per thing that moved rather than four rows per click.
 * `AuditEvent` is a log of decisions, and "saved the page, changed nothing"
 * is not one.
 */

interface ContentSubmission {
  intro: string;
  metaDescription: string;
  faq: FaqInput[];
  relatedSearches: RelatedSearchInput[];
  reason: string;
}

/**
 * The FAQ and related-search rows arrive as JSON in one field.
 *
 * A repeatable row set in a `FormData` is either `faq[0][question]`-style keys
 * parsed back by hand, or this. The client owns the shape either way, and one
 * `JSON.parse` behind a type guard is the version where a malformed submission
 * is one refusal rather than a partially applied write.
 */
function readRows<T>(formData: FormData, key: string, guard: (value: unknown) => value is T): T[] {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(guard);
  } catch {
    return [];
  }
}

function isFaqInput(value: unknown): value is FaqInput {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<FaqInput>;
  return typeof row.question === "string" && typeof row.answer === "string";
}

function isRelatedInput(value: unknown): value is RelatedSearchInput {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RelatedSearchInput>;
  return typeof row.label === "string" && typeof row.href === "string";
}

function submissionFrom(formData: FormData): ContentSubmission {
  return {
    intro: String(formData.get("intro") ?? ""),
    metaDescription: String(formData.get("metaDescription") ?? ""),
    faq: readRows(formData, "faq", isFaqInput).map((row) => ({
      question: row.question,
      answer: row.answer,
      scopeSpecific: Boolean(row.scopeSpecific),
      liveToken: row.liveToken ? String(row.liveToken) : null,
    })),
    relatedSearches: readRows(formData, "relatedSearches", isRelatedInput).map((row) => ({
      label: row.label,
      href: row.href,
    })),
    reason: String(formData.get("reason") ?? ""),
  };
}

function faqChanged(before: readonly LandingFaqRow[], after: readonly FaqInput[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((row, index) => {
    const next = after[index];
    return (
      !next ||
      row.question !== next.question.trim() ||
      row.answer !== next.answer.trim() ||
      row.scopeSpecific !== next.scopeSpecific ||
      (row.liveToken ?? null) !== (next.liveToken?.trim() || null)
    );
  });
}

function relatedChanged(
  before: readonly LandingRelatedRow[],
  after: readonly RelatedSearchInput[],
): boolean {
  if (before.length !== after.length) return true;
  return before.some((row, index) => {
    const next = after[index];
    return !next || row.label !== next.label.trim() || row.href !== next.href.trim();
  });
}

/** Write whatever moved, on either landing class. */
async function saveContent(
  scope: LandingScope,
  submission: ContentSubmission,
  actor: Parameters<typeof saveLandingFaq>[0],
): Promise<ActionResult> {
  const before = await landingState(scope);

  if (submission.metaDescription.trim() !== (before.metaDescription ?? "")) {
    const result = await saveMetaDescription(
      actor,
      scope,
      submission.metaDescription,
      submission.reason,
    );
    if (!result.ok) return { ok: false, error: result.message };
  }

  if (faqChanged(before.faq, submission.faq)) {
    const result = await saveLandingFaq(actor, scope, submission.faq, submission.reason);
    if (!result.ok) return { ok: false, error: result.message };
  }

  if (relatedChanged(before.relatedSearches, submission.relatedSearches)) {
    const result = await saveRelatedSearches(
      actor,
      scope,
      submission.relatedSearches,
      submission.reason,
    );
    if (!result.ok) return { ok: false, error: result.message };
  }

  return { ok: true, message: t("matrix.saved") };
}

export async function saveAreaContent(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const submission = submissionFrom(formData);

    // The paragraph first, through its own service, because that one has
    // existed since board 6a's first cut and every caller and test uses it.
    const intro = await saveAreaIntro({
      actor: seat.actor,
      areaId: String(formData.get("areaId") ?? ""),
      categoryId: String(formData.get("categoryId") ?? ""),
      intro: submission.intro,
      reason: submission.reason,
    });
    if (!intro.ok) return { ok: false, error: intro.message };

    const scope = await scopeForArea(
      String(formData.get("areaId") ?? ""),
      String(formData.get("categoryId") ?? ""),
    );
    if (!scope) return { ok: false, error: t("matrix.not_here") };

    const result = await saveContent(scope, submission, seat.actor);
    if (!result.ok) return result;

    areaPaths(formData);
    return result;
  } catch (error) {
    return refusedBy(error);
  }
}

export async function saveEmirateContent(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const submission = submissionFrom(formData);

    const intro = await saveEmirateIntro({
      actor: seat.actor,
      emirate: String(formData.get("emirate") ?? ""),
      categoryId: String(formData.get("categoryId") ?? ""),
      intro: submission.intro,
      reason: submission.reason,
    });
    if (!intro.ok) return { ok: false, error: intro.message };

    const scope = await scopeForEmirate(
      String(formData.get("emirate") ?? ""),
      String(formData.get("categoryId") ?? ""),
    );
    if (!scope) return { ok: false, error: t("matrix.not_here") };

    const result = await saveContent(scope, submission, seat.actor);
    if (!result.ok) return result;

    emiratePaths(formData);
    return result;
  } catch (error) {
    return refusedBy(error);
  }
}

/*
 * Board 6f §5 — the rules, under dual control.
 *
 * Four actions rather than one "save": a proposal, an approval, a rejection or
 * withdrawal, and a preview that writes nothing. The service refuses a proposer
 * who tries to approve their own change and a database CHECK refuses it again,
 * so this layer is the wording rather than the rule.
 */
export type PreviewResult =
  | { ok: true; impact: RuleImpact; before: CategoryRules; after: CategoryRules }
  | { ok: false; error: string };

export async function previewRules(formData: FormData): Promise<PreviewResult> {
  const seat = await requireStaff();
  const result = await previewRuleChange(
    seat.actor,
    String(formData.get("categoryId") ?? ""),
    readRules(formData),
  );
  return result.ok
    ? { ok: true, impact: result.impact, before: result.before, after: result.after }
    : { ok: false, error: result.message };
}

export async function proposeRules(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await proposeRuleChange(
      seat.actor,
      String(formData.get("categoryId") ?? ""),
      readRules(formData),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/content/matrix");
    return { ok: true, message: t("rules.proposed") };
  } catch (error) {
    return refusedBy(error);
  }
}

export async function approveRules(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await approveRuleChange(
      seat.actor,
      String(formData.get("changeId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    // Every landing page under this trade may have changed state, and so may
    // the public index that counts them.
    revalidatePath("/admin/content/matrix");
    revalidatePath("/categories");
    revalidatePath("/sitemap.xml");
    return {
      ok: true,
      message: t("rules.approved", {
        publishes: String(result.impact.publishes),
        unpublishes: String(result.impact.unpublishes),
      }),
    };
  } catch (error) {
    return refusedBy(error);
  }
}

export async function closeRules(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await closeRuleChange(
      seat.actor,
      String(formData.get("changeId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/content/matrix");
    return {
      ok: true,
      message: result.state === "withdrawn" ? t("rules.withdrawn") : t("rules.rejected"),
    };
  } catch (error) {
    return refusedBy(error);
  }
}

function readRules(formData: FormData): Partial<CategoryRules> {
  const out: Partial<CategoryRules> = {};
  for (const field of RULE_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    if (field === "humanReviewRequired") {
      out.humanReviewRequired = String(raw) === "true" || String(raw) === "on";
      continue;
    }
    const value = Number(String(raw));
    if (!Number.isFinite(value)) continue;
    Object.assign(out, { [field]: value });
  }
  return out;
}

/** Board 6f §2 — drafts into the content-ops queue. Never a publish. */
export async function generateDraftsAction(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const categoryId = String(formData.get("categoryId") ?? "");
    const result = await generateDrafts(
      seat.actor,
      categoryId === "" ? undefined : categoryId,
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/content/matrix");
    return { ok: true, message: t("matrix.drafts_made", { count: result.created }) };
  } catch (error) {
    return refusedBy(error);
  }
}

/** The recorded search volume for one scope, with its source and its vintage. */
export async function saveDemand(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const areaId = String(formData.get("areaId") ?? "");
    const captured = String(formData.get("capturedAt") ?? "");
    const result = await recordScopeDemand({
      actor: seat.actor,
      categoryId: String(formData.get("categoryId") ?? ""),
      emirate: String(formData.get("emirate") ?? ""),
      areaId: areaId === "" ? null : areaId,
      monthlySearches: Number(String(formData.get("monthlySearches") ?? "")),
      source: String(formData.get("source") ?? ""),
      capturedAt: captured === "" ? new Date() : new Date(captured),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    areaPaths(formData);
    return { ok: true, message: t("matrix.demand_saved") };
  } catch (error) {
    return refusedBy(error);
  }
}

/** `Held · editorial`. A person's no, and only a person's yes takes it away. */
export async function holdPage(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await holdLandingPage(readHold(seat.actor, formData));
    if (!result.ok) return { ok: false, error: result.message };
    areaPaths(formData);
    return { ok: true, message: t("matrix.held") };
  } catch (error) {
    return refusedBy(error);
  }
}

export async function releasePage(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await releaseLandingPage(readHold(seat.actor, formData));
    if (!result.ok) return { ok: false, error: result.message };
    areaPaths(formData);
    return { ok: true, message: t("matrix.released") };
  } catch (error) {
    return refusedBy(error);
  }
}

function readHold(actor: Actor, formData: FormData) {
  const areaId = String(formData.get("areaId") ?? "");
  const emirate = String(formData.get("emirate") ?? "");
  return {
    actor,
    ...(areaId === "" ? { emirate } : { areaId }),
    categoryId: String(formData.get("categoryId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  };
}
