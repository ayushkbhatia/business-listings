import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { countAccounts } from "@/lib/accounts/list";
import { periodFigures, revenueBoard } from "@/lib/billing/revenue-board";
import { currentPeriod, lastClosedPeriod } from "@/lib/billing/revenue-period";
import { readHomeStats } from "@/lib/db/queries/home";
import { PAGE_SIZE } from "@/lib/db/queries/search";
import { readLive, readSnapshot, reconcileOverview } from "@/lib/console/overview";
import { assembleOverview } from "@/lib/console/overview-view";
import { mayOpen } from "@/lib/console/visibility";
import { loadQueue, queueCount } from "@/lib/moderation/queue";
import { quotedValueBySector, quotedValueByWindow, quotedValueIn } from "@/lib/quote/quoted-value";
import { loadReportQueue, reportQueueHealth } from "@/lib/reports/queue";
import { noGoodResultQueries } from "@/lib/search/no-good-result";
import { FIRST_PAGE } from "@/lib/search/no-good-result-rule";
import { loadTaxonomyTree } from "@/lib/taxonomy/board";
import { TOP_ACHIEVABLE_TIER, VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 4a against a real database — the acceptance criteria that are about
 * numbers agreeing, run on the seed:
 *
 *   2. The queue tile, the needs-a-human rows and `4b`/`4h`'s own headers
 *      return identical counts, in one test.
 *   3. The plan mix sums to Claimed, and Basic + Pro equals Paid.
 *   4. MRR equals `4g`'s ending MRR for the period, from the same function.
 *   7. Category rows are sectors, and add up to the directory.
 *
 * And Phase 5's e2e criterion in its database form: every figure equals the
 * count its link's destination states, because each destination filter is the
 * predicate the figure was counted with.
 *
 * `consoleOverview` and its five panels are gone; the expiring-licence cases
 * it held (build plan 1.5: `gte: 3` against a ladder ending at 2) are kept
 * below, against the figure that replaced it.
 */

const PREFIX = "platform-overview-4a-";
const OPS: Actor = { id: "00000000-0000-4000-8000-0000000004a1", roles: ["staff_ops_lead"] };
const MODERATOR: Actor = { id: "00000000-0000-4000-8000-0000000004a2", roles: ["staff_moderator"] };
const FINANCE: Actor = { id: "00000000-0000-4000-8000-0000000004a3", roles: ["staff_finance"] };

let categoryId: string;
const made: string[] = [];

async function makeSupplier(tier: number, licenceExpiry: Date): Promise<string> {
  const mark = `${Date.now().toString(36)}${made.length}`;
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-4A${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry,
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      verificationTier: tier,
      verifiedAt: new Date(),
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ where: { slug: "valves-and-fittings" }, select: { id: true } });
  categoryId = category.id;
});

afterAll(async () => {
  for (const id of made.splice(0)) await prisma.business.deleteMany({ where: { id } });
  await prisma.searchQueryLog.deleteMany({ where: { normalised: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("criterion 2 — the queue counts are 4b's and 4h's, in one test", () => {
  it("states the queue tile, the needs-a-human rows, both headers and the sidebar badge alike", async () => {
    const now = new Date();
    const [live, queue, reports, badge, health] = await Promise.all([
      readLive(OPS, now),
      loadQueue({}, now),
      loadReportQueue({}, now),
      queueCount(),
      reportQueueHealth(now),
    ]);
    expect(live.queue!.open).toBe(queue.total);
    expect(live.queue!.overSla).toBe(queue.overSla);
    expect(live.queue!.conflicts).toBe(queue.counts.conflict);
    expect(live.queue!.open).toBe(badge);
    expect(live.reports!.open).toBe(reports.total);
    expect(live.reports!.open).toBe(health.open);
    expect(live.reports!.overSla).toBe(reports.overSla);
    for (const entry of live.reports!.types) expect(entry.count, entry.type).toBe(reports.counts[entry.type]);
  }, 60_000);

  it("opens each needs-a-human row onto exactly the rows it counted", async () => {
    const now = new Date();
    const live = await readLive(OPS, now);
    const [overdue, conflicts, late] = await Promise.all([
      loadQueue({ overdue: true }, now),
      loadQueue({ kind: "conflict" }, now),
      loadReportQueue({ late: true }, now),
    ]);
    expect(overdue.rows.length).toBe(live.queue!.overSla);
    expect(overdue.rows.every((row) => row.late)).toBe(true);
    expect(conflicts.rows.length).toBe(live.queue!.conflicts);
    expect(late.rows.length).toBe(live.reports!.overSla);
    for (const entry of live.reports!.types) {
      const filtered = await loadReportQueue({ type: entry.type }, now);
      expect(filtered.rows.length, entry.type).toBe(entry.count);
    }
  }, 60_000);

  it("gives the queue to no seat that cannot open it", async () => {
    const live = await readLive(FINANCE);
    expect(live.queue).toBeNull();
    expect(live.reports).toBeNull();
  }, 60_000);
});

describe("criterion 4 — MRR is 4g's, from the same function", () => {
  it("equals the revenue board's ending MRR and paying count for the month in progress and the last closed one", async () => {
    const now = new Date();
    for (const period of [currentPeriod(now), lastClosedPeriod(now)]) {
      const [snapshot, figures, board] = await Promise.all([readSnapshot(period.key, now), periodFigures(period), revenueBoard(period, now)]);
      expect(snapshot.mrr.endingFils, period.key).toBe(figures.endingFils);
      expect(snapshot.mrr.endingFils, period.key).toBe(board.current.endingFils);
      expect(snapshot.mrr.startingFils, period.key).toBe(figures.month.startingFils);
      expect(snapshot.paid.atEnd, period.key).toBe(figures.month.payingAtEnd);
      // D-MRR: the composition adds up to that same figure.
      const composition = snapshot.mrr.composition;
      expect(composition.atListFils + composition.annual.fils + composition.other.fils, period.key).toBe(figures.endingFils);
      expect(composition).toEqual(board.composition);
    }
  }, 120_000);
});

describe("criterion 3 — the plan mix", () => {
  it("sums to Claimed, and its paid rows to Paid, on the month in progress", async () => {
    const now = new Date();
    const period = currentPeriod(now);
    const [snapshot, live] = await Promise.all([readSnapshot(period.key, now), readLive(FINANCE, now)]);
    const view = assembleOverview(snapshot, live, (navKey) => mayOpen(FINANCE, navKey));
    const rows = view.planMix!.rows;
    expect(rows.reduce((sum, row) => sum + row.accounts, 0)).toBe(view.figures.claimed.value);
    const paid = rows.filter((row) => row.planId !== null).reduce((sum, row) => sum + row.accounts, 0);
    const unclaimed = live.warnings.find((warning) => warning.kind === "unclaimed_payers")?.ours ?? 0;
    expect(paid + unclaimed).toBe(view.figures.paid.atEnd);
  }, 120_000);

  it("says so on the Paid tile wherever the plan column and the ledger disagree", async () => {
    const live = await readLive(FINANCE);
    const ledgerPayers = live.planMix.reduce((sum, plan) => sum + plan.accounts, 0);
    const column = await prisma.business.count({ where: { claimStatus: "claimed", plan: { is: { monthlyPriceAed: { gt: 0 } } } } });
    const warning = live.warnings.find((candidate) => candidate.kind === "plan_column");
    if (ledgerPayers === column) expect(warning).toBeUndefined();
    else expect(warning).toEqual({ kind: "plan_column", tile: "paid", ours: ledgerPayers, theirs: column });
  }, 60_000);
});

describe("criterion 7 and B1 — every figure is the count its destination states", () => {
  it("counts live listings as the tree, the home page and the filtered list do", async () => {
    const now = new Date();
    const [live, tree, home, listed] = await Promise.all([
      readLive(OPS, now),
      loadTaxonomyTree(),
      readHomeStats(),
      countAccounts({ status: "live" }, now),
    ]);
    expect(live.listingsLive).toBe(tree.totals.listings);
    expect(live.listingsLive).toBe(listed);
    if (tree.totals.listings === home.listings) expect(live.warnings.some((warning) => warning.kind === "listings_home")).toBe(false);
  }, 60_000);

  it("counts claimed and paying as the accounts list filters them", async () => {
    const now = new Date();
    const [live, claimed, claimedLive] = await Promise.all([
      readLive(OPS, now),
      countAccounts({ claimed: true }, now),
      countAccounts({ status: "live", claimed: true }, now),
    ]);
    expect(live.claimed).toBe(claimed);
    expect(live.claimedLive).toBe(claimedLive);
  }, 60_000);

  it("lists sectors only, and their listings add up to the directory", async () => {
    const [live, sectors] = await Promise.all([
      readLive(OPS),
      prisma.category.count({ where: { parentId: null } }),
    ]);
    expect(live.sectors).toHaveLength(sectors);
    expect(live.sectors.reduce((sum, sector) => sum + sector.listings, 0)).toBe(live.listingsLive);
    for (const sector of live.sectors) {
      expect(sector.claimed, sector.name).toBeLessThanOrEqual(sector.listings);
      expect(await countAccounts({ status: "live", claimed: true, sector: sector.id }, new Date()), sector.name).toBe(sector.claimed);
    }
  }, 120_000);
});

describe("the expiring-licence figure counts a licence that is actually about to lapse", () => {
  /*
     The console's trust panel asked for `verificationTier >= 3` against a
     ladder ending at 2 and showed 0 for every day it shipped (build plan 1.5),
     then linked its number to the unfiltered list. It is one predicate now,
     read by the figure and the `licence=expiring` filter it opens.
  */
  const expiring = async () => (await readLive(OPS)).otherQueues.find((queue) => queue.key === "licences_expiring")!.count;

  it("has a ladder the figure can reach", () => {
    expect(TOP_ACHIEVABLE_TIER).toBe(VERIFIED_TIER);
    expect(VERIFIED_TIER).toBe(2);
  });

  it("counts a verified supplier whose licence lapses inside the window, and the filter lists it", async () => {
    const before = await expiring();
    const now = new Date();
    await makeSupplier(VERIFIED_TIER, new Date(now.getTime() + 10 * 86_400_000));
    expect(await expiring()).toBe(before + 1);
    expect(await countAccounts({ licence: "expiring" }, new Date())).toBe(before + 1);
  }, 60_000);

  it("leaves out a licence that runs past the window, and a claimed supplier nobody verified", async () => {
    const before = await expiring();
    const now = new Date();
    await makeSupplier(VERIFIED_TIER, new Date(now.getTime() + 200 * 86_400_000));
    await makeSupplier(1, new Date(now.getTime() + 5 * 86_400_000));
    expect(await expiring()).toBe(before);
  }, 60_000);
});

describe("quoted value is one sum, however it is cut", () => {
  it("adds up the same by month, by sector and over the window", async () => {
    const now = new Date();
    const period = lastClosedPeriod(now);
    const from = new Date(period.from.getTime() - 400 * 86_400_000);
    const [whole, sectors, windows] = await Promise.all([
      quotedValueIn(from, now),
      quotedValueBySector(from, now),
      quotedValueByWindow([{ key: "all", from, to: now }]),
    ]);
    expect(sectors.reduce((sum, row) => sum + row.fils, 0)).toBe(whole.fils);
    expect(sectors.reduce((sum, row) => sum + row.quotes, 0)).toBe(whole.quotes);
    expect(windows.get("all")).toEqual(whole);
    expect(whole.quotes + whole.proposals).toBe(
      await prisma.quote.count({ where: { status: "accepted", acceptedAt: { gte: from, lt: now } } }),
    );
  }, 60_000);
});

describe("D-NOGOOD — a search with no good result", () => {
  it("checks the first page the search itself shows", () => {
    expect(FIRST_PAGE).toBe(PAGE_SIZE);
  });

  it("names a much-searched query that finds no claimed, verified supplier, with its volume", async () => {
    const normalised = `${PREFIX}zzqx nothing sells this`;
    const now = new Date();
    await prisma.searchQueryLog.createMany({
      data: Array.from({ length: 50 }, () => ({ query: normalised, normalised, resultCount: 0, tab: "businesses" })),
    });
    const report = await noGoodResultQueries(new Date(now.getTime() - 60_000), new Date(now.getTime() + 60_000));
    const row = report.rows.find((candidate) => candidate.normalised === normalised);
    expect(row).toEqual({ query: normalised, normalised, searches: 50, suppliersToday: 0 });
    expect(report.checked).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe("B10 — what each seat's overview holds", () => {
  it("gives a moderator neither MRR nor the plan mix, and keeps the money queues from them", async () => {
    const now = new Date();
    const [snapshot, live] = await Promise.all([readSnapshot(currentPeriod(now).key, now), readLive(MODERATOR, now)]);
    const view = assembleOverview(snapshot, live, (navKey) => mayOpen(MODERATOR, navKey));
    expect(view.figures.mrr).toBeUndefined();
    expect(view.planMix).toBeUndefined();
    expect(live.otherQueues.map((queue) => queue.key)).not.toContain("past_due");
    expect(live.otherQueues.map((queue) => queue.key)).not.toContain("invoices_outstanding");
  }, 120_000);
});

describe("Phase 5 — the reconciliation, nightly and live", () => {
  it("finds what the overview's tiles say, from the same comparison", async () => {
    const now = new Date();
    const [nightly, live] = await Promise.all([reconcileOverview(now), readLive(FINANCE, now)]);
    expect(nightly.checked).toBe(5);
    expect(nightly.disagreements).toEqual(live.warnings);
  }, 60_000);
});
