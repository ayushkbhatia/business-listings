import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { searchBusinesses } from "@/lib/db/queries";
import { runPositionSnapshots } from "@/lib/analytics/snapshot-job";
import {
  candidatesFrom,
  descendantsIndex,
  loadDirectory,
  placeIn,
} from "@/lib/search/directory";
import { runImpact } from "@/lib/search/impact";
import {
  DEFAULT_SERVICES_WEIGHTS,
  DEFAULT_WEIGHTS,
  type RankingKind,
  type RankingWeights,
} from "@/lib/search/ranking";
import {
  draftState,
  liveBrowseRelevanceMode,
  liveVectors,
  liveWeights,
  publishDraft,
  publishHistory,
  saveDraft,
  storePreview,
  vectorForBusiness,
} from "@/lib/search/settings";
import { loadTradeKinds } from "@/lib/taxonomy/service";
import { resolveTradeKind } from "@/lib/taxonomy/trade-kind";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board `12c-s` — the services vector, against a database.
 *
 * The arithmetic is proven in `lib/search/services-vector.test.ts`. What only a
 * database can show is that the keys hold through the service layer and the
 * queries: that a services publish leaves the goods row, draft and history
 * untouched (8), that the preview counts only what that vector moves (7), that
 * coverage match reaches a real search per matched service (4), that a
 * credential a seller adds moves nothing (9), and that the vector follows
 * `Category.tradeKind` rather than anything on the business (11).
 */

const PREFIX = "rank-12cs-";
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

let lead: Actor;
let sector: string;
let child: string;
let otherChild: string;
let goodsCategory: string;
const businesses: string[] = [];
let publishesBefore: string[] = [];

const COMPLETE = {
  engagementType: "one_off_job",
  feeBasis: "per_engagement",
  turnaround: "3 weeks",
  deliveredWhere: "remote",
  deliverable: "Signed report",
} as const;

async function makeFirm(fields: { tier?: number; category?: string } = {}): Promise<string> {
  const mark = stamp();
  const firm = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-R${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: fields.category ?? child,
      claimStatus: "claimed",
      sellsKind: "services",
      verificationTier: fields.tier ?? 1,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  businesses.push(firm.id);

  // A branch in both emirates, so an emirate filter lets every firm into the set
  // and coverage is the only thing that differs between them.
  const [sharjahArea, dubaiArea] = await Promise.all([
    prisma.area.findFirstOrThrow({ where: { emirate: "sharjah", isFreeZone: false }, select: { id: true } }),
    prisma.area.findFirstOrThrow({ where: { emirate: "dubai", isFreeZone: false }, select: { id: true } }),
  ]);
  await prisma.location.createMany({
    data: [
      { businessId: firm.id, type: "head_office", emirate: "sharjah", areaId: sharjahArea.id, addressLine: `${PREFIX}office`, published: true },
      { businessId: firm.id, type: "sales_office", emirate: "dubai", areaId: dubaiArea.id, addressLine: `${PREFIX}desk`, published: true },
    ],
  });
  return firm.id;
}

async function makeService(
  businessId: string,
  fields: { category?: string; complete?: boolean; name?: string } = {},
): Promise<string> {
  const mark = stamp();
  return (
    await prisma.service.create({
      data: {
        businessId,
        categoryId: fields.category ?? child,
        name: fields.name ?? `${PREFIX}svc-${mark}`,
        slug: `${PREFIX}svc-${mark}`,
        status: "live",
        ...COMPLETE,
        ...(fields.complete === false ? { deliverable: null } : {}),
      },
      select: { id: true },
    })
  ).id;
}

/** Save, preview, publish — the whole way round, for one vector. */
async function publish(kind: RankingKind, next: RankingWeights, reason: string): Promise<void> {
  const mode = await liveBrowseRelevanceMode(kind);
  const saved = await saveDraft(lead, kind, next, mode, reason);
  if (!saved.ok) throw new Error(`draft refused: ${saved.error}`);
  const preview = await runImpact({ kind, draft: next, draftMode: mode, live: await liveVectors() });
  await storePreview(kind, next, mode, preview);
  const published = await publishDraft(lead, kind, reason);
  if (!published.ok) throw new Error(`publish refused: ${published.error}`);
}

async function resetVectors(): Promise<void> {
  await prisma.rankingDraft.deleteMany({});
  await prisma.rankingWeights.deleteMany({ where: { kind: "services" } });
  await prisma.rankingWeights.upsert({
    where: { kind: "goods" },
    create: { id: "current", kind: "goods", ...DEFAULT_WEIGHTS, browseRelevanceMode: "redistribute" },
    update: { ...DEFAULT_WEIGHTS, browseRelevanceMode: "redistribute" },
  });
}

beforeAll(async () => {
  const opsLead = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_ops_lead" } },
    orderBy: { id: "asc" as const },
    select: { id: true },
  });
  lead = { id: opsLead.id, roles: ["staff_ops_lead"] };

  const root = await prisma.category.create({
    data: { slug: `${PREFIX}sector`, code: "RS", name: `${PREFIX}sector`, tradeKind: "services" },
  });
  sector = root.id;
  // Both children inherit `services` from the sector — no value of their own.
  child = (
    await prisma.category.create({
      data: { slug: `${PREFIX}audit`, code: "RS", name: `${PREFIX}audit`, parentId: sector },
    })
  ).id;
  otherChild = (
    await prisma.category.create({
      data: { slug: `${PREFIX}payroll`, code: "RS", name: `${PREFIX}payroll`, parentId: sector },
    })
  ).id;
  goodsCategory = (
    await prisma.category.create({
      data: { slug: `${PREFIX}valves`, code: "RS", name: `${PREFIX}valves`, tradeKind: "goods" },
    })
  ).id;

  publishesBefore = (await prisma.rankingPublish.findMany({ select: { id: true } })).map(
    (row) => row.id,
  );
});

beforeEach(resetVectors);

afterAll(async () => {
  await resetVectors();
  await prisma.rankingPublish.deleteMany({ where: { id: { notIn: publishesBefore } } });
  await prisma.listingFactorDay.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.category.deleteMany({ where: { id: { in: [child, otherChild, goodsCategory] } } });
  await prisma.category.deleteMany({ where: { id: sector } });
  await prisma.$disconnect();
});

const query = (overrides: Record<string, unknown> = {}) =>
  ({ q: "", page: 1, spec: {}, ...overrides }) as unknown as Parameters<typeof searchBusinesses>[0];

/** A vector that ranks on one slot and nothing else, so the slot is the whole test. */
const only = (key: keyof RankingWeights): RankingWeights => ({
  relevance: 0,
  verificationTier: 0,
  responseTime: 0,
  specCompleteness: 0,
  distance: 0,
  planTier: 0,
  [key]: 100,
});

describe("the state on the day this ships", () => {
  it("has no services vector, and services rank on the goods one", async () => {
    const live = await liveVectors();
    expect(live.services).toBeNull();
    expect(await liveWeights("services")).toEqual(live.goods);

    const firm = await makeFirm();
    expect(await vectorForBusiness(firm)).toEqual({ vector: "goods", weights: live.goods });
  });

  it("ranks a search exactly as the goods vector alone would", async () => {
    await makeFirm({ tier: 2 });
    await makeFirm({ tier: 0 });
    const live = await liveVectors();
    const scoped = { categoryIds: [child] };

    const ranked = await searchBusinesses(query(), scoped);
    const goodsOnly = await searchBusinesses(query(), {
      ...scoped,
      weights: live.goods,
      servicesWeights: null,
    });
    expect(ranked.rows.map((row) => row.id)).toEqual(goodsOnly.rows.map((row) => row.id));
  });
});

describe("criterion 2 — the services vector scores scope completeness", () => {
  it("separates two firms the goods vector cannot tell apart", async () => {
    const complete = await makeFirm();
    await makeService(complete);
    const incomplete = await makeFirm();
    await makeService(incomplete, { complete: false });

    const scoped = { categoryIds: [child], weights: only("specCompleteness") };
    // Neither firm holds a product, so spec completeness is unmeasured for both.
    const onGoods = await searchBusinesses(query(), { ...scoped, servicesWeights: null });
    const onServices = await searchBusinesses(query(), {
      ...scoped,
      servicesWeights: only("specCompleteness"),
    });

    const ids = onServices.rows.map((row) => row.id).filter((id) => id === complete || id === incomplete);
    expect(ids).toEqual([complete, incomplete]);
    expect(onGoods.rows).toHaveLength(onServices.rows.length);
  });
});

describe("criterion 4 — coverage match, per matched service", () => {
  it("scores the firm whose matched service reaches the emirate, and flips with the emirate", async () => {
    // Inherits a Sharjah default.
    const sharjahFirm = await makeFirm();
    await makeService(sharjahFirm);
    await prisma.serviceCoverage.create({
      data: { businessId: sharjahFirm, emirate: "sharjah", areaId: null },
    });

    // The practice whose listing reads both emirates: the default is Dubai, and
    // a payroll service — not the one this page matched — narrows to Sharjah.
    const unionFirm = await makeFirm();
    await makeService(unionFirm);
    const payroll = await makeService(unionFirm, { category: otherChild });
    await prisma.serviceCoverage.createMany({
      data: [
        { businessId: unionFirm, emirate: "dubai", areaId: null },
        { businessId: unionFirm, serviceId: payroll, emirate: "sharjah", areaId: null },
      ],
    });

    const coverageOnly = { categoryIds: [child], servicesWeights: only("distance") };
    const live = await liveVectors();

    const inSharjah = await searchBusinesses(query({ emirate: "sharjah" }), {
      ...coverageOnly,
      weights: live.goods,
    });
    const sharjahOrder = inSharjah.rows.map((row) => row.id).filter((id) => id === sharjahFirm || id === unionFirm);
    expect(sharjahOrder).toEqual([sharjahFirm, unionFirm]);

    const inDubai = await searchBusinesses(query({ emirate: "dubai" }), {
      ...coverageOnly,
      weights: live.goods,
    });
    const dubaiOrder = inDubai.rows.map((row) => row.id).filter((id) => id === sharjahFirm || id === unionFirm);
    expect(dubaiOrder).toEqual([unionFirm, sharjahFirm]);
  });
});

describe("criterion 1, 3 and 8 — one publish flow, keyed", () => {
  it("publishes a services vector and leaves the goods row, draft and history as they were", async () => {
    await makeFirm();
    const goodsBefore = await liveWeights("goods");
    const goodsHistoryBefore = await publishHistory("goods");

    // A goods draft sitting there the whole time.
    const goodsDraft = { ...DEFAULT_WEIGHTS, relevance: 32, responseTime: 20 };
    expect(await saveDraft(lead, "goods", goodsDraft, "redistribute", `${PREFIX}goods draft`)).toMatchObject({ ok: true });

    await publish("services", DEFAULT_SERVICES_WEIGHTS, `${PREFIX}services go live`);

    const live = await liveVectors();
    expect(live.services).toEqual(DEFAULT_SERVICES_WEIGHTS);
    expect(live.goods).toEqual(goodsBefore);
    expect((await draftState("goods"))?.weights).toEqual(goodsDraft);
    expect(await draftState("services")).toBeNull();

    const goodsHistoryAfter = await publishHistory("goods");
    expect(goodsHistoryAfter.map((row) => row.id)).toEqual(goodsHistoryBefore.map((row) => row.id));

    const [servicesPublish] = await publishHistory("services");
    expect(servicesPublish?.kind).toBe("services");
    expect(servicesPublish?.reason).toContain("services go live");
    // The first services publish has nothing of its own kind to diff against.
    expect(servicesPublish?.moved).toBeNull();

    // The legacy key stays pinned to the kind — the check constraint holds.
    const row = await prisma.rankingWeights.findUniqueOrThrow({ where: { kind: "services" } });
    expect(row.id).toBe("services");
  }, 180_000);

  it("refuses a second goods row at the database, whatever a caller does", async () => {
    await expect(
      prisma.rankingWeights.create({
        data: { id: "services", kind: "goods", ...DEFAULT_WEIGHTS },
      }),
    ).rejects.toThrow();
  });
});

describe("criterion 5 — plan tier is one number across both vectors", () => {
  it("refuses a services publish that would split it, and allows the pair to move together", async () => {
    await makeFirm();
    const services = { ...DEFAULT_SERVICES_WEIGHTS, planTier: 5, relevance: 31 };

    const mode = await liveBrowseRelevanceMode("services");
    expect(await saveDraft(lead, "services", services, mode, `${PREFIX}plan 5`)).toMatchObject({ ok: true });
    const preview = await runImpact({ kind: "services", draft: services, draftMode: mode, live: await liveVectors() });
    await storePreview("services", services, mode, preview);

    expect(await publishDraft(lead, "services", `${PREFIX}plan 5 alone`)).toMatchObject({
      ok: false,
      error: "plan_tier_diverges",
    });

    // The goods side drafts the same number; now the services publish agrees
    // with the draft waiting to follow it.
    const goods = { ...DEFAULT_WEIGHTS, planTier: 5, relevance: 35 };
    expect(await saveDraft(lead, "goods", goods, "redistribute", `${PREFIX}plan 5 goods`)).toMatchObject({ ok: true });
    expect(await publishDraft(lead, "services", `${PREFIX}plan 5 first`)).toMatchObject({ ok: true });

    // And the goods publish then agrees with the services live number.
    const goodsPreview = await runImpact({ kind: "goods", draft: goods, draftMode: "redistribute", live: await liveVectors() });
    await storePreview("goods", goods, "redistribute", goodsPreview);
    expect(await publishDraft(lead, "goods", `${PREFIX}plan 5 second`)).toMatchObject({ ok: true });

    const live = await liveVectors();
    expect(live.goods.planTier).toBe(5);
    expect(live.services?.planTier).toBe(5);
  }, 240_000);
});

describe("criterion 6 and 10 — the same rules on both vectors", () => {
  it("holds the ceiling on the services vector's effective browse vector", async () => {
    const refused = await saveDraft(
      lead,
      "services",
      { relevance: 50, verificationTier: 18, responseTime: 10, specCompleteness: 10, distance: 6, planTier: 6 },
      "redistribute",
      `${PREFIX}relevance 50`,
    );
    expect(refused).toMatchObject({ ok: false, error: "browse_plan_tier_too_high" });
  });

  it("refuses exactly what the goods vector refuses, and nothing more", async () => {
    const off = { ...DEFAULT_SERVICES_WEIGHTS, relevance: 29 };
    for (const kind of ["goods", "services"] as const) {
      expect(await saveDraft(lead, kind, off, "redistribute", `${PREFIX}99`)).toMatchObject({
        ok: false,
        error: "total_not_100",
      });
    }
  });
});

describe("criterion 7 — the preview is scoped to the vector", () => {
  it("counts only services scopes for a services draft", async () => {
    // Two firms whose order the goods vector and a scope-heavy services vector
    // disagree about: the stronger tier has the incomplete sheet.
    const strongTier = await makeFirm({ tier: 2 });
    await makeService(strongTier, { complete: false });
    const completeSheet = await makeFirm({ tier: 1 });
    await makeService(completeSheet);

    const draft: RankingWeights = {
      relevance: 10,
      verificationTier: 10,
      responseTime: 10,
      specCompleteness: 60,
      distance: 4,
      planTier: 6,
    };
    const preview = await runImpact({
      kind: "services",
      draft,
      draftMode: "redistribute",
      live: await liveVectors(),
    });

    expect(preview.kind).toBe("services");
    expect(preview.rows.length).toBeGreaterThan(0);
    const kinds = await loadTradeKinds();
    for (const row of preview.rows) {
      expect(resolveTradeKind(kinds, row.categoryId), row.scopeLabel).toBe("services");
      expect(row.vector).toBe("services");
    }
    expect(preview.rows.some((row) => row.categoryId === child)).toBe(true);
    expect(preview.sellersTold).toBeLessThanOrEqual(preview.sellersInScope);
    expect(preview.sellersInScope).toBeLessThanOrEqual(preview.scopedListings);
  }, 120_000);

  it("moves no services scope with a goods draft once services have their own vector", async () => {
    await makeFirm({ tier: 2 });
    await makeFirm({ tier: 0 });
    await publish("services", DEFAULT_SERVICES_WEIGHTS, `${PREFIX}services live first`);

    const preview = await runImpact({
      kind: "goods",
      draft: { relevance: 10, verificationTier: 80, responseTime: 0, specCompleteness: 0, distance: 4, planTier: 6 },
      draftMode: "category_depth",
      live: await liveVectors(),
    });
    const kinds = await loadTradeKinds();
    for (const row of preview.rows) {
      expect(resolveTradeKind(kinds, row.categoryId), row.scopeLabel).toBe("goods");
    }
  }, 180_000);
});

describe("criterion 9 — only register-checked verification scores", () => {
  it("moves nothing when a seller adds a credential", async () => {
    const firm = await makeFirm({ tier: 1 });
    await makeService(firm);

    const scoreNow = async () => {
      const [{ rows }, kinds] = await Promise.all([loadDirectory(), loadTradeKinds()]);
      const candidate = candidatesFrom(rows, new Map()).find((row) => row.id === firm)!;
      return placeIn(candidate, child, null, {
        vectors: { goods: DEFAULT_WEIGHTS, services: DEFAULT_SERVICES_WEIGHTS },
        kinds,
        descendants: descendantsIndex(kinds),
      });
    };

    const before = await scoreNow();
    await prisma.credential.create({
      data: { businessId: firm, kind: "other", identifier: `${PREFIX}cert`, issuer: "An institute" },
    });
    const after = await scoreNow();

    expect(after.vector).toBe("services");
    expect(after.scores.verificationTier).toBe(before.scores.verificationTier);
    expect(after.score).toBe(before.score);
  }, 120_000);
});

describe("criterion 11 — the vector follows Category.tradeKind, not the business", () => {
  it("moves a listing between vectors when ops reclassify its trade, with nothing on the business touched", async () => {
    const firm = await makeFirm();
    await publish("services", DEFAULT_SERVICES_WEIGHTS, `${PREFIX}services live`);
    expect((await vectorForBusiness(firm)).vector).toBe("services");

    // `sellsKind` says services the whole time. Only the taxonomy moves.
    await prisma.category.update({ where: { id: sector }, data: { tradeKind: "goods" } });
    try {
      expect((await vectorForBusiness(firm)).vector).toBe("goods");
      expect((await prisma.business.findUniqueOrThrow({ where: { id: firm } })).sellsKind).toBe("services");
    } finally {
      await prisma.category.update({ where: { id: sector }, data: { tradeKind: "services" } });
    }
  }, 180_000);
});

describe("the nightly snapshot records which vector ranked each listing", () => {
  it("writes services for a services firm once its vector is live, and goods beside it", async () => {
    const servicesFirm = await makeFirm();
    await makeService(servicesFirm);
    const goodsFirm = await makeFirm({ category: goodsCategory });
    await publish("services", DEFAULT_SERVICES_WEIGHTS, `${PREFIX}services live for the night`);

    // A night nobody else writes, so the suite's other factor rows are untouched.
    const night = new Date("2099-03-01T20:00:00Z");
    await runPositionSnapshots(night);

    const rows = await prisma.listingFactorDay.findMany({
      where: { businessId: { in: [servicesFirm, goodsFirm] } },
      select: { businessId: true, vector: true, weights: true, raw: true },
    });
    const byId = new Map(rows.map((row) => [row.businessId, row]));

    expect(byId.get(servicesFirm)?.vector).toBe("services");
    expect(byId.get(servicesFirm)?.weights).toMatchObject({ verificationTier: expect.any(Number) });
    expect((byId.get(servicesFirm)?.raw as { scopeCompleteness: number }).scopeCompleteness).toBe(1);
    expect(byId.get(goodsFirm)?.vector).toBe("goods");

    await prisma.listingFactorDay.deleteMany({ where: { day: { gte: new Date("2099-01-01") } } });
    await prisma.categoryRankDay.deleteMany({ where: { day: { gte: new Date("2099-01-01") } } });
  }, 240_000);
});
