"use server";

import { after } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { HOME_CACHE_TAG } from "@/lib/db/queries/home";
import { formatCount } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { mergeCategories, previewMerge, type MergePreview } from "@/lib/taxonomy/merge";
import { addressesFor, deleteCategory, renameCategory } from "@/lib/taxonomy/rename";
import { reindexCategoryListings } from "@/lib/taxonomy/reindex";
import {
  setTradeKindBulk,
  TAXONOMY_CACHE_TAG,
  tradeKindBulkImpact,
  type TaxonomyResult,
} from "@/lib/taxonomy/service";
import {
  saveServicesLandingCopy,
  setServicesLandingOpen,
  type CategoryAskInput,
  type ServicesLandingRefusal,
} from "@/lib/taxonomy/services-landing";
import {
  createCategory,
  isVisibilityField,
  saveCategoryDetails,
  setCategorySwitch,
  type CategoryDetails,
  type CategoryRefusal,
} from "@/lib/taxonomy/write";

/**
 * Board 4d's mutations, and 4d-s's two.
 *
 * Thin. The rules — what a save may change, what a merge refuses, how many
 * addresses a rename moves — live in `lib/taxonomy/`, where they are tested
 * without a request. This file turns a form into a call, a refusal code into a
 * catalogue sentence, and a write into the caches and search text it staled.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
export type CreateResult = { ok: true; message: string; id: string } | { ok: false; error: string };

const text = (form: FormData, name: string): string => String(form.get(name) ?? "");

function caught(error: unknown): { ok: false; error: string } {
  if (error instanceof PermissionError) return { ok: false, error: t("taxonomy.refusal.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("taxonomy.refusal.reason") };
  throw error;
}

function refusal(code: CategoryRefusal): { ok: false; error: string } {
  return { ok: false, error: t(`taxonomy.refusal.${code}` as MessageKey) };
}

/**
 * A rename or delete refusal, in the catalogue's words. The service's own
 * `message` is English written for logs and is never rendered.
 */
function taxonomyRefusal(result: Extract<TaxonomyResult, { ok: false }>): { ok: false; error: string } {
  const reason = result.detail?.reason;
  if (result.error === "would_orphan" && reason) {
    return {
      ok: false,
      error: t(`taxonomy.refusal.orphan.${reason}` as MessageKey, { count: result.detail?.count ?? 0 }),
    };
  }
  if (result.error === "slug_taken" && reason) {
    return { ok: false, error: t(`taxonomy.refusal.slug.${reason}` as MessageKey) };
  }
  return { ok: false, error: t(`taxonomy.refusal.${result.error}` as MessageKey) };
}

/**
 * Everything a taxonomy write can have staled.
 *
 * `public` for a write a buyer can see — a name, an address, the index switch, a
 * merge, an add or a remove. The editor-only fields (a synonym, the template
 * offered first, the licence-check switch) change nothing on a public page and
 * leave the public caches alone: every revalidation is a render somebody pays
 * for.
 */
function refresh(options: { public: boolean; tree?: boolean; reindex?: readonly string[] }) {
  revalidatePath("/admin/categories");
  if (options.tree) {
    // The trade-kind map is keyed by category id; a row added or removed is a
    // key it does not have.
    revalidateTag(TAXONOMY_CACHE_TAG, { expire: 0 });
  }
  if (options.public) {
    revalidatePath("/categories");
    revalidateTag(HOME_CACHE_TAG, { expire: 0 });
    revalidatePath("/admin/content/redirects");
  }
  const ids = options.reindex ?? [];
  if (ids.length) {
    after(async () => {
      const outcome = await reindexCategoryListings(ids);
      console.info("[taxonomy] reindexed after a taxonomy write", outcome);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The editor
// ─────────────────────────────────────────────────────────────────────────────

function details(raw: string): CategoryDetails | null {
  try {
    const value = JSON.parse(raw) as Partial<CategoryDetails>;
    if (
      typeof value.name !== "string" ||
      typeof value.code !== "string" ||
      !Array.isArray(value.synonyms) ||
      !value.synonyms.every((term) => typeof term === "string") ||
      !(value.defaultTemplateId === null || typeof value.defaultTemplateId === "string")
    ) {
      return null;
    }
    return {
      name: value.name,
      code: value.code,
      synonyms: value.synonyms,
      defaultTemplateId: value.defaultTemplateId,
    };
  } catch {
    return null;
  }
}

export async function saveDetailsAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const basis = details(text(form, "basis"));
  const next = details(text(form, "next"));
  if (!basis || !next) return refusal("stale");

  try {
    const categoryId = text(form, "categoryId");
    const result = await saveCategoryDetails({ actor: seat.actor, categoryId, basis, next, reason: text(form, "reason") });
    if (!result.ok) return refusal(result.error);

    refresh({ public: result.changed.includes("name"), reindex: result.reindex ? [categoryId] : [] });
    return { ok: true, message: t("taxonomy.editor.saved", { count: result.changed.length }) };
  } catch (error) {
    return caught(error);
  }
}

export async function switchAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const field = text(form, "field");
  if (!isVisibilityField(field)) return refusal("unchanged");
  const value = text(form, "value") === "on";

  try {
    const result = await setCategorySwitch({
      actor: seat.actor,
      categoryId: text(form, "categoryId"),
      field,
      value,
      reason: text(form, "reason"),
    });
    if (!result.ok) return refusal(result.error);

    refresh({ public: field === "showInIndex" });
    return { ok: true, message: t(`taxonomy.visibility.saved.${field}.${value ? "on" : "off"}` as MessageKey) };
  } catch (error) {
    return caught(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Board 6a-s — the services landing pages' wording, and the template switch
// ─────────────────────────────────────────────────────────────────────────────

function servicesRefusal(code: ServicesLandingRefusal): { ok: false; error: string } {
  return { ok: false, error: t(`taxonomy.services_landing.refusal.${code}` as MessageKey) };
}

/** The questions, off the form. Anything that is not a list of pairs is refused whole. */
function asksOf(raw: string): CategoryAskInput[] | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    const out: CategoryAskInput[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") return null;
      const { question, why } = item as Record<string, unknown>;
      if (typeof question !== "string" || typeof why !== "string") return null;
      out.push({ question, why });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Save the trade's page wording — its plural noun, the credential it counts
 * and its questions — in one decision with one reason.
 *
 * The landing pages are dynamic and read the record on every request, so
 * nothing public needs revalidating: the next render is the new wording.
 */
export async function saveServicesLandingAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const asks = asksOf(text(form, "asks"));
  if (!asks) return servicesRefusal("ask_empty");
  const credential = text(form, "credentialKind");

  try {
    const result = await saveServicesLandingCopy({
      actor: seat.actor,
      categoryId: text(form, "categoryId"),
      pluralHuman: text(form, "pluralHuman"),
      credentialKind: credential === "" ? null : credential,
      asks,
      reason: text(form, "reason"),
    });
    if (!result.ok) return servicesRefusal(result.error);
    refresh({ public: false });
    return { ok: true, message: t("taxonomy.services_landing.saved") };
  } catch (error) {
    return caught(error);
  }
}

/**
 * Open or close the services template for one trade — build phase 5's flag.
 *
 * Public, because it decides which URLs exist: the sitemap and the category
 * index both read it through the gate, and both are cached.
 */
export async function setServicesLandingOpenAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const open = text(form, "open") === "on";
  const name = text(form, "name");

  try {
    const result = await setServicesLandingOpen({
      actor: seat.actor,
      categoryId: text(form, "categoryId"),
      open,
      reason: text(form, "reason"),
    });
    if (!result.ok) return servicesRefusal(result.error);
    refresh({ public: true });
    revalidatePath("/sitemap.xml");
    revalidatePath("/admin/content/matrix");
    return {
      ok: true,
      message: t(open ? "taxonomy.services_landing.opened" : "taxonomy.services_landing.closed", { name }),
    };
  } catch (error) {
    return caught(error);
  }
}

/** How many addresses a new slug would move, shown before anybody commits to it. */
export async function previewRenameAction(categoryId: string, slug: string): Promise<number> {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write") || !categoryId || !slug) return 0;
  return (await addressesFor(categoryId, slug.trim().toLowerCase())).length;
}

export async function renameAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const categoryId = text(form, "categoryId");
    const result = await renameCategory(seat.actor, categoryId, text(form, "slug"), text(form, "reason"));
    if (!result.ok) return taxonomyRefusal(result);

    refresh({ public: true });
    return { ok: true, message: t("taxonomy.slug.saved", { count: result.moved ?? 0 }) };
  } catch (error) {
    return caught(error);
  }
}

export async function removeAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await deleteCategory(seat.actor, text(form, "categoryId"), text(form, "reason"));
    if (!result.ok) return taxonomyRefusal(result);

    refresh({ public: true, tree: true });
    return { ok: true, message: t("taxonomy.remove.saved") };
  } catch (error) {
    return caught(error);
  }
}

export async function createAction(form: FormData): Promise<CreateResult> {
  const seat = await requireStaff();
  try {
    const parentId = text(form, "parentId");
    const result = await createCategory({
      actor: seat.actor,
      parentId: parentId || null,
      name: text(form, "name"),
      slug: text(form, "slug"),
      code: text(form, "code"),
      reason: text(form, "reason"),
    });
    if (!result.ok) return refusal(result.error);

    refresh({ public: true, tree: true });
    return { ok: true, id: result.id, message: t("taxonomy.add.saved") };
  } catch (error) {
    return caught(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The merge tool
// ─────────────────────────────────────────────────────────────────────────────

/** The confirmation's figures. Null when the seat may not merge or either side is gone. */
export async function mergePreviewAction(sourceId: string, targetId: string): Promise<MergePreview | null> {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.merge") || !sourceId || !targetId) return null;
  return previewMerge(sourceId, targetId);
}

export async function mergeAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const targetId = text(form, "targetId");
    const result = await mergeCategories({
      actor: seat.actor,
      sourceId: text(form, "sourceId"),
      targetId,
      reason: text(form, "reason"),
    });
    if (!result.ok) {
      return {
        ok: false,
        error: t(`taxonomy.merge.refusal.${result.error}` as MessageKey, { name: result.name ?? "" }),
      };
    }

    refresh({ public: true, tree: true, reindex: [targetId] });
    return {
      ok: true,
      message: t("taxonomy.merge.saved", {
        listings: formatCount(result.moved.listings),
        redirects: formatCount(result.moved.redirects),
      }),
    };
  } catch (error) {
    return caught(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Board 4d-s — the trade-kind tab
// ─────────────────────────────────────────────────────────────────────────────

/** The three values the bulk bar can post, and nothing else. */
function kindOf(raw: string): "goods" | "services" | null | undefined {
  if (raw === "goods" || raw === "services") return raw;
  if (raw === "inherit") return null;
  return undefined;
}

/**
 * What a bulk change would move — board `4d-s` B5, shown before the button.
 *
 * Three numbers rather than one: what is written, what follows by inheritance,
 * and how many published listings render differently afterwards. The third is
 * the one that decides whether this is a routine edit or a consequential one.
 */
export async function previewTradeKindBulk(
  categoryIds: readonly string[],
  kind: string,
): Promise<{ rows: number; alsoInheriting: number; listings: number }> {
  await requireStaff();
  const next = kindOf(kind);
  if (next === undefined || categoryIds.length === 0) {
    return { rows: 0, alsoInheriting: 0, listings: 0 };
  }
  return tradeKindBulkImpact(categoryIds, next);
}

/**
 * Set, override or clear a selection of trades in one transaction.
 *
 * Returns an `ActionResult` rather than throwing: a refusal here — a stale id,
 * a selection already holding the value, a missing reason — is an ordinary
 * outcome and the bar has somewhere to render it.
 */
export async function setKindBulk(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const kind = kindOf(String(formData.get("kind") ?? ""));
    if (kind === undefined) return { ok: false, error: t("taxonomy.kind_hint") };

    const categoryIds = String(formData.get("categoryIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const result = await setTradeKindBulk({
      actor: seat.actor,
      categoryIds,
      tradeKind: kind,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return taxonomyRefusal(result);

    /*
       The cached resolved map, dropped here rather than in the service.

       `revalidateTag` needs a request context, so the service — which a job or
       a test must be able to call — cannot do it. Every screen that reads a
       trade kind reads it through that cache, so a write that did not drop it
       would leave suppliers on the wrong version of about forty screens until
       the day-long backstop expired.
    */
    revalidateTag(TAXONOMY_CACHE_TAG, { expire: 0 });
    revalidatePath("/admin/categories");
    return {
      ok: true,
      message: t("taxonomy.kind_saved_bulk", { count: result.changed ?? categoryIds.length }),
    };
  } catch (error) {
    return caught(error);
  }
}
