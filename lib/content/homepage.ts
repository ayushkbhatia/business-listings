import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import type { Prisma, SellsKind } from "@/lib/db/generated/client";
import {
  CHIP_CAP,
  chipLabelProblem,
  featureBlock,
  firstFreePosition,
  normaliseChipQuery,
  orderProblem,
  sameOrder,
  slotOrder,
  SLOT_POSITIONS,
  type ChipProblem,
  type FeatureBlock,
  type OrderProblem,
} from "./homepage-rules";

/**
 * Board 6h — homepage curation.
 *
 * The home page has nine rails. Two of them a person chooses and seven compute;
 * this is the two. The four "Verified this week" cards are `HomepageSlot` rows
 * and the popular-search chips are `CuratedQuery` rows, and every change to
 * either is an audited staff mutation under `homepage.curate` (`B3`).
 *
 * What this module deliberately does not do:
 *
 *   - **Backfill.** A slot whose business lost Tier 2 stays held by it, renders
 *     empty on the home page, and stays held here until a person removes it.
 *     The empty slot is the notification (`B2`).
 *   - **Cache eligibility.** Every read asks `featureBlock` again (`B1`).
 *   - **Read a plan.** Nothing here selects `planId` or a subscription (`B4`).
 *
 * The action layer revalidates the home page's data tag after every write
 * (`B7`); a service has no request context to do it from.
 */

export type HomepageRefusal =
  | "not_found"
  | "already_featured"
  | "full"
  | "not_eligible"
  | "not_featured"
  | "stale"
  | "invalid_order"
  | "unchanged"
  | "chip_full"
  | "chip_invalid"
  | "chip_duplicate_label"
  | "chip_duplicate_query"
  | "chip_not_found";

export type HomepageResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: HomepageRefusal; block?: FeatureBlock; problem?: ChipProblem | OrderProblem; position?: number };

class Refused extends Error {
  constructor(
    readonly refusal: Exclude<HomepageResult, { ok: true }>,
  ) {
    super(refusal.error);
  }
}

const refuse = (error: HomepageRefusal, extra: Omit<Exclude<HomepageResult, { ok: true }>, "ok" | "error"> = {}) =>
  new Refused({ ok: false, error, ...extra });

async function lock(tx: Prisma.TransactionClient, key: "homepage_slot" | "curated_query") {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

const FACTS = {
  verificationTier: true,
  licenceExpiry: true,
  suspendedAt: true,
  publishedAt: true,
  mergedIntoId: true,
  closureRequestedAt: true,
  closedAt: true,
} as const;

const CARD_SELECT = {
  id: true,
  slug: true,
  displayName: true,
  sellsKind: true,
  reviewCount: true,
  responseTimeMedianMs: true,
  ...FACTS,
  primaryCategory: { select: { name: true, parent: { select: { name: true } } } },
  // `id` last: `sortOrder` is not on a location, and `createdAt` ties on an import.
  locations: {
    where: { published: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 1,
    select: { area: { select: { name: true } } },
  },
  _count: {
    select: {
      products: { where: { status: { not: "draft" } } },
      services: { where: { status: "live" } },
    },
  },
} satisfies Prisma.BusinessSelect;

type CardRow = Prisma.BusinessGetPayload<{ select: typeof CARD_SELECT }>;

/** What a curator judges a card on — reviews, reply time, catalogue depth and the licence date. */
export interface CuratedBusiness {
  id: string;
  slug: string;
  displayName: string;
  /** The sector, not the niche: "HVAC & refrigeration" reads on a row, a filing code does not. */
  sectorName: string;
  areaName: string | null;
  reviewCount: number;
  responseTimeMedianMs: number | null;
  sellsKind: SellsKind;
  productCount: number;
  serviceCount: number;
  verificationTier: number;
  licenceExpiry: Date;
  /** Null when it may hold a card right now. */
  block: FeatureBlock | null;
}

function curated(row: CardRow, now: Date): CuratedBusiness {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    sectorName: row.primaryCategory.parent?.name ?? row.primaryCategory.name,
    areaName: row.locations[0]?.area.name ?? null,
    reviewCount: row.reviewCount,
    responseTimeMedianMs: row.responseTimeMedianMs,
    sellsKind: row.sellsKind,
    productCount: row._count.products,
    serviceCount: row._count.services,
    verificationTier: row.verificationTier,
    licenceExpiry: row.licenceExpiry,
    block: featureBlock(row, now),
  };
}

export interface SlotRow {
  position: number;
  /** Null when nobody holds the slot. */
  business: CuratedBusiness | null;
  addedAt: Date | null;
}

/** Always four rows, in position order. */
export async function homepageSlots(now: Date = new Date()): Promise<SlotRow[]> {
  const held = await prisma.homepageSlot.findMany({
    orderBy: { position: "asc" },
    select: { position: true, addedAt: true, business: { select: CARD_SELECT } },
  });
  return SLOT_POSITIONS.map((position) => {
    const slot = held.find((row) => row.position === position);
    return {
      position,
      business: slot ? curated(slot.business, now) : null,
      addedAt: slot?.addedAt ?? null,
    };
  });
}

export interface ChipRow {
  id: string;
  label: string;
  query: string;
  position: number;
}

export async function curatedQueries(): Promise<ChipRow[]> {
  return prisma.curatedQuery.findMany({
    orderBy: { position: "asc" },
    select: { id: true, label: true, query: true, position: true },
  });
}

const CANDIDATES = 8;

/**
 * Businesses a curator might put in a slot, by name.
 *
 * Ineligible matches are returned with the condition that failed rather than
 * filtered out: somebody searching for Marina Pumps needs to learn the licence
 * has not been checked, not that the directory has never heard of them.
 * Already-featured businesses are left out — they are on the list above.
 */
export async function findFeatureCandidates(query: string, now: Date = new Date()): Promise<CuratedBusiness[]> {
  const needle = query.trim();
  if (needle.length < 2) return [];
  const rows = await prisma.business.findMany({
    where: {
      displayName: { contains: needle, mode: "insensitive" },
      mergedIntoId: null,
      homepageSlot: { is: null },
    },
    orderBy: [{ verificationTier: "desc" }, { displayName: "asc" }, { id: "asc" }],
    take: CANDIDATES,
    select: CARD_SELECT,
  });
  return rows.map((row) => curated(row, now));
}

const SUGGESTION_WINDOW_DAYS = 30;
const SUGGESTIONS = 6;

/**
 * Businesses whose tier *rose* to Tier 2 inside thirty days, eligible and not
 * featured — the rail used to be exactly this list, computed.
 *
 * Offered beside the search as a starting point, because "Verified this week"
 * is a claim about recency and these are the businesses it is most true of. Read
 * from the audit log for the reason the old rail was: `verifiedAt` says when
 * somebody looked, and only a `tier_change` row says the tier went up.
 */
export async function recentlyVerifiedSuggestions(now: Date = new Date()): Promise<CuratedBusiness[]> {
  const since = new Date(now.getTime() - SUGGESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const events = await prisma.auditEvent.findMany({
    where: { action: "tier_change", createdAt: { gte: since }, subject: { startsWith: "Business:" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { subject: true, before: true, after: true },
  });

  const rose: string[] = [];
  for (const event of events) {
    const before = (event.before as { verificationTier?: number } | null)?.verificationTier;
    const after = (event.after as { verificationTier?: number } | null)?.verificationTier;
    if (typeof before !== "number" || typeof after !== "number" || after <= before) continue;
    const id = event.subject.slice("Business:".length);
    if (!rose.includes(id)) rose.push(id);
  }
  if (rose.length === 0) return [];

  const rows = await prisma.business.findMany({
    where: { id: { in: rose }, homepageSlot: { is: null } },
    select: CARD_SELECT,
  });
  return rows
    .map((row) => curated(row, now))
    .filter((business) => business.block === null)
    .sort((a, b) => rose.indexOf(a.id) - rose.indexOf(b.id))
    .slice(0, SUGGESTIONS);
}

/** Whether any of these listings holds a slot — the only case a change to them reaches the rail. */
export async function holdsHomepageSlot(slugs: readonly string[]): Promise<boolean> {
  if (slugs.length === 0) return false;
  return (await prisma.homepageSlot.count({ where: { business: { slug: { in: [...slugs] } } } })) > 0;
}

// ── Slot writes ───────────────────────────────────────────────────────────────

export interface FeatureInput {
  actor: Actor;
  businessId: string;
  reason: string;
}

/**
 * Put a business in the first slot nobody holds.
 *
 * Refused when all four are held — including by a business that has lost its
 * tier, which a person removes first — and refused with the failed condition
 * when the business cannot be featured.
 */
export async function featureBusiness(input: FeatureInput, now: Date = new Date()): Promise<HomepageResult<{ position: number }>> {
  assertCan(input.actor, "homepage.curate");
  try {
    const position = await prisma.$transaction(async (tx) => {
      await lock(tx, "homepage_slot");
      const business = await tx.business.findUnique({
        where: { id: input.businessId },
        select: { id: true, displayName: true, ...FACTS },
      });
      if (!business) throw refuse("not_found");
      const block = featureBlock(business, now);
      if (block) throw refuse("not_eligible", { block });

      const held = await tx.homepageSlot.findMany({ select: { position: true, businessId: true } });
      const existing = held.find((slot) => slot.businessId === business.id);
      if (existing) throw refuse("already_featured", { position: existing.position });
      const free = firstFreePosition(held);
      if (free === null) throw refuse("full");

      return staffMutation(
        {
          actor: input.actor,
          capability: "homepage.curate",
          action: "homepage_slot_featured",
          subject: `Business:${business.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.homepageSlot.create({ data: { position: free, businessId: business.id, addedById: input.actor.id } });
          return {
            result: free,
            before: { order: slotOrder(held) },
            after: { position: free, displayName: business.displayName, order: slotOrder([...held, { position: free, businessId: business.id }]) },
          };
        },
      );
    });
    return { ok: true, position };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

/**
 * Take a business out of its slot. The slot is left empty rather than closed
 * up: the order is a decision, and removing slot 2 does not promote slot 3.
 */
export async function removeFeatured(input: FeatureInput): Promise<HomepageResult<{ position: number }>> {
  assertCan(input.actor, "homepage.curate");
  try {
    const position = await prisma.$transaction(async (tx) => {
      await lock(tx, "homepage_slot");
      const held = await tx.homepageSlot.findMany({
        select: { position: true, businessId: true, business: { select: { displayName: true, verificationTier: true } } },
      });
      const slot = held.find((row) => row.businessId === input.businessId);
      if (!slot) throw refuse("not_featured");

      return staffMutation(
        {
          actor: input.actor,
          capability: "homepage.curate",
          action: "homepage_slot_removed",
          subject: `Business:${slot.businessId}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.homepageSlot.delete({ where: { businessId: slot.businessId } });
          return {
            result: slot.position,
            // The tier rides along so the log says whether a lapsed business was cleared or a verified one was dropped.
            before: { position: slot.position, displayName: slot.business.displayName, verificationTier: slot.business.verificationTier, order: slotOrder(held) },
            after: { position: null, order: slotOrder(held.filter((row) => row.businessId !== slot.businessId)) },
          };
        },
      );
    });
    return { ok: true, position };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

export interface ReorderInput {
  actor: Actor;
  /** Four entries, slot 1 first; null for an empty slot. */
  order: (string | null)[];
  /** The order the editor opened on. A different one on the server is `stale`. */
  basedOn: (string | null)[];
  reason: string;
}

/**
 * Write a new order (`B6`).
 *
 * The four rows are replaced inside one transaction rather than updated in
 * place: `position` is unique, and moving slot 1 to 2 while 2 moves to 1 has no
 * order of single updates that does not collide. Who added each business, and
 * when, is carried across unchanged — a reorder is not a re-feature.
 */
export async function reorderSlots(input: ReorderInput): Promise<HomepageResult> {
  assertCan(input.actor, "homepage.curate");
  try {
    await prisma.$transaction(async (tx) => {
      await lock(tx, "homepage_slot");
      const held = await tx.homepageSlot.findMany({
        select: { position: true, businessId: true, addedById: true, addedAt: true },
      });
      const current = slotOrder(held);
      if (!sameOrder(current, input.basedOn)) throw refuse("stale");
      const problem = orderProblem(current, input.order);
      if (problem) throw refuse("invalid_order", { problem });
      if (sameOrder(current, input.order)) throw refuse("unchanged");

      await staffMutation(
        {
          actor: input.actor,
          capability: "homepage.curate",
          action: "homepage_slots_reordered",
          subject: "HomepageSlot:verified_this_week",
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.homepageSlot.deleteMany({});
          await tx.homepageSlot.createMany({
            data: input.order.flatMap((businessId, index) => {
              const was = held.find((slot) => slot.businessId === businessId);
              return businessId && was
                ? [{ position: index + 1, businessId, addedById: was.addedById, addedAt: was.addedAt }]
                : [];
            }),
          });
          return { result: null, before: { order: current }, after: { order: input.order } };
        },
      );
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

// ── Chip writes ───────────────────────────────────────────────────────────────

export interface AddChipInput {
  actor: Actor;
  label: string;
  /** Plain words, a `/search?…` address, or a bare query string. */
  query: string;
  reason: string;
}

/** Append a chip. Six is the cap (`Q2`), and two chips may not say or run the same thing. */
export async function addCuratedQuery(input: AddChipInput): Promise<HomepageResult<{ id: string; position: number }>> {
  assertCan(input.actor, "homepage.curate");
  const label = input.label.trim().replace(/\s+/g, " ");
  const labelProblem = chipLabelProblem(label);
  if (labelProblem) return { ok: false, error: "chip_invalid", problem: labelProblem };
  const normalised = normaliseChipQuery(input.query);
  if (!normalised.ok) return { ok: false, error: "chip_invalid", problem: normalised.error };

  try {
    const created = await prisma.$transaction(async (tx) => {
      await lock(tx, "curated_query");
      const chips = await tx.curatedQuery.findMany({ select: { id: true, label: true, query: true, position: true } });
      if (chips.length >= CHIP_CAP) throw refuse("chip_full");
      if (chips.some((chip) => chip.label.toLowerCase() === label.toLowerCase())) throw refuse("chip_duplicate_label");
      if (chips.some((chip) => chip.query === normalised.query)) throw refuse("chip_duplicate_query");
      const position = chips.reduce((max, chip) => Math.max(max, chip.position), 0) + 1;

      return staffMutation(
        {
          actor: input.actor,
          capability: "homepage.curate",
          action: "homepage_query_added",
          subject: "CuratedQuery:popular_searches",
          reason: input.reason,
          tx,
        },
        async () => {
          const row = await tx.curatedQuery.create({
            data: { label, query: normalised.query, position, addedById: input.actor.id },
            select: { id: true, position: true },
          });
          return {
            result: row,
            before: { chips: chips.length },
            after: { label, query: normalised.query, position, chips: chips.length + 1 },
          };
        },
      );
    });
    return { ok: true, ...created };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

export interface RemoveChipInput {
  actor: Actor;
  id: string;
  reason: string;
}

/**
 * Take a chip off, and close the row up. Unlike a slot, a chip has no place
 * worth keeping empty: the hero row is a list, and a gap in it is only a gap.
 */
export async function removeCuratedQuery(input: RemoveChipInput): Promise<HomepageResult> {
  assertCan(input.actor, "homepage.curate");
  try {
    await prisma.$transaction(async (tx) => {
      await lock(tx, "curated_query");
      const chips = await tx.curatedQuery.findMany({
        orderBy: { position: "asc" },
        select: { id: true, label: true, query: true, position: true },
      });
      const chip = chips.find((row) => row.id === input.id);
      if (!chip) throw refuse("chip_not_found");

      await staffMutation(
        {
          actor: input.actor,
          capability: "homepage.curate",
          action: "homepage_query_removed",
          subject: "CuratedQuery:popular_searches",
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.curatedQuery.delete({ where: { id: chip.id } });
          // Ascending, so each row moves into the place the one before it just left.
          for (const later of chips.filter((row) => row.position > chip.position)) {
            await tx.curatedQuery.update({ where: { id: later.id }, data: { position: later.position - 1 } });
          }
          return {
            result: null,
            before: { label: chip.label, query: chip.query, position: chip.position, chips: chips.length },
            after: { chips: chips.length - 1 },
          };
        },
      );
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

// ── What buyers actually searched ─────────────────────────────────────────────

/** The results tabs a buyer searches from. Board 2a's claim searches are suppliers finding themselves. */
const BUYER_TABS = ["businesses", "products"] as const;
const REPORT_WINDOW_DAYS = 30;

export interface SearchedTerm {
  query: string;
  searches: number;
  /** False when every search for it came back empty — a trade to go and sign, not a chip. */
  answered: boolean;
  /** A chip already runs this as its words. */
  chipped: boolean;
}

/**
 * The most-searched buyer terms of thirty days, beside the chips.
 *
 * Reference, never a source. The chips are typed for the reason the board
 * gives — the top real query is often a brand the directory does not stock —
 * but somebody typing a promise about coverage should be able to see what
 * buyers were asking for while they do it, and which of those came back empty.
 *
 * Buyer tabs only, which the report this replaced did not filter: a supplier
 * searching for their own licence record is not demand, and before this their
 * trade names ranked here beside buyers' terms.
 */
export async function searchedTerms(chips: readonly ChipRow[], now: Date = new Date(), take = 10): Promise<SearchedTerm[]> {
  const since = new Date(now.getTime() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const where = { createdAt: { gte: since }, tab: { in: [...BUYER_TABS] } };
  const grouped = await prisma.searchQueryLog.groupBy({
    by: ["normalised"],
    where,
    _count: { normalised: true },
    _max: { resultCount: true },
    orderBy: [{ _count: { normalised: "desc" } }, { normalised: "asc" }],
    take,
  });
  if (grouped.length === 0) return [];

  const spellings = await prisma.searchQueryLog.findMany({
    where: { ...where, normalised: { in: grouped.map((row) => row.normalised) } },
    distinct: ["normalised"],
    orderBy: [{ normalised: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { normalised: true, query: true },
  });
  const bySpelling = new Map(spellings.map((row) => [row.normalised, row.query]));
  const chipWords = new Set(
    chips.map((chip) => (new URLSearchParams(chip.query).get("q") ?? "").toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean),
  );

  return grouped.map((row) => ({
    query: bySpelling.get(row.normalised) ?? row.normalised,
    searches: row._count.normalised,
    answered: (row._max.resultCount ?? 0) > 0,
    chipped: chipWords.has(row.normalised),
  }));
}
