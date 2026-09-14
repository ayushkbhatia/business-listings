import "server-only";
import { recordCapRefused } from "@/lib/accounts/cap-events";
import { prisma } from "@/lib/db/client";
import { assertCanEditProduct } from "@/lib/auth/guards";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { PLAN_SELECT } from "./plan-select";
import { resolveScopeFamily, type ScopeFamilyRow } from "./family";
import { completeness, uniqueServiceSlug } from "./scope-sheet";
import { NAME_MAX, familyFor, type ScopeFamily } from "./service";
import {
  matchSheets,
  sheetShape,
  taskCount,
  type CountableService,
  type SheetShape,
  type TaskCount,
} from "./setup-sheet";
import { SERVICES_TARGET } from "@/lib/metrics/profile-strength";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board `8c-s` — setup task 2, against a database.
 *
 * The capability is `product.edit`, the same one `3f-s` and `3g-s` use and the
 * one board 7d granted for "Edit products & specs". A service is what a product
 * is for a firm that sells work; a new capability would be one the permissions
 * board never granted.
 *
 * ## Step 1 gates step 2, and the gate is the data
 *
 * B1: *step 2 is inert until a sheet is chosen*. That is enforced by
 * `chosenFamilyId` being null rather than by a disabled attribute — the writes
 * refuse too, so a seller who finds the form another way gets the same answer
 * the screen gives. The sheet determines which rows exist, and a service added
 * before one is picked has nowhere to put its values.
 */

export interface SheetCard {
  id: string;
  name: string;
  shape: SheetShape;
  /** Null for the sheets nothing matched. Rank 0 is the strongest. */
  matchRank: number | null;
  /** The services a firm in this trade usually sells — the B8 seed list. */
  common: string[];
  isDefault: boolean;
  chosen: boolean;
}

export interface SetupServiceRow {
  id: string;
  name: string;
  slug: string;
  engagementType: string | null;
  feeBasis: string | null;
  feeBasisLabel: string | null;
  turnaround: string | null;
  live: boolean;
  filled: number;
  total: number;
  counts: boolean;
}

export interface SetupServicesState {
  businessId: string;
  /** Null until step 1 is done. Everything about step 2 keys off this. */
  chosenFamilyId: string | null;
  /** The family the services actually resolve to, chosen or inherited. */
  family: ScopeFamily;
  sheets: SheetCard[];
  rows: SetupServiceRow[];
  task: TaskCount;
  target: number;
  /** `2 of 3 services used on Free`, so the screen never offers a row it cannot save. */
  allowance: ReturnType<typeof allowance>;
  planName: string;
}

/**
 * Everything the screen renders, in one read.
 *
 * The counts on the sheet cards are queried rather than typed — `CLAUDE.md`,
 * *every number is a query, not a constant*. The board's card draws `12 fields ·
 * 6 required · 5 filterable · used by 214 firms` and three of those four are
 * wrong against this tree, which is why none of them is written down here.
 */
export async function setupServicesStateFor(
  businessId: string,
): Promise<SetupServicesState | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      primaryCategoryId: true,
      scopeSheetFamilyId: true,
      servicesOffered: true,
    },
  });
  if (!business) return null;

  const [families, categories, businesses, services, caps] = await Promise.all([
    prisma.scopeSheetFamily.findMany({
      /*
         Board `4e-s` Q1, and the only open decision on that board: the
         subcategory fixes the family and the seller picks within it, so the
         assigned one leads and the rest follow. A marine surveyor filed under
         Inspection & certification should not find *per container* above the
         fold.

         Retired families are absent entirely — `4e-s` B8 and the `3h-s`
         retirement rule: existing work keeps working, and nobody new is offered
         it. A seller who has already chosen one keeps seeing it, because
         `chosen` is added back below.
      */
      where: {
        OR: [{ retiredAt: null }, { id: business.scopeSheetFamilyId ?? "" }],
      },
      orderBy: [{ position: "asc" }, { isDefault: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        isDefault: true,
        rows: { select: { filterable: true } },
        common: { orderBy: { position: "asc" }, select: { name: true } },
      },
    }),
    prisma.category.findMany({
      select: { id: true, parentId: true, scopeFamilyId: true },
    }),
    /*
       Firms on each sheet, for `used by N firms` — B3, AC2.

       Chosen **or inherited**: a firm whose subcategory names a family is on
       that sheet whether or not it has been to this screen, and counting only
       the explicit choices would read zero on every card in a directory where
       nobody has visited it yet.

       **Sellers of work only.** Counting every listing put 176 valve traders on
       the blank sheet, because an unclassified category resolves to the default
       — a number that is arithmetically true and answers a question nobody
       asked. "Which sheet are my peers on" means firms that sell work, and a
       seller comparing two cards would have read the padding as evidence.
    */
    prisma.business.findMany({
      where: {
        suspendedAt: null,
        mergedIntoId: null,
        publishedAt: { not: null },
        sellsKind: { in: ["services", "both"] },
      },
      select: { scopeSheetFamilyId: true, primaryCategoryId: true },
    }),
    prisma.service.findMany({
      where: { businessId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        engagementType: true,
        feeBasis: true,
        turnaround: true,
        deliveredWhere: true,
        deliverable: true,
        status: true,
      },
    }),
    effectiveFor(businessId),
  ]);

  const taxonomy = new Map<string, ScopeFamilyRow>(
    categories.map((row) => [row.id, row]),
  );
  const known = new Set(families.map((row) => row.id));
  const fallback = families.find((row) => row.isDefault)?.id ?? null;

  const usedBy = new Map<string, number>();
  for (const row of businesses) {
    const chosen = row.scopeSheetFamilyId;
    const resolved =
      (chosen && known.has(chosen) ? chosen : null) ??
      resolveScopeFamily(taxonomy, row.primaryCategoryId) ??
      fallback;
    if (resolved) usedBy.set(resolved, (usedBy.get(resolved) ?? 0) + 1);
  }

  const matches = matchSheets(
    families.map((row) => ({
      id: row.id,
      name: row.name,
      common: row.common.map((one) => one.name),
    })),
    business.servicesOffered,
  );
  const rank = new Map(matches.map((row, index) => [row.id, index]));

  const family = await familyFor(
    business.primaryCategoryId,
    business.scopeSheetFamilyId,
  );
  const labels = new Map(family.feeBases.map((row) => [row.key, row.label]));

  const countable: CountableService[] = services.map((row) => ({
    id: row.id,
    live: row.status === "live",
    name: row.name,
    engagementType: row.engagementType,
    feeBasis: row.feeBasis,
    turnaround: row.turnaround,
    deliveredWhere: row.deliveredWhere,
    deliverable: row.deliverable,
  }));
  const task = taskCount(countable, SERVICES_TARGET);
  const thin = new Set(task.thin.map((row) => row.id));

  const plan =
    caps ??
    ((await prisma.plan.findUnique({
      where: { id: "free" },
      select: PLAN_SELECT,
    })) as PlanCaps | null);

  /*
     `4e-s` Q1. The subcategory's own family leads, then the rest by the
     library's order. Sorting is here rather than in the query because the
     assigned family is resolved by a walk the database cannot order on.
  */
  const assigned = resolveScopeFamily(taxonomy, business.primaryCategoryId);
  const lead = business.scopeSheetFamilyId ?? assigned;

  return {
    businessId: business.id,
    chosenFamilyId: business.scopeSheetFamilyId,
    family,
    sheets: families
      .slice()
      .sort((a, b) => Number(b.id === lead) - Number(a.id === lead))
      .map((row) => ({
        id: row.id,
        name: row.name,
        shape: sheetShape(row.rows, usedBy.get(row.id) ?? 0),
        matchRank: rank.get(row.id) ?? null,
        common: row.common.map((one) => one.name),
        isDefault: row.isDefault,
        chosen: row.id === business.scopeSheetFamilyId,
      })),
    rows: services.map((row, index) => {
      const score = completeness(countable[index]!);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        engagementType: row.engagementType,
        feeBasis: row.feeBasis,
        feeBasisLabel:
          row.feeBasis === null ? null : (labels.get(row.feeBasis) ?? null),
        turnaround: row.turnaround,
        live: row.status === "live",
        filled: score.filled,
        total: score.total,
        /* Live and not on the thin list. Both halves — B4. */
        counts: row.status === "live" && !thin.has(row.id),
      };
    }),
    task,
    target: SERVICES_TARGET,
    /*
       A missing plan row cannot cap anything, and a screen that refused to add
       a service because the seed is incomplete would be blaming the seller for
       an environment. `3f-s` makes the same call one screen over.
    */
    allowance: allowance(plan ?? UNCAPPED, "services", services.length),
    planName: plan?.name ?? "",
  };
}

/** What `allowance` is handed when no plan row exists. Caps nothing. */
const UNCAPPED = { serviceLimit: null } as unknown as PlanCaps;

/* ── Step 1 · choosing ───────────────────────────────────────────────────── */

export type ChooseResult =
  | { ok: true; familyId: string }
  | { ok: false; reason: "not_found" | "unknown_sheet" };

/**
 * Pick the sheet — B1.
 *
 * One column, and no cascade: **services keep their values**. The board's own
 * §States says so — *"fields not present on the new sheet are retained but
 * unrendered, and fee basis is revalidated per `3g-s` B2"* — and the reason is
 * that a seller correcting a wrong first choice must not lose the afternoon
 * they spent typing. A fee basis the new family does not define stops
 * rendering a label and the editor refuses to keep it on the next save, which
 * is `3g-s`'s existing rule doing its own job.
 */
export async function chooseScopeSheet(
  actor: Actor,
  businessId: string,
  familyId: string,
): Promise<ChooseResult> {
  assertCanEditProduct(actor);

  const family = await prisma.scopeSheetFamily.findUnique({
    where: { id: familyId },
    select: { id: true },
  });
  if (!family) return { ok: false, reason: "unknown_sheet" };

  const { count } = await prisma.business.updateMany({
    where: { id: businessId },
    data: { scopeSheetFamilyId: family.id },
  });
  return count > 0
    ? { ok: true, familyId: family.id }
    : { ok: false, reason: "not_found" };
}

/* ── Step 2 · the rows ───────────────────────────────────────────────────── */

export type SeedResult =
  | { ok: true; created: number; skipped: number }
  | {
      ok: false;
      reason: "no_sheet" | "not_found" | "at_cap";
      cap?: number;
      planName?: string;
    };

/**
 * *Start from our audit-firm list* — B8, AC8.
 *
 * **Drafts, and names only.** `3g-s` B6 and `3h-s` both refuse to template
 * `scope` and `excluded`, because a pre-filled exclusions line is the one that
 * ends up in a dispute — and an engagement type or a turnaround would be the
 * same mistake one field over. Both are claims about how *this* firm works, and
 * a seeded claim is a claim the seller never made. What the list saves is the
 * blank-page problem, which is all it should save.
 *
 * Names the seller already has are skipped rather than duplicated, so pressing
 * it twice is a no-op rather than six more rows. The plan cap is honoured and
 * the seeding stops at it rather than refusing the lot: a Free seller at three
 * of three gets three rows, not an error about the fourth.
 */
export async function seedFromCommonServices(
  actor: Actor,
  businessId: string,
): Promise<SeedResult> {
  assertCanEditProduct(actor);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { primaryCategoryId: true, scopeSheetFamilyId: true },
  });
  if (!business) return { ok: false, reason: "not_found" };
  if (business.scopeSheetFamilyId === null)
    return { ok: false, reason: "no_sheet" };

  const [common, existing, caps] = await Promise.all([
    prisma.scopeSheetCommonService.findMany({
      where: { familyId: business.scopeSheetFamilyId },
      orderBy: { position: "asc" },
      select: { name: true },
    }),
    prisma.service.findMany({
      where: { businessId },
      select: { name: true, slug: true, position: true },
    }),
    effectiveFor(businessId),
  ]);

  const plan =
    caps ??
    ((await prisma.plan.findUnique({
      where: { id: "free" },
      select: PLAN_SELECT,
    })) as PlanCaps | null);

  const taken = new Set(existing.map((row) => row.name.trim().toLowerCase()));
  const slugs = existing.map((row) => row.slug);
  let position = existing.reduce((max, row) => Math.max(max, row.position), -1);

  let created = 0;
  let skipped = 0;
  for (const row of common) {
    if (taken.has(row.name.trim().toLowerCase())) {
      skipped += 1;
      continue;
    }
    if (plan && allowance(plan, "services", existing.length + created).atCap) {
      const refused = common.length - created - skipped;
      skipped += refused;
      // Board 4f B6: the rows the ceiling refused, not the duplicates above.
      await recordCapRefused({
        kind: "services",
        businessId,
        actorId: actor.id,
        plan: plan.name,
        cap: allowance(plan, "services", existing.length + created).cap ?? 0,
        attempted: refused,
        surface: "common_services",
      });
      break;
    }

    position += 1;
    const slug = uniqueServiceSlug(row.name, slugs);
    slugs.push(slug);
    const service = await prisma.service.create({
      data: {
        businessId,
        categoryId: business.primaryCategoryId,
        name: row.name.slice(0, NAME_MAX),
        slug,
        position,
        // Draft, and nothing else set. See the docblock.
      },
      select: { id: true },
    });
    await prisma.serviceRevision.create({
      data: {
        serviceId: service.id,
        actorId: actor.id,
        field: "created",
        before: null,
        after: row.name,
      },
    });
    created += 1;
  }

  if (created === 0 && skipped === 0) {
    return { ok: false, reason: "no_sheet" };
  }
  return { ok: true, created, skipped };
}
