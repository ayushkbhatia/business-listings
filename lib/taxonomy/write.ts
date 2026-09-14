import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import {
  codeProblem,
  nameProblem,
  normaliseSynonyms,
  sameSynonyms,
  slugProblem,
  type FieldProblem,
} from "./rules";

/**
 * Board 4d — the editor's writes: a category's details, its three switches, and
 * a new category.
 *
 * Every one is a `staffMutation` with a written reason (non-negotiable 3), and
 * every one takes the category's advisory lock first — the same lock a merge
 * takes on both sides — so an edit and a merge touching one category serialise
 * rather than interleave. That is the board's "merge in progress: both
 * categories locked" state, held by the database for the length of the
 * transaction rather than by a flag somebody has to remember to clear.
 *
 * Refusals are codes, not sentences. The action turns them into catalogue
 * strings, so nothing a person reads is written here.
 */

type Tx = Prisma.TransactionClient;

export type CategoryRefusal =
  | FieldProblem
  | "not_found"
  | "stale"
  | "unchanged"
  | "name_taken"
  | "slug_taken"
  | "parent_not_sector"
  | "template_not_serving";

export type CategoryResult<T = object> = ({ ok: true } & T) | { ok: false; error: CategoryRefusal };

/** Thrown inside a transaction so the refusal rolls back and writes no audit row. */
class Refused extends Error {
  constructor(readonly error: CategoryRefusal) {
    super(error);
  }
}

async function refusable<T>(work: () => Promise<CategoryResult<T>>): Promise<CategoryResult<T>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.error };
    throw error;
  }
}

/**
 * The advisory lock one category's writes share with a merge touching it.
 *
 * Several ids are locked in a fixed order, so a merge of A into B and a merge
 * of B into A cannot each hold one lock and wait for the other.
 */
export async function lockCategories(tx: Tx, ids: readonly string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`category:${id}`}))`;
  }
}

/** A category id before the row exists, so the audit subject can name it. */
function newCategoryId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`.slice(0, 25);
}

// ─────────────────────────────────────────────────────────────────────────────
// Details
// ─────────────────────────────────────────────────────────────────────────────

export interface CategoryDetails {
  name: string;
  code: string;
  synonyms: string[];
  defaultTemplateId: string | null;
}

/**
 * Save the editor's fields in one decision, with one reason.
 *
 * `basis` is what the editor loaded. If the row no longer says that, somebody
 * else saved in between and this save is refused as stale rather than
 * overwriting a change its author never saw — two ops leads each fixing a
 * synonym list would otherwise each silently undo the other.
 *
 * **B6: changing the default spec template rewrites no product.** It changes
 * which template a new product form in this category is offered first; `4e`
 * versions templates and every existing product keeps the values it holds.
 *
 * The audit row carries only the fields that moved, so the log reads "synonyms
 * gained صمامات" and not a copy of the whole record every time.
 */
export async function saveCategoryDetails(input: {
  actor: Actor;
  categoryId: string;
  basis: CategoryDetails;
  next: CategoryDetails;
  reason: string;
}): Promise<CategoryResult<{ changed: (keyof CategoryDetails)[]; reindex: boolean }>> {
  assertCan(input.actor, "taxonomy.write");

  const name = input.next.name.trim();
  const code = input.next.code.trim().toUpperCase();
  const synonyms = normaliseSynonyms(input.next.synonyms);
  const problem =
    nameProblem(name) ?? codeProblem(code, input.basis.code) ?? synonyms.problem;
  if (problem) return { ok: false, error: problem };

  return refusable(() =>
    prisma.$transaction(async (tx) => {
      await lockCategories(tx, [input.categoryId]);
      const row = await tx.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true, parentId: true, name: true, code: true, synonyms: true, defaultTemplateId: true },
      });
      if (!row) throw new Refused("not_found");

      const current: CategoryDetails = {
        name: row.name,
        code: row.code,
        synonyms: row.synonyms,
        defaultTemplateId: row.defaultTemplateId,
      };
      if (
        current.name !== input.basis.name ||
        current.code !== input.basis.code ||
        current.defaultTemplateId !== input.basis.defaultTemplateId ||
        !sameSynonyms(current.synonyms, normaliseSynonyms(input.basis.synonyms).value)
      ) {
        throw new Refused("stale");
      }

      const next: CategoryDetails = { name, code, synonyms: synonyms.value, defaultTemplateId: input.next.defaultTemplateId };
      const changed = (Object.keys(next) as (keyof CategoryDetails)[]).filter((key) =>
        key === "synonyms" ? !sameSynonyms(current.synonyms, next.synonyms) : current[key] !== next[key],
      );
      if (changed.length === 0) throw new Refused("unchanged");

      if (changed.includes("name")) {
        const clash = await tx.category.findFirst({
          where: { parentId: row.parentId, id: { not: row.id }, name: { equals: name, mode: "insensitive" } },
          select: { id: true },
        });
        if (clash) throw new Refused("name_taken");
      }
      if (changed.includes("defaultTemplateId") && next.defaultTemplateId !== null) {
        const serving = await tx.specTemplateCategory.findUnique({
          where: { templateId_categoryId: { templateId: next.defaultTemplateId, categoryId: row.id } },
          select: { templateId: true },
        });
        if (!serving) throw new Refused("template_not_serving");
      }

      const before = Object.fromEntries(changed.map((key) => [key, current[key]]));
      const after = Object.fromEntries(changed.map((key) => [key, next[key]]));

      await staffMutation(
        { actor: input.actor, capability: "taxonomy.write", subject: `Category:${row.id}`, reason: input.reason, tx },
        async () => {
          await tx.category.update({
            where: { id: row.id },
            data: Object.fromEntries(changed.map((key) => [key, next[key]])) as Prisma.CategoryUncheckedUpdateInput,
          });
          return { result: null, before, after };
        },
      );

      // A listing's search text carries its categories' names and synonyms.
      return { ok: true as const, changed, reindex: changed.includes("name") || changed.includes("synonyms") };
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The switches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three switches the visibility panel draws. `showOnHome` is not one of
 * them: the home rail computes (board `6h`), and the editor shows what it
 * decided rather than offering a control that would argue with it.
 */
export const VISIBILITY_FIELDS = ["showInIndex", "acceptsRfq", "requiresExtraCheck"] as const;
export type VisibilityField = (typeof VISIBILITY_FIELDS)[number];

export function isVisibilityField(value: string): value is VisibilityField {
  return (VISIBILITY_FIELDS as readonly string[]).includes(value);
}

/**
 * Flip one switch. A toggle applies immediately (§02), and a staff state change
 * carries a reason, so the panel asks for the reason at the moment of the flip.
 *
 * A switch already in the requested position is refused before anything is
 * written, inside the lock — two ops leads flipping the same switch leave one
 * audit row, not two rows recording a decision the second one never made.
 */
export async function setCategorySwitch(input: {
  actor: Actor;
  categoryId: string;
  field: VisibilityField;
  value: boolean;
  reason: string;
}): Promise<CategoryResult> {
  assertCan(input.actor, "taxonomy.write");

  return refusable(() =>
    prisma.$transaction(async (tx) => {
      await lockCategories(tx, [input.categoryId]);
      const row = await tx.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true, showInIndex: true, acceptsRfq: true, requiresExtraCheck: true },
      });
      if (!row) throw new Refused("not_found");
      if (row[input.field] === input.value) throw new Refused("unchanged");

      await staffMutation(
        { actor: input.actor, capability: "taxonomy.write", subject: `Category:${row.id}`, reason: input.reason, tx },
        async () => {
          await tx.category.update({ where: { id: row.id }, data: { [input.field]: input.value } });
          return { result: null, before: { [input.field]: row[input.field] }, after: { [input.field]: input.value } };
        },
      );
      return { ok: true as const };
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A new category
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a sector, or a subcategory under one.
 *
 * Two levels, because two levels is what every reader walks: `/c/:category/:sub`,
 * `descendantsOf` in the fan-out, `categoryIdsFor` in search. A third level
 * would be a category every one of those quietly failed to find.
 *
 * It starts with no trade kind of its own, so it inherits its sector's — the
 * honest starting state `4d-s` asks for — and in the index, taking RFQs, with
 * no extra licence check: the defaults every existing row has. A new sector has
 * no listings, so it stays out of the index and off the home rail until it has
 * some, whatever its switch says.
 */
export async function createCategory(input: {
  actor: Actor;
  parentId: string | null;
  name: string;
  slug: string;
  code: string;
  reason: string;
}): Promise<CategoryResult<{ id: string }>> {
  assertCan(input.actor, "taxonomy.write");

  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const code = input.code.trim().toUpperCase();
  const problem = nameProblem(name) ?? slugProblem(slug) ?? codeProblem(code);
  if (problem) return { ok: false, error: problem };

  const id = newCategoryId();

  return refusable(() =>
    prisma.$transaction(async (tx) => {
      // One lock for every add, so two adds cannot take the same slug or the
      // same position between the check and the insert.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('category:create'))`;
      if (input.parentId) await lockCategories(tx, [input.parentId]);

      if (input.parentId) {
        const parent = await tx.category.findUnique({ where: { id: input.parentId }, select: { parentId: true } });
        if (!parent) throw new Refused("not_found");
        if (parent.parentId !== null) throw new Refused("parent_not_sector");
      }

      const [slugTaken, nameTaken, last] = await Promise.all([
        tx.category.findUnique({ where: { slug }, select: { id: true } }),
        tx.category.findFirst({
          where: { parentId: input.parentId, name: { equals: name, mode: "insensitive" } },
          select: { id: true },
        }),
        tx.category.findFirst({
          where: { parentId: input.parentId },
          orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
          select: { sortOrder: true },
        }),
      ]);
      if (slugTaken) throw new Refused("slug_taken");
      if (nameTaken) throw new Refused("name_taken");

      await staffMutation(
        {
          actor: input.actor,
          capability: "taxonomy.write",
          action: "category_created",
          subject: `Category:${id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.category.create({
            data: { id, parentId: input.parentId, name, slug, code, sortOrder: (last?.sortOrder ?? 0) + 1 },
          });
          return { result: null, before: null, after: { parentId: input.parentId, name, slug, code } };
        },
      );
      return { ok: true as const, id };
    }),
  );
}
