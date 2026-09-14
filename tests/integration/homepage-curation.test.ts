import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import {
  addCuratedQuery,
  curatedQueries,
  featureBusiness,
  findFeatureCandidates,
  holdsHomepageSlot,
  homepageSlots,
  recentlyVerifiedSuggestions,
  removeCuratedQuery,
  removeFeatured,
  reorderSlots,
  searchedTerms,
} from "@/lib/content/homepage";
import { CHIP_CAP, slotOrder } from "@/lib/content/homepage-rules";
import { readCuratedQueries, readHomeSectors, readVerifiedSlots } from "@/lib/db/queries/home";
import { VERIFIED_TIER } from "@/lib/verification";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board 6h — homepage curation, against a real database.
 *
 * The four slots and the chips are shared seed state, so every test starts from
 * a snapshot taken before the suite and the suite puts it back afterwards —
 * including the audit rows it wrote, which nothing else here should read.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
const REASON = "Rotating the rail for the week's verified suppliers.";
const PUBLIC = { publishedAt: { not: null }, suspendedAt: null, mergedIntoId: null, closedAt: null, closureRequestedAt: null } as const;

let ops: Actor;
let moderator: Actor;
let savedSlots: { position: number; businessId: string; addedById: string; addedAt: Date }[];
let savedChips: { id: string; label: string; query: string; position: number; addedById: string | null; createdAt: Date }[];

async function restore() {
  await prisma.homepageSlot.deleteMany({});
  await prisma.homepageSlot.createMany({ data: savedSlots });
  await prisma.curatedQuery.deleteMany({});
  await prisma.curatedQuery.createMany({ data: savedChips });
}

async function eligible(take: number) {
  return prisma.business.findMany({
    where: { ...PUBLIC, verificationTier: { gte: VERIFIED_TIER } },
    orderBy: { id: "asc" },
    take,
    select: { id: true, displayName: true },
  });
}

beforeAll(async () => {
  const [opsRow, moderatorRow] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { roles: { has: "staff_ops_lead" } }, orderBy: { id: "asc" }, select: { id: true } }),
    prisma.user.findFirstOrThrow({ where: { roles: { has: "staff_moderator" } }, orderBy: { id: "asc" }, select: { id: true } }),
  ]);
  ops = actor(opsRow.id, "staff_ops_lead");
  moderator = actor(moderatorRow.id, "staff_moderator");
  savedSlots = await prisma.homepageSlot.findMany({ select: { position: true, businessId: true, addedById: true, addedAt: true } });
  savedChips = await prisma.curatedQuery.findMany({ select: { id: true, label: true, query: true, position: true, addedById: true, createdAt: true } });
});

afterEach(restore);

afterAll(async () => {
  await restore();
  await purgeAuditRows({ action: { startsWith: "homepage_" } });
});

describe("the slots (B1, B2, B3, B6)", () => {
  it("puts an eligible business in the first slot nobody holds, and audits who and why", async () => {
    await prisma.homepageSlot.deleteMany({});
    const [first, second] = await eligible(2);

    expect(await featureBusiness({ actor: ops, businessId: first!.id, reason: REASON })).toEqual({ ok: true, position: 1 });
    expect(await featureBusiness({ actor: ops, businessId: second!.id, reason: REASON })).toEqual({ ok: true, position: 2 });

    const row = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "homepage_slot_featured", subject: `Business:${second!.id}` },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(row.actorId).toBe(ops.id);
    expect(row.reason).toBe(REASON);
    expect(row.before).toEqual({ order: [first!.id, null, null, null] });
    expect(row.after).toMatchObject({ position: 2, order: [first!.id, second!.id, null, null] });
  });

  it("refuses a Tier 1 business and names the condition that failed", async () => {
    const tierOne = await prisma.business.findFirstOrThrow({
      where: { ...PUBLIC, verificationTier: 1, licenceExpiry: { gt: new Date() } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    expect(await featureBusiness({ actor: ops, businessId: tierOne.id, reason: REASON })).toEqual({
      ok: false,
      error: "not_eligible",
      block: "licence_unchecked",
    });
    expect(await featureBusiness({ actor: ops, businessId: "no-such-business", reason: REASON })).toMatchObject({ error: "not_found" });
  });

  it("refuses a business already in a slot, and a fifth when four are held", async () => {
    await prisma.homepageSlot.deleteMany({});
    const five = await eligible(5);
    for (const business of five.slice(0, 4)) {
      expect((await featureBusiness({ actor: ops, businessId: business.id, reason: REASON })).ok).toBe(true);
    }
    expect(await featureBusiness({ actor: ops, businessId: five[0]!.id, reason: REASON })).toMatchObject({ error: "already_featured", position: 1 });
    expect(await featureBusiness({ actor: ops, businessId: five[4]!.id, reason: REASON })).toMatchObject({ error: "full" });
  });

  it("leaves a removed slot empty rather than closing the rail up", async () => {
    await prisma.homepageSlot.deleteMany({});
    const three = await eligible(3);
    for (const business of three) await featureBusiness({ actor: ops, businessId: business.id, reason: REASON });

    expect(await removeFeatured({ actor: ops, businessId: three[1]!.id, reason: REASON })).toEqual({ ok: true, position: 2 });
    const slots = await homepageSlots();
    expect(slots.map((slot) => slot.business?.id ?? null)).toEqual([three[0]!.id, null, three[2]!.id, null]);
    expect(await removeFeatured({ actor: ops, businessId: three[1]!.id, reason: REASON })).toMatchObject({ error: "not_featured" });

    // The gap is the first free slot, so the next feature fills it — a person doing so, not a backfill.
    const [, , , fourth] = await eligible(4);
    expect(await featureBusiness({ actor: ops, businessId: fourth!.id, reason: REASON })).toEqual({ ok: true, position: 2 });
  });

  it("keeps a slot held by a business that lost its tier, and renders nothing in its place", async () => {
    await prisma.homepageSlot.deleteMany({});
    const three = await eligible(3);
    const lapsed = await prisma.business.findFirstOrThrow({
      where: { ...PUBLIC, verificationTier: 1 },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    await prisma.homepageSlot.createMany({
      data: [
        { position: 1, businessId: three[0]!.id, addedById: ops.id },
        { position: 2, businessId: lapsed.id, addedById: ops.id },
        { position: 3, businessId: three[1]!.id, addedById: ops.id },
      ],
    });

    const slots = await homepageSlots();
    expect(slots[1]!.business?.block).toMatch(/licence_unchecked|licence_lapsed/);

    // B1: the home page reads the tier live and shows two cards, in slot order.
    expect((await readVerifiedSlots()).map((business) => business.id)).toEqual([three[0]!.id, three[1]!.id]);

    // B2: the held slot is not free. One more fills slot 4; the next is refused.
    expect(await featureBusiness({ actor: ops, businessId: three[2]!.id, reason: REASON })).toEqual({ ok: true, position: 4 });
    const [, , , , extra] = await eligible(5);
    expect(await featureBusiness({ actor: ops, businessId: extra!.id, reason: REASON })).toMatchObject({ error: "full" });
  });

  it("drops a suspended business from the home page without anyone writing to the slot", async () => {
    await prisma.homepageSlot.deleteMany({});
    const [business] = await eligible(1);
    await featureBusiness({ actor: ops, businessId: business!.id, reason: REASON });
    const before = await prisma.business.findUniqueOrThrow({ where: { id: business!.id }, select: { suspendedAt: true } });
    await prisma.business.update({ where: { id: business!.id }, data: { suspendedAt: new Date() } });
    try {
      expect(await readVerifiedSlots()).toEqual([]);
      expect((await homepageSlots())[0]!.business?.block).toBe("suspended");
    } finally {
      await prisma.business.update({ where: { id: business!.id }, data: { suspendedAt: before.suspendedAt } });
    }
  });

  it("reorders the same businesses, keeps who added them, and refuses a stale or different order", async () => {
    await prisma.homepageSlot.deleteMany({});
    const three = await eligible(3);
    for (const business of three) await featureBusiness({ actor: ops, businessId: business.id, reason: REASON });
    const held = await prisma.homepageSlot.findMany({ select: { businessId: true, addedAt: true, addedById: true } });
    const current = slotOrder(await prisma.homepageSlot.findMany({ select: { position: true, businessId: true } }));
    const [a, b, c] = three.map((business) => business.id);

    expect(await reorderSlots({ actor: ops, order: [c!, null, a!, b!], basedOn: [a!, null, b!, c!], reason: REASON })).toMatchObject({ error: "stale" });
    expect(await reorderSlots({ actor: ops, order: [a!, b!, null, null], basedOn: current, reason: REASON })).toMatchObject({
      error: "invalid_order",
      problem: "different_members",
    });
    expect(await reorderSlots({ actor: ops, order: [a!, a!, b!, c!], basedOn: current, reason: REASON })).toMatchObject({ problem: "duplicate" });
    expect(await reorderSlots({ actor: ops, order: current, basedOn: current, reason: REASON })).toMatchObject({ error: "unchanged" });

    expect(await reorderSlots({ actor: ops, order: [c!, null, a!, b!], basedOn: current, reason: REASON })).toEqual({ ok: true });
    const after = await prisma.homepageSlot.findMany({ orderBy: { position: "asc" }, select: { position: true, businessId: true, addedAt: true, addedById: true } });
    expect(after.map((slot) => [slot.position, slot.businessId])).toEqual([[1, c], [3, a], [4, b]]);
    for (const slot of after) {
      const was = held.find((row) => row.businessId === slot.businessId)!;
      expect(slot.addedAt.getTime()).toBe(was.addedAt.getTime());
      expect(slot.addedById).toBe(was.addedById);
    }

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "homepage_slots_reordered" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(audit.before).toEqual({ order: current });
    expect(audit.after).toEqual({ order: [c, null, a, b] });
  });

  it("is an ops lead's, and every change carries a reason", async () => {
    const [business] = await eligible(1);
    await expect(featureBusiness({ actor: moderator, businessId: business!.id, reason: REASON })).rejects.toBeInstanceOf(PermissionError);
    await prisma.homepageSlot.deleteMany({});
    await expect(featureBusiness({ actor: ops, businessId: business!.id, reason: "  " })).rejects.toBeInstanceOf(AuditReasonError);
    expect(await prisma.homepageSlot.count()).toBe(0);
  });
});

describe("which lapses reach the rail", () => {
  it("answers yes only for a listing that holds a slot, so the sweep clears the home cache only then", async () => {
    await prisma.homepageSlot.deleteMany({});
    const [held, other] = await eligible(2);
    await featureBusiness({ actor: ops, businessId: held!.id, reason: REASON });
    const slugs = await prisma.business.findMany({ where: { id: { in: [held!.id, other!.id] } }, select: { id: true, slug: true } });
    const slugOf = (id: string) => slugs.find((row) => row.id === id)!.slug;

    expect(await holdsHomepageSlot([])).toBe(false);
    expect(await holdsHomepageSlot([slugOf(other!.id)])).toBe(false);
    expect(await holdsHomepageSlot([slugOf(other!.id), slugOf(held!.id)])).toBe(true);
  });
});

describe("finding a business to feature", () => {
  it("returns ineligible matches with their condition, and leaves out the featured", async () => {
    const featured = await prisma.homepageSlot.findFirst({ select: { business: { select: { displayName: true, id: true } } } });
    const tierOne = await prisma.business.findFirstOrThrow({ where: { ...PUBLIC, verificationTier: 1 }, orderBy: { id: "asc" }, select: { displayName: true, id: true } });

    const matches = await findFeatureCandidates(tierOne.displayName);
    expect(matches.find((row) => row.id === tierOne.id)?.block).not.toBeNull();
    if (featured) {
      expect((await findFeatureCandidates(featured.business.displayName)).map((row) => row.id)).not.toContain(featured.business.id);
    }
    expect(await findFeatureCandidates("a")).toEqual([]);
  });

  it("suggests only eligible, unfeatured businesses whose tier rose", async () => {
    const featured = new Set((await prisma.homepageSlot.findMany({ select: { businessId: true } })).map((slot) => slot.businessId));
    for (const suggestion of await recentlyVerifiedSuggestions()) {
      expect(suggestion.block).toBeNull();
      expect(featured.has(suggestion.id)).toBe(false);
    }
  });
});

describe("the chips (B8, Q2)", () => {
  it("stores what the results page understands, and links to it", async () => {
    await prisma.curatedQuery.deleteMany({});
    const added = await addCuratedQuery({
      actor: ops,
      label: "  Gate valves   in Dubai ",
      query: "/search?q=gate+valve&emirate=dubai&page=3&utm_source=newsletter",
      reason: REASON,
    });
    expect(added).toMatchObject({ ok: true, position: 1 });
    expect(await curatedQueries()).toMatchObject([{ label: "Gate valves in Dubai", query: "q=gate+valve&emirate=dubai" }]);
    expect(await readCuratedQueries()).toEqual([{ label: "Gate valves in Dubai", href: "/search?q=gate+valve&emirate=dubai" }]);
  });

  it("refuses a duplicate label or search, a search with nothing in it, and a seventh chip", async () => {
    await prisma.curatedQuery.deleteMany({});
    await addCuratedQuery({ actor: ops, label: "Pallet racking", query: "pallet racking", reason: REASON });

    expect(await addCuratedQuery({ actor: ops, label: "PALLET RACKING", query: "racking", reason: REASON })).toMatchObject({ error: "chip_duplicate_label" });
    expect(await addCuratedQuery({ actor: ops, label: "Racking", query: "/search?q=pallet+racking", reason: REASON })).toMatchObject({ error: "chip_duplicate_query" });
    expect(await addCuratedQuery({ actor: ops, label: "Everything", query: "/search?page=2", reason: REASON })).toMatchObject({ error: "chip_invalid", problem: "query_no_terms" });
    expect(await addCuratedQuery({ actor: ops, label: "Guides", query: "/guides", reason: REASON })).toMatchObject({ problem: "query_not_search" });
    expect(await addCuratedQuery({ actor: ops, label: "X", query: "x ray", reason: REASON })).toMatchObject({ problem: "label_length" });

    for (let i = 2; i <= CHIP_CAP; i++) {
      expect((await addCuratedQuery({ actor: ops, label: `Chip ${i}`, query: `term ${i}`, reason: REASON })).ok).toBe(true);
    }
    expect(await addCuratedQuery({ actor: ops, label: "Seventh", query: "seventh", reason: REASON })).toMatchObject({ error: "chip_full" });
  });

  it("closes the row up when one comes off, and audits both acts", async () => {
    await prisma.curatedQuery.deleteMany({});
    for (const label of ["First", "Second", "Third"]) {
      await addCuratedQuery({ actor: ops, label, query: label.toLowerCase(), reason: REASON });
    }
    const second = (await curatedQueries())[1]!;
    expect(await removeCuratedQuery({ actor: ops, id: second.id, reason: REASON })).toEqual({ ok: true });
    expect((await curatedQueries()).map((chip) => [chip.label, chip.position])).toEqual([["First", 1], ["Third", 2]]);
    expect(await removeCuratedQuery({ actor: ops, id: second.id, reason: REASON })).toMatchObject({ error: "chip_not_found" });

    const removed = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "homepage_query_removed" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(removed.before).toMatchObject({ label: "Second", position: 2 });
    await expect(addCuratedQuery({ actor: moderator, label: "Mine", query: "mine", reason: REASON })).rejects.toBeInstanceOf(PermissionError);
  });

  it("marks a searched term a chip already runs", async () => {
    const chips = await curatedQueries();
    const terms = await searchedTerms(chips);
    for (const term of terms) {
      const runs = chips.some((chip) => new URLSearchParams(chip.query).get("q")?.toLowerCase() === term.query.toLowerCase());
      expect(term.chipped).toBe(runs);
    }
  });
});

describe("the sector grid computes (6h rails map)", () => {
  it("shows every sector with a listing, by listing count, twelve at most — whatever showOnHome says", async () => {
    const sectors = await readHomeSectors();
    expect(sectors.length).toBeLessThanOrEqual(12);
    expect(sectors.every((sector) => sector.listings > 0)).toBe(true);

    const hidden = await prisma.category.findMany({
      where: { parentId: null, showOnHome: false },
      select: { id: true, _count: { select: { primaryFor: { where: { publishedAt: { not: null }, suspendedAt: null } } } }, children: { select: { _count: { select: { primaryFor: { where: { publishedAt: { not: null }, suspendedAt: null } } } } } } },
    });
    const withListings = hidden.filter((sector) => sector._count.primaryFor + sector.children.reduce((n, child) => n + child._count.primaryFor, 0) > 0);
    if (withListings.length > 0 && sectors.length < 12) {
      expect(sectors.map((sector) => sector.id)).toEqual(expect.arrayContaining(withListings.map((sector) => sector.id)));
    }
  });
});
