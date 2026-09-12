import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanEditProduct } from "@/lib/auth/guards";
import { allowance, cheapestPlanUnlocking, type PlanCaps } from "@/lib/plan/entitlements";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { PLAN_SELECT } from "./plan-select";
import type { Actor } from "@/lib/auth/roles";
import type {
  DeliveredWhere,
  EngagementType,
  ServiceStatus,
} from "@/lib/db/generated/enums";
import { resolveScopeFamily, type ScopeFamilyRow } from "./family";
import {
  OPTIONAL_FIELD_KEYS,
  ROW_KEYS,
  completeness,
  isDeliveredWhere,
  isEngagementType,
  isOptionalFieldKey,
  scopeRows,
  uniqueServiceSlug,
  type Completeness,
  type FamilyRow,
  type OptionalFieldKey,
  type RowKey,
  type ScopeRow,
} from "./scope-sheet";

/**
 * The scope sheet against a database — boards `3g-s`, `3f-s`, `1g-s`.
 *
 * Three screens and one record. The editor writes it, the list counts it, and
 * the public page renders it, so every one of them reads its completeness from
 * `completeness()` in `./scope-sheet.ts` rather than counting for itself —
 * `3f-s` B2, "one implementation, two call sites", and there are three.
 *
 * ## Capability
 *
 * `product.edit`, and deliberately not a new `service.edit`. Board 7d's
 * permission table grants "Edit products & specs" to the owner and the manager,
 * and a service is what a product is for a firm that sells work — the same
 * people doing the same job on the same listing. A new capability would be one
 * the permissions board never granted, and `lib/auth/capabilities.ts` asks
 * every entry to name the board it came from.
 *
 * ## Every mutation takes the business from the seat
 *
 * Never from a form value, and every write is scoped by it. A `updateMany` with
 * both ids in the `where` is what enforces it: a row that is not theirs matches
 * nothing and reports `not_found` rather than being silently written.
 */

/* ── The family ──────────────────────────────────────────────────────────── */

export interface ScopeFamily {
  id: string;
  name: string;
  /** In the order the editor offers them. */
  feeBases: { key: string; label: string }[];
  rows: FamilyRow[];
}

/**
 * The family a category resolves to, with its fee bases and its row order.
 *
 * Two queries and no more, however many categories are asked about: the
 * taxonomy is 440 rows of three columns and the families are three rows with
 * their children. `resolveTradeKind` made the same trade for the same reason.
 */
export async function familyFor(categoryId: string): Promise<ScopeFamily> {
  const [categories, families] = await Promise.all([
    prisma.category.findMany({ select: { id: true, parentId: true, scopeFamilyId: true } }),
    prisma.scopeSheetFamily.findMany({
      select: {
        id: true,
        name: true,
        isDefault: true,
        feeBases: { orderBy: { position: "asc" }, select: { key: true, label: true } },
        rows: {
          orderBy: { position: "asc" },
          select: { key: true, label: true, position: true, filterable: true },
        },
      },
    }),
  ]);

  const rows = new Map<string, ScopeFamilyRow>(categories.map((row) => [row.id, row]));
  const wanted = resolveScopeFamily(rows, categoryId);

  /*
     The seeded default, and a hard failure if it is missing.

     Falling back to an empty family would render a fee-basis control with no
     options and a scope table with no rows, which reads as a broken screen
     rather than as a missing seed — and the partial unique index means there is
     never more than one to choose between.
  */
  const family =
    (wanted ? families.find((row) => row.id === wanted) : undefined) ??
    families.find((row) => row.isDefault);
  if (!family) {
    throw new Error(
      "No default scope-sheet family. Migration 20261004090000_service_scope_sheet seeds one.",
    );
  }

  return {
    id: family.id,
    name: family.name,
    feeBases: family.feeBases.map((row) => ({ key: row.key, label: row.label })),
    rows: family.rows,
  };
}

/* ── What the list reads — board `3f-s` ──────────────────────────────────── */

export interface ServiceRow {
  id: string;
  name: string;
  slug: string;
  engagementType: EngagementType | null;
  feeBasis: string | null;
  /** The family's own label for the stored key, or null where it has none. */
  feeBasisLabel: string | null;
  turnaround: string | null;
  status: ServiceStatus;
  position: number;
  completeness: Completeness;
}

export interface ServicesBoard {
  businessId: string;
  rows: ServiceRow[];
  live: number;
  draft: number;
  /** `2 of 3 services used on Free`, and the plan that raises it. */
  allowance: ReturnType<typeof allowance>;
  planName: string;
  upgrade: { planName: string; cap: number | null } | null;
  /** The lowest-scoring live row, for the line under the table — `3f-s` Q1. */
  worst: { name: string; completeness: Completeness } | null;
}

/** Everything board `3f-s` renders, in one read. */
export async function servicesBoardFor(businessId: string): Promise<ServicesBoard> {
  const [services, caps, plans] = await Promise.all([
    prisma.service.findMany({
      where: { businessId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        categoryId: true,
        engagementType: true,
        feeBasis: true,
        turnaround: true,
        deliveredWhere: true,
        deliverable: true,
        status: true,
        position: true,
      },
    }),
    effectiveFor(businessId),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: PLAN_SELECT }),
  ]);

  /*
     One family lookup per distinct category, not per row.

     A firm's six services are usually in one or two trades, and the fee-basis
     label has to come from the family that defines it — a key rendered raw
     (`per_sqft_yr`) on a screen a seller reads is the label not existing.
  */
  const families = new Map<string, ScopeFamily>();
  for (const categoryId of new Set(services.map((row) => row.categoryId))) {
    families.set(categoryId, await familyFor(categoryId));
  }

  const rows: ServiceRow[] = services.map((service) => {
    const family = families.get(service.categoryId);
    return {
      id: service.id,
      name: service.name,
      slug: service.slug,
      engagementType: service.engagementType,
      feeBasis: service.feeBasis,
      feeBasisLabel:
        family?.feeBases.find((basis) => basis.key === service.feeBasis)?.label ?? null,
      turnaround: service.turnaround,
      status: service.status,
      position: service.position,
      completeness: completeness(service),
    };
  });

  /*
     A business with no plan row is on Free until the plan step says otherwise —
     the funnel's criterion 3, where a listing goes live before anybody is asked
     for money. Read rather than assumed, so the cap and the name on the counter
     come from the same row the rest of the product bills against.
  */
  const plan: PlanCaps =
    caps ?? ((plans.find((row) => row.id === "free") ?? plans[0]) as PlanCaps);

  const used = rows.length;
  const better = cheapestPlanUnlocking(plans as PlanCaps[], "services", used, plan.id);

  /*
     The lowest live row, named — board `3f-s` Q1. "Chiller overhaul is at 4 of
     6" is actionable; "2 services incomplete" is a nag. Drafts are excluded:
     a draft is unfinished by definition and saying so is not information.
  */
  const worst = rows
    .filter((row) => row.status === "live" && row.completeness.missing.length > 0)
    .sort((a, b) => a.completeness.filled - b.completeness.filled || a.position - b.position)[0];

  return {
    businessId,
    rows,
    live: rows.filter((row) => row.status === "live").length,
    draft: rows.filter((row) => row.status === "draft").length,
    allowance: allowance(plan, "services", used),
    planName: plan.name,
    upgrade: better ? { planName: better.name, cap: better.serviceLimit } : null,
    worst: worst ? { name: worst.name, completeness: worst.completeness } : null,
  };
}

/* ── What the editor reads — board `3g-s` ────────────────────────────────── */

export interface ServiceEditorState {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  engagementType: EngagementType | null;
  feeBasis: string | null;
  turnaround: string | null;
  deliveredWhere: DeliveredWhere | null;
  deliverable: string | null;
  scope: string | null;
  excluded: string | null;
  indicativeFee: string | null;
  status: ServiceStatus;
  optional: Record<OptionalFieldKey, string>;
  family: ScopeFamily;
  completeness: Completeness;
  /**
   * Set when the stored fee basis is not one this family offers.
   *
   * The state a category move produces — `3g-s` §States: "an invalid value
   * clears the field and flags it in the sidebar rather than guessing a
   * mapping". Guessing is the tempting half: `per_visit` exists in both
   * families here and would map cleanly, and the next pair would not.
   */
  feeBasisStale: boolean;
  revisions: { field: string; before: string | null; after: string | null; at: Date; actor: string }[];
  savedAt: Date;
}

const EDITOR_SELECT = {
  id: true,
  businessId: true,
  name: true,
  slug: true,
  categoryId: true,
  engagementType: true,
  feeBasis: true,
  turnaround: true,
  deliveredWhere: true,
  deliverable: true,
  scope: true,
  excluded: true,
  indicativeFee: true,
  status: true,
  updatedAt: true,
  category: { select: { name: true } },
  values: { select: { fieldKey: true, value: true } },
} as const;

/** One service, for its editor. Scoped to the seat's own business. */
export async function serviceForEditor(
  businessId: string,
  serviceId: string,
): Promise<ServiceEditorState | null> {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId },
    select: EDITOR_SELECT,
  });
  if (!service) return null;

  const [family, revisions] = await Promise.all([
    familyFor(service.categoryId),
    prisma.serviceRevision.findMany({
      where: { serviceId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        field: true,
        before: true,
        after: true,
        createdAt: true,
        actor: { select: { fullName: true, email: true } },
      },
    }),
  ]);

  const optional = Object.fromEntries(
    OPTIONAL_FIELD_KEYS.map((key) => [key, ""]),
  ) as Record<OptionalFieldKey, string>;
  for (const row of service.values) {
    if (isOptionalFieldKey(row.fieldKey)) optional[row.fieldKey] = row.value;
  }

  return {
    id: service.id,
    businessId: service.businessId,
    name: service.name,
    slug: service.slug,
    categoryId: service.categoryId,
    categoryName: service.category.name,
    engagementType: service.engagementType,
    feeBasis: service.feeBasis,
    turnaround: service.turnaround,
    deliveredWhere: service.deliveredWhere,
    deliverable: service.deliverable,
    scope: service.scope,
    excluded: service.excluded,
    indicativeFee: service.indicativeFee,
    status: service.status,
    optional,
    family,
    completeness: completeness(service),
    feeBasisStale:
      service.feeBasis !== null &&
      !family.feeBases.some((basis) => basis.key === service.feeBasis),
    revisions: revisions.map((row) => ({
      field: row.field,
      before: row.before,
      after: row.after,
      at: row.createdAt,
      actor: row.actor.fullName ?? row.actor.email ?? "—",
    })),
    savedAt: service.updatedAt,
  };
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

export const EDITABLE_FIELDS = [
  "name",
  "engagementType",
  "feeBasis",
  "turnaround",
  "deliveredWhere",
  "deliverable",
  "scope",
  "excluded",
  "indicativeFee",
  ...OPTIONAL_FIELD_KEYS,
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export function isEditableField(value: string): value is EditableField {
  return (EDITABLE_FIELDS as readonly string[]).includes(value);
}

export type ServiceWrite =
  | { ok: true; savedAt: Date; completeness: Completeness }
  | {
      ok: false;
      reason: "not_found" | "name_required" | "unknown_value" | "foreign_fee_basis";
    };

/** Longest a free-text field may be. Guidance on scope, a stop everywhere. */
export const TEXT_MAX = 4000;
export const NAME_MAX = 90;

/**
 * One field of one service — board `3g-s` B1, the `2c-s` autosave contract.
 *
 * Patches what changed and nothing else, so two open tabs cannot have one post
 * its stale copy of the other's work over the top. Every call writes a
 * `ServiceRevision` with the old value and the new one, which is B9 and
 * criterion 7 — and it is written here rather than in the screen, so a second
 * caller cannot forget.
 */
export async function patchServiceField(
  actor: Actor,
  businessId: string,
  serviceId: string,
  field: EditableField,
  raw: string,
): Promise<ServiceWrite> {
  assertCanEditProduct(actor);

  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId },
    select: {
      id: true,
      categoryId: true,
      name: true,
      engagementType: true,
      feeBasis: true,
      turnaround: true,
      deliveredWhere: true,
      deliverable: true,
      scope: true,
      excluded: true,
      indicativeFee: true,
      values: { select: { fieldKey: true, value: true } },
    },
  });
  if (!service) return { ok: false, reason: "not_found" };

  const value = raw.trim().slice(0, TEXT_MAX);

  if (isOptionalFieldKey(field)) {
    const before = service.values.find((row) => row.fieldKey === field)?.value ?? null;
    if (value === "") {
      await prisma.scopeFieldValue.deleteMany({ where: { serviceId, fieldKey: field } });
    } else {
      await prisma.scopeFieldValue.upsert({
        where: { serviceId_fieldKey: { serviceId, fieldKey: field } },
        create: { serviceId, fieldKey: field, value },
        update: { value },
      });
    }
    await logChange(actor, serviceId, field, before, value === "" ? null : value);
    return done(serviceId);
  }

  if (field === "name") {
    /*
       The one required field with no empty state to design. A service with no
       name is a row nobody can pick out of a list of six, and the slug — which
       is a live URL — was derived from it.
    */
    if (value === "") return { ok: false, reason: "name_required" };
    return write(actor, serviceId, field, service.name, value.slice(0, NAME_MAX), {
      name: value.slice(0, NAME_MAX),
    });
  }

  if (field === "engagementType") {
    if (value !== "" && !isEngagementType(value)) return { ok: false, reason: "unknown_value" };
    return write(actor, serviceId, field, service.engagementType, value || null, {
      engagementType: value === "" ? null : (value as EngagementType),
    });
  }

  if (field === "deliveredWhere") {
    if (value !== "" && !isDeliveredWhere(value)) return { ok: false, reason: "unknown_value" };
    return write(actor, serviceId, field, service.deliveredWhere, value || null, {
      deliveredWhere: value === "" ? null : (value as DeliveredWhere),
    });
  }

  if (field === "feeBasis") {
    /*
       Board `3g-s` B2, and the single most important check on this screen.

       Validated against **this service's family**, never a global list. A value
       from another family is refused rather than saved, because the label it
       would render under does not exist here — a facilities-management firm
       storing `per_sqft_yr` in an audit family gets a raw key on their own
       public page and a facet that matches nothing.
    */
    if (value !== "") {
      const family = await familyFor(service.categoryId);
      if (!family.feeBases.some((basis) => basis.key === value)) {
        return { ok: false, reason: "foreign_fee_basis" };
      }
    }
    return write(actor, serviceId, field, service.feeBasis, value || null, {
      feeBasis: value || null,
    });
  }

  const before = service[field];
  return write(actor, serviceId, field, before, value || null, { [field]: value || null });
}

async function write(
  actor: Actor,
  serviceId: string,
  field: string,
  before: string | null,
  after: string | null,
  data: Record<string, unknown>,
): Promise<ServiceWrite> {
  await prisma.service.update({ where: { id: serviceId }, data });
  await logChange(actor, serviceId, field, before, after);
  return done(serviceId);
}

/**
 * Board `3g-s` B9 — field, old value, new value, actor, timestamp.
 *
 * Written from the service layer rather than the screen, so there is no second
 * caller to forget it. A change that writes no row is a change support cannot
 * answer a question about, and "when did their turnaround change" is the
 * question this table exists for.
 *
 * A no-op change writes nothing. A seller who clicks into a field and out again
 * has changed nothing, and a log full of those is a log nobody reads.
 */
async function logChange(
  actor: Actor,
  serviceId: string,
  field: string,
  before: string | null,
  after: string | null,
): Promise<void> {
  if ((before ?? null) === (after ?? null)) return;
  await prisma.serviceRevision.create({
    data: { serviceId, actorId: actor.id, field, before, after },
  });
}

async function done(serviceId: string): Promise<ServiceWrite> {
  const row = await prisma.service.findUniqueOrThrow({
    where: { id: serviceId },
    select: {
      updatedAt: true,
      name: true,
      engagementType: true,
      feeBasis: true,
      turnaround: true,
      deliveredWhere: true,
      deliverable: true,
    },
  });
  return { ok: true, savedAt: row.updatedAt, completeness: completeness(row) };
}

/* ── Creating, publishing, ordering, removing ────────────────────────────── */

export type CreateResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; reason: "at_cap" | "no_category"; cap?: number; planName?: string };

/**
 * A new service, in the business's primary trade and as a draft.
 *
 * Capped by `Plan.serviceLimit` — board `2e-s`, and the cap is checked here
 * rather than only on the screen because a server action is a URL. The refusal
 * names the plan and the number, so a seller reads the same sentence the button
 * they could not press was going to show them.
 */
export async function createService(
  actor: Actor,
  businessId: string,
  name: string,
): Promise<CreateResult> {
  assertCanEditProduct(actor);

  const [business, caps, existing] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { primaryCategoryId: true },
    }),
    effectiveFor(businessId),
    prisma.service.findMany({
      where: { businessId },
      select: { slug: true, position: true },
    }),
  ]);
  if (!business) return { ok: false, reason: "no_category" };

  const plan =
    caps ??
    ((await prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT })) as
      | PlanCaps
      | null);
  if (plan) {
    const room = allowance(plan, "services", existing.length);
    if (room.atCap) {
      return { ok: false, reason: "at_cap", cap: room.cap ?? 0, planName: plan.name };
    }
  }

  const trimmed = name.trim().slice(0, NAME_MAX);
  const service = await prisma.service.create({
    data: {
      businessId,
      categoryId: business.primaryCategoryId,
      name: trimmed === "" ? "Untitled service" : trimmed,
      slug: uniqueServiceSlug(
        trimmed === "" ? "service" : trimmed,
        existing.map((row) => row.slug),
      ),
      position: existing.reduce((max, row) => Math.max(max, row.position), -1) + 1,
    },
    select: { id: true, slug: true },
  });

  await prisma.serviceRevision.create({
    data: { serviceId: service.id, actorId: actor.id, field: "created", before: null, after: trimmed || null },
  });

  return { ok: true, id: service.id, slug: service.slug };
}

export type PublishResult = { ok: true; changed: number } | { ok: false; reason: "not_found" };

/**
 * Publish or unpublish, one row or several — board `3f-s` B3, B4.
 *
 * **No completeness gate, here or anywhere.** Six required fields make a sheet
 * complete, not publishable; a gate turns the score into a hurdle and the
 * predictable result is sellers typing "TBC" into six fields to clear it. The
 * screen's job is to make the cost legible, not to withhold the feature.
 *
 * `publishedAt` is stamped once and never cleared, the same rule `Location`
 * follows: a service that has been live once has made a claim to buyers, and
 * unpublishing does not un-make it.
 */
export async function setServiceStatus(
  actor: Actor,
  businessId: string,
  serviceIds: readonly string[],
  status: ServiceStatus,
): Promise<PublishResult> {
  assertCanEditProduct(actor);
  if (serviceIds.length === 0) return { ok: true, changed: 0 };

  const rows = await prisma.service.findMany({
    where: { id: { in: [...serviceIds] }, businessId },
    select: { id: true, status: true, publishedAt: true },
  });
  const moving = rows.filter((row) => row.status !== status);
  if (moving.length === 0) return { ok: true, changed: 0 };

  await prisma.$transaction([
    prisma.service.updateMany({
      where: { id: { in: moving.map((row) => row.id) }, businessId },
      data: {
        status,
        ...(status === "live" ? { publishedAt: new Date() } : {}),
      },
    }),
    prisma.serviceRevision.createMany({
      data: moving.map((row) => ({
        serviceId: row.id,
        actorId: actor.id,
        field: "status",
        before: row.status,
        after: status,
      })),
    }),
  ]);

  /*
     `publishedAt` only on the first publish. `updateMany` above sets it on
     every row moving to live, which would move the date each time — so the ones
     that already had one are put back. Two statements rather than a loop of
     single updates, because the common case is a bulk action over six rows.
  */
  const alreadyPublished = moving.filter((row) => row.publishedAt !== null);
  await Promise.all(
    alreadyPublished.map((row) =>
      prisma.service.update({ where: { id: row.id }, data: { publishedAt: row.publishedAt } }),
    ),
  );

  return { ok: true, changed: moving.length };
}

/**
 * The seller's own order — board `3f-s` B5.
 *
 * It drives the public catalogue, so a seller leading with their best work is
 * the point rather than a convenience. Positions are rewritten from the given
 * order and anything the caller omitted keeps its place at the end, so a stale
 * tab cannot reshuffle rows it has never seen.
 */
export async function reorderServices(
  actor: Actor,
  businessId: string,
  orderedIds: readonly string[],
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  assertCanEditProduct(actor);

  const rows = await prisma.service.findMany({
    where: { businessId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const known = new Set(rows.map((row) => row.id));
  const wanted = orderedIds.filter((id) => known.has(id));
  if (wanted.length === 0) return { ok: false, reason: "not_found" };

  const rest = rows.map((row) => row.id).filter((id) => !wanted.includes(id));
  const order = [...wanted, ...rest];

  await prisma.$transaction(
    order.map((id, index) =>
      prisma.service.update({ where: { id }, data: { position: index } }),
    ),
  );
  return { ok: true };
}

/**
 * One service, removed — and one at a time, with a confirmation on the screen.
 *
 * Board `3f-s` Q2 refuses bulk delete and the reason is not caution for its own
 * sake: enquiry history hangs off these rows, and a two-click gesture that
 * removes six of them removes the record of six conversations.
 */
export async function deleteService(
  actor: Actor,
  businessId: string,
  serviceId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  assertCanEditProduct(actor);
  const { count } = await prisma.service.deleteMany({ where: { id: serviceId, businessId } });
  return count === 0 ? { ok: false, reason: "not_found" } : { ok: true };
}

/* ── What the buyer reads — board `1g-s` ─────────────────────────────────── */

/**
 * The public shape, and `indicativeFee` is **not on it**.
 *
 * Board `3g-s` B5 and `1g-s` B3: it is the one field where a leak is a
 * commercial problem rather than a bug, so it is excluded from the loader's
 * `select` rather than filtered out of a template. A field that is never
 * fetched cannot reach a page, a payload, a meta description or a JSON-LD
 * block — and a later contributor adding `{...service}` to a serialiser cannot
 * leak what is not there.
 */
export interface PublicService {
  id: string;
  slug: string;
  name: string;
  scope: string | null;
  excluded: string | null;
  status: ServiceStatus;
  familyName: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  /** Engagement type, turnaround and fee basis, already worded. */
  chips: { key: string; label: string; value: string }[];
  rows: ScopeRow[];
  filled: number;
  total: number;
}

/** One published service, by business slug and service slug. Null when hidden. */
export async function publicServiceFor(
  businessSlug: string,
  serviceSlug: string,
): Promise<(PublicService & { businessId: string }) | null> {
  const service = await prisma.service.findFirst({
    where: {
      slug: serviceSlug,
      status: "live",
      business: { slug: businessSlug, publishedAt: { not: null }, suspendedAt: null },
    },
    /*
       Every column named, and `indicativeFee` is not one of them. A `select`
       rather than an `omit` because a select is a list somebody has to add to
       on purpose.
    */
    select: {
      id: true,
      businessId: true,
      slug: true,
      name: true,
      categoryId: true,
      engagementType: true,
      feeBasis: true,
      turnaround: true,
      deliveredWhere: true,
      deliverable: true,
      scope: true,
      excluded: true,
      status: true,
      category: { select: { name: true, slug: true } },
      values: { select: { fieldKey: true, value: true } },
    },
  });
  if (!service) return null;

  const family = await familyFor(service.categoryId);
  return {
    ...toPublic(service, family),
    businessId: service.businessId,
  };
}

/** The live services of one business, in the seller's own order. */
export async function publicServicesFor(businessId: string): Promise<PublicService[]> {
  const services = await prisma.service.findMany({
    where: { businessId, status: "live" },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      categoryId: true,
      engagementType: true,
      feeBasis: true,
      turnaround: true,
      deliveredWhere: true,
      deliverable: true,
      scope: true,
      excluded: true,
      status: true,
      category: { select: { name: true, slug: true } },
      values: { select: { fieldKey: true, value: true } },
    },
  });

  const families = new Map<string, ScopeFamily>();
  for (const categoryId of new Set(services.map((row) => row.categoryId))) {
    families.set(categoryId, await familyFor(categoryId));
  }

  return services.map((service) => toPublic(service, families.get(service.categoryId)!));
}

interface PublicRow {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  engagementType: EngagementType | null;
  feeBasis: string | null;
  turnaround: string | null;
  deliveredWhere: DeliveredWhere | null;
  deliverable: string | null;
  scope: string | null;
  excluded: string | null;
  status: ServiceStatus;
  category: { name: string; slug: string };
  values: { fieldKey: string; value: string }[];
}

/**
 * The record as a buyer reads it, in the family's row order.
 *
 * Enum values are turned into words by the caller — `t()` lives in the screen,
 * and a label function crossing into a client component is this repo's most
 * repeated defect. What travels here is the raw value; the screen words it.
 */
function toPublic(service: PublicRow, family: ScopeFamily): PublicService {
  const optional = new Map(service.values.map((row) => [row.fieldKey, row.value]));

  const values: Partial<Record<RowKey, string | null>> = {
    engagement_type: service.engagementType,
    turnaround: service.turnaround,
    fee_basis:
      family.feeBases.find((basis) => basis.key === service.feeBasis)?.label ??
      service.feeBasis,
    deliverable: service.deliverable,
    delivered_where: service.deliveredWhere,
    regulator: optional.get("regulator") ?? null,
    requires_from_client: optional.get("requires_from_client") ?? null,
    sectors: optional.get("sectors") ?? null,
    languages: optional.get("languages") ?? null,
  };

  const rows = scopeRows(family.rows, values);

  return {
    id: service.id,
    slug: service.slug,
    name: service.name,
    scope: service.scope,
    excluded: service.excluded,
    status: service.status,
    familyName: family.name,
    categoryId: service.categoryId,
    categoryName: service.category.name,
    categorySlug: service.category.slug,
    chips: (["engagement_type", "turnaround", "fee_basis"] as const)
      .map((key) => ({
        key,
        label: rows.find((row) => row.key === key)?.label ?? key,
        value: values[key] ?? "",
      }))
      .filter((chip) => chip.value !== ""),
    rows,
    filled: rows.filter((row) => row.value !== null).length,
    total: ROW_KEYS.length,
  };
}
