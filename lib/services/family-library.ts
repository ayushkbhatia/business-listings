import "server-only";
import { prisma } from "@/lib/db/client";
import { staffMutation } from "@/lib/audit";
import { REQUIRED_FIELDS, ROW_KEYS } from "./scope-sheet";
import { resolveScopeFamily, type ScopeFamilyRow } from "./family";
import { resolveTradeKind } from "@/lib/taxonomy/trade-kind";
import type { Actor } from "@/lib/auth/roles";
import type { CredentialKind } from "@/lib/db/generated/enums";

/**
 * The scope-sheet library — board `4e-s`, a tab on the shipped `/admin/spec-library`.
 *
 * The goods `4e` authors 61 spec sheets, each describing a class of object.
 * This authors five families, each describing a way of selling work — *by time,
 * by output, by asset, by retainer* — and the ratio is the finding rather than
 * an accident of effort: a valve and a server share almost nothing, while a tax
 * return and an audit share their whole shape.
 *
 * ## A family varies two things and can vary nothing else
 *
 * Which fee bases make sense, and which credential is prompted. Plus the
 * optional rows it adds and the order they render in.
 *
 * **The six required fields are platform-level and a family cannot touch them**
 * — B4, AC3 — and that is true by construction rather than by review: they are
 * columns on `Service`, and this table holds rows. There is no shape a family
 * could take that would add a seventh or remove the first.
 *
 * ## Prompted, never gating
 *
 * `credentialKind` is B3 and `4e-s` Q2: the board's panel writes *required* and
 * means *expected by buyers*. Nothing in this module or anywhere downstream
 * reads it on a publish path, and `mayPublish()` still returns `true`
 * unconditionally. A test asserts the absence.
 */

export interface FamilyFeeBasis {
  key: string;
  label: string;
  position: number;
  /** Live services holding it. B9: removing one flags these, never clears them. */
  usedBy: number;
}

export interface FamilyRowDef {
  key: string;
  label: string;
  position: number;
  filterable: boolean;
}

export interface FamilyCard {
  id: string;
  name: string;
  position: number;
  /** The fallback rather than one of the five — B6. */
  isDefault: boolean;
  retiredAt: Date | null;
  credentialKind: CredentialKind | null;
  feeBases: FamilyFeeBasis[];
  rows: FamilyRowDef[];
  common: string[];
  /** Subcategories pointing at it. A live count, never a constant. */
  subcategories: number;
  /** Sellers whose own choice is this family, and templates built on it. */
  businesses: number;
  templates: number;
  /** Published service pages that would move if `rowOrder` changed — B7. */
  publishedServices: number;
}

export interface ScopeLibrary {
  families: FamilyCard[];
  /**
   * The six, listed so the screen can show them as fixed — B4.
   *
   * Read from `scope-sheet.ts` rather than typed here, so a screen claiming
   * they are platform-level is reading the platform's own list.
   */
  requiredFields: readonly string[];
  /** Every row key the renderer knows. A family may use any subset. */
  knownRows: readonly string[];
  /** Services subcategories with no family — B6's pressure to assign. */
  unassigned: { id: string; name: string; parent: string | null }[];
  /** How many services subcategories there are at all. */
  servicesSubcategories: number;
}

export async function scopeLibrary(): Promise<ScopeLibrary> {
  const [families, categories, services, businesses] = await Promise.all([
    prisma.scopeSheetFamily.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        position: true,
        isDefault: true,
        retiredAt: true,
        credentialKind: true,
        feeBases: { orderBy: { position: "asc" }, select: { key: true, label: true, position: true } },
        rows: {
          orderBy: { position: "asc" },
          select: { key: true, label: true, position: true, filterable: true },
        },
        common: { orderBy: { position: "asc" }, select: { name: true } },
        _count: { select: { categories: true, businesses: true, templates: true } },
      },
    }),
    prisma.category.findMany({
      select: { id: true, parentId: true, tradeKind: true, scopeFamilyId: true, name: true },
    }),
    /*
       Fee-basis usage and published-page counts, resolved per service rather
       than per family: a service's family comes from its own category's walk,
       so counting off `Category.scopeFamilyId` alone would miss every service
       whose subcategory inherits a family from an ancestor.
    */
    prisma.service.findMany({
      select: { categoryId: true, feeBasis: true, status: true, businessId: true },
    }),
    prisma.business.findMany({ select: { id: true, scopeSheetFamilyId: true } }),
  ]);

  const taxonomy = new Map<string, ScopeFamilyRow>(categories.map((row) => [row.id, row]));
  const kinds = new Map(categories.map((row) => [row.id, row]));
  const known = new Set(families.map((row) => row.id));
  const fallback = families.find((row) => row.isDefault)?.id ?? null;
  const chosenBy = new Map(businesses.map((row) => [row.id, row.scopeSheetFamilyId]));

  const familyOf = (service: { categoryId: string; businessId: string }): string | null => {
    const chosen = chosenBy.get(service.businessId);
    if (chosen && known.has(chosen)) return chosen;
    return resolveScopeFamily(taxonomy, service.categoryId) ?? fallback;
  };

  const feeUse = new Map<string, number>();
  const published = new Map<string, number>();
  for (const service of services) {
    const family = familyOf(service);
    if (!family) continue;
    if (service.feeBasis) {
      const key = `${family}:${service.feeBasis}`;
      feeUse.set(key, (feeUse.get(key) ?? 0) + 1);
    }
    if (service.status === "live") {
      published.set(family, (published.get(family) ?? 0) + 1);
    }
  }

  /*
     Services subcategories, from `4d-s`'s resolver rather than from a column:
     `Category.tradeKind` is null on almost every row, and the kind a leaf
     resolves to is the one an ancestor declared. The board's own 420 is this
     number in a tree where somebody has classified the taxonomy.
  */
  const parents = new Set(categories.map((row) => row.parentId).filter(Boolean) as string[]);
  const byId = new Map(categories.map((row) => [row.id, row]));
  const servicesLeaves = categories.filter(
    (row) => !parents.has(row.id) && resolveTradeKind(kinds as never, row.id) === "services",
  );

  return {
    families: families.map((family) => ({
      id: family.id,
      name: family.name,
      position: family.position,
      isDefault: family.isDefault,
      retiredAt: family.retiredAt,
      credentialKind: family.credentialKind,
      feeBases: family.feeBases.map((basis) => ({
        ...basis,
        usedBy: feeUse.get(`${family.id}:${basis.key}`) ?? 0,
      })),
      rows: family.rows,
      common: family.common.map((row) => row.name),
      subcategories: family._count.categories,
      businesses: family._count.businesses,
      templates: family._count.templates,
      publishedServices: published.get(family.id) ?? 0,
    })),
    requiredFields: REQUIRED_FIELDS,
    knownRows: ROW_KEYS,
    unassigned: servicesLeaves
      .filter((row) => row.scopeFamilyId === null)
      .map((row) => ({
        id: row.id,
        name: row.name,
        parent: row.parentId ? (byId.get(row.parentId)?.name ?? null) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    servicesSubcategories: servicesLeaves.length,
  };
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

export type LibraryResult = { ok: true } | { ok: false; reason: "not_found" | "unknown_family" };

/**
 * Assign one subcategory to one family — B5, AC5.
 *
 * Exactly one, enforced by the column being a single nullable foreign key
 * rather than a join table. Null is allowed back, because B6 makes null a real
 * state: the six required fields and the full fee-basis list, *usable and
 * noticeably worse, which is the intended pressure to assign.*
 */
export async function assignFamily(
  actor: Actor,
  categoryId: string,
  familyId: string | null,
  reason: string,
): Promise<LibraryResult> {
  if (familyId !== null) {
    const family = await prisma.scopeSheetFamily.count({ where: { id: familyId } });
    if (family === 0) return { ok: false, reason: "unknown_family" };
  }

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, scopeFamilyId: true },
  });
  if (!category) return { ok: false, reason: "not_found" };

  /*
     Through `staffMutation` — the repository's one sanctioned path for an
     audited staff change, and `CLAUDE.md` non-negotiable 3. The reason and the
     capability are both checked before a row moves, which matters here more
     than most: this changes which fee bases a whole trade is offered.
  */
  await staffMutation(
    {
      actor,
      capability: "taxonomy.write",
      subject: `Category:${category.id}`,
      reason,
    },
    async () => {
      await prisma.category.update({
        where: { id: category.id },
        data: { scopeFamilyId: familyId },
      });
      return {
        result: undefined,
        before: { scopeFamilyId: category.scopeFamilyId },
        after: { scopeFamilyId: familyId },
      };
    },
  );

  return { ok: true };
}

/**
 * Retire or restore a family — B8, AC8.
 *
 * Never a delete. Existing templates and services keep working and keep
 * rendering their scope tables; what stops is the family being offered to new
 * sellers. Deleting would take the comparison table off every published service
 * page in the family, which is why the column is a timestamp.
 */
export async function setFamilyRetired(
  actor: Actor,
  familyId: string,
  retired: boolean,
  reason: string,
): Promise<LibraryResult> {
  const family = await prisma.scopeSheetFamily.findUnique({
    where: { id: familyId },
    select: { id: true, retiredAt: true, isDefault: true },
  });
  if (!family) return { ok: false, reason: "not_found" };
  /*
     The fallback cannot be retired. It is what a null assignment resolves to,
     so retiring it would leave every unassigned subcategory with no family at
     all — and `familyFor` throws rather than rendering a fee-basis control with
     no options.
  */
  if (family.isDefault && retired) return { ok: false, reason: "not_found" };

  const retiredAt = retired ? new Date() : null;
  await staffMutation(
    { actor, capability: "taxonomy.write", subject: `ScopeSheetFamily:${family.id}`, reason },
    async () => {
      await prisma.scopeSheetFamily.update({
        where: { id: family.id },
        data: { retiredAt },
      });
      return {
        result: undefined,
        before: { retiredAt: family.retiredAt },
        after: { retiredAt },
      };
    },
  );

  return { ok: true };
}

export type FeeBasisResult =
  | { ok: true; flagged: number }
  | { ok: false; reason: "not_found" | "last_basis" };

/**
 * Remove one fee basis — B9, AC7.
 *
 * **Never silently clears.** Services holding the removed key keep their value
 * and are returned as a count, which the screen shows before and after: a
 * seller's fee basis is their statement about their own pricing, and tidying a
 * taxonomy is not a reason to unmake it. `3g-s` refuses the key on the *next*
 * save, which is where the seller is present to choose a replacement.
 *
 * The last basis cannot go. A family with none offers a seller an empty select,
 * which is board `3g-s`'s own empty-select defect arriving from the other side.
 */
export async function removeFeeBasis(
  actor: Actor,
  familyId: string,
  key: string,
  reason: string,
): Promise<FeeBasisResult> {
  const family = await prisma.scopeSheetFamily.findUnique({
    where: { id: familyId },
    select: { id: true, feeBases: { select: { key: true } } },
  });
  if (!family || !family.feeBases.some((basis) => basis.key === key)) {
    return { ok: false, reason: "not_found" };
  }
  if (family.feeBases.length <= 1) return { ok: false, reason: "last_basis" };

  const flagged = await prisma.service.count({
    where: { feeBasis: key, category: { scopeFamilyId: familyId } },
  });

  await staffMutation(
    { actor, capability: "taxonomy.write", subject: `ScopeSheetFamily:${familyId}`, reason },
    async () => {
      await prisma.scopeSheetFeeBasis.delete({ where: { familyId_key: { familyId, key } } });
      return { result: undefined, before: { feeBasis: key }, after: { removed: key, flagged } };
    },
  );

  return { ok: true, flagged };
}

export type AddFeeBasisResult = { ok: true } | { ok: false; reason: "not_found" | "duplicate" | "blank" };

export async function addFeeBasis(
  actor: Actor,
  familyId: string,
  key: string,
  label: string,
  reason: string,
): Promise<AddFeeBasisResult> {
  const cleanKey = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const cleanLabel = label.trim();
  if (cleanKey === "" || cleanLabel === "") return { ok: false, reason: "blank" };

  const family = await prisma.scopeSheetFamily.findUnique({
    where: { id: familyId },
    select: { id: true, feeBases: { select: { key: true, position: true } } },
  });
  if (!family) return { ok: false, reason: "not_found" };
  if (family.feeBases.some((basis) => basis.key === cleanKey)) {
    return { ok: false, reason: "duplicate" };
  }

  await staffMutation(
    { actor, capability: "taxonomy.write", subject: `ScopeSheetFamily:${familyId}`, reason },
    async () => {
      await prisma.scopeSheetFeeBasis.create({
        data: {
          familyId,
          key: cleanKey,
          label: cleanLabel.slice(0, 60),
          position: family.feeBases.reduce((max, basis) => Math.max(max, basis.position), -1) + 1,
        },
      });
      return { result: undefined, before: null, after: { key: cleanKey, label: cleanLabel } };
    },
  );

  return { ok: true };
}

export type RowOrderResult = { ok: true; affected: number } | { ok: false; reason: "not_found" };

/**
 * Reorder a family's public rows — B7, AC6.
 *
 * `1g-s` renders in this order, so **changing it changes every published
 * service page in the family**. The count comes back with the result and the
 * screen states it before the save as well as after, because a reorder that
 * quietly reshapes two hundred buyer-facing tables is the kind of change an
 * admin should be made to look at.
 */
export async function saveRowOrder(
  actor: Actor,
  familyId: string,
  keys: readonly string[],
  reason: string,
): Promise<RowOrderResult> {
  const family = await prisma.scopeSheetFamily.findUnique({
    where: { id: familyId },
    select: { id: true, rows: { select: { key: true, position: true } } },
  });
  if (!family) return { ok: false, reason: "not_found" };

  const held = new Set(family.rows.map((row) => row.key));
  const ordered = keys.filter((key) => held.has(key));
  // Anything the caller left out keeps its relative order behind the rest, so a
  // stale form cannot drop a row from a family by omission.
  const rest = family.rows
    .filter((row) => !ordered.includes(row.key))
    .sort((a, b) => a.position - b.position)
    .map((row) => row.key);

  const next = [...ordered, ...rest];
  const was = [...family.rows].sort((a, b) => a.position - b.position).map((row) => row.key);
  const affected = await prisma.service.count({
    where: { status: "live", category: { scopeFamilyId: familyId } },
  });

  await staffMutation(
    { actor, capability: "taxonomy.write", subject: `ScopeSheetFamily:${familyId}`, reason },
    async () => {
      for (const [index, key] of next.entries()) {
        await prisma.scopeSheetRow.update({
          where: { familyId_key: { familyId, key } },
          data: { position: index },
        });
      }
      return { result: undefined, before: { order: was }, after: { order: next, affected } };
    },
  );

  return { ok: true, affected };
}
