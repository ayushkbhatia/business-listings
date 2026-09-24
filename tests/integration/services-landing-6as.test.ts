import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { areaMatrix } from "@/lib/content/matrix";
import { BRIEF_MAX_RECIPIENTS } from "@/lib/enquiry/service-brief";
import { previewBrief } from "@/lib/enquiry/service-brief-server";
import { dubaiDayStart } from "@/lib/format/date";
import { livePages, publishAreaPage, saveAreaIntro } from "@/lib/seo/area";
import {
  liveEmiratePages,
  MATRIX_EMIRATES,
  publishEmiratePage,
  saveEmirateIntro,
  servicesTradeRows,
} from "@/lib/seo/emirate";
import {
  areaPagesInEmirate,
  landingResultCount,
  landingState,
  memberScopeOf,
  resolveAreaScope,
  resolveEmirateScope,
  saveLandingFaq,
  servicesMembers,
  servicesStats,
  siblingLinks,
  supplyDigest,
  type LandingScope,
} from "@/lib/seo/landing";
import { candidatesFrom, scopesOf, type DirectoryRow } from "@/lib/search/directory";
import { DEFAULT_WEIGHTS } from "@/lib/search/ranking";
import { loadTradeKinds } from "@/lib/taxonomy/service";
import {
  categoryAsks,
  credentialKindFor,
  saveServicesLandingCopy,
  setServicesLandingOpen,
} from "@/lib/taxonomy/services-landing";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board `6a-s` — the services landing page's rules, against a real database.
 *
 * Its own trade, its own places and its own firms, so no seeded page moves and
 * no count another suite pins changes. Each rule is checked from both sides:
 * the firm that belongs, and the one built to look as if it does.
 *
 *   B1   coverage, not address — and per service, never the union
 *   B4   a checked credential counts; a lapsed one and a claim do not
 *   B11  the goods gate, unchanged, on a count of the right firms
 *   B7   every anchor across the class is a live page, and every live page is
 *        an anchor somewhere — asserted as a set comparison
 *   B3   the fan-out's count is the matcher's, capped at eight
 *   and  the rollout flag, the matrix agreeing with the route, the emirate
 *        class below sector level, and the snapshot listing by coverage.
 */

const PREFIX = "svc6as-it-";
const DAY = 86_400_000;
const REASON = "Board 6a-s integration fixture";

let lead: Actor;
let sectorId: string;
let vatId: string;
let goodsId: string;
let bay: { id: string; slug: string };
let down: { id: string; slug: string };
let far: { id: string; slug: string };
const firms: Record<string, string> = {};
let seq = 0;

const INTRO = Array.from({ length: 30 }, () => "Practices covering the canal district for quarterly compliance.").join(" ");
const FAQ = [
  { question: "Local one?", answer: "Yes.", scopeSpecific: true },
  { question: "Local two?", answer: "Yes.", scopeSpecific: true },
  { question: "General one?", answer: "Yes.", scopeSpecific: false },
  { question: "General two?", answer: "Yes.", scopeSpecific: false },
];

function stamp(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

interface FirmInput {
  key: string;
  primary?: string;
  tier?: number;
  claimed?: boolean;
  licenceDays?: number;
  defaults?: { emirate: "dubai" | "sharjah" | "abu_dhabi"; areaId?: string }[];
  branch?: { emirate: "dubai" | "sharjah"; areaId: string };
  service?: { narrowedTo?: { emirate: "dubai" | "sharjah" | "abu_dhabi"; areaId?: string }[] } | null;
  fta?: { expiresOn: Date | null } | null;
}

async function makeFirm(input: FirmInput): Promise<string> {
  const id = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `Svc Test ${id}`,
      displayName: `Svc Test ${input.key} ${id}`,
      slug: `${PREFIX}${input.key}-${id}`,
      licenceNumber: `DED-6AS${id.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + (input.licenceDays ?? 300) * DAY),
      primaryCategoryId: input.primary ?? vatId,
      claimStatus: input.claimed === false ? "unclaimed" : "claimed",
      publishedAt: new Date(Date.now() - 100 * DAY),
      verificationTier: input.tier ?? 2,
      verifiedAt: (input.tier ?? 2) > 0 ? new Date(Date.now() - 90 * DAY) : null,
      sellsKind: input.claimed === false ? "unset" : "services",
      ...(input.branch
        ? {
            locations: {
              create: {
                type: "head_office",
                emirate: input.branch.emirate,
                areaId: input.branch.areaId,
                addressLine: "Office 1",
                published: true,
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });
  for (const row of input.defaults ?? []) {
    await prisma.serviceCoverage.create({
      data: { businessId: business.id, emirate: row.emirate, areaId: row.areaId ?? null },
    });
  }
  if (input.service !== null && input.service !== undefined) {
    const service = await prisma.service.create({
      data: {
        businessId: business.id,
        categoryId: vatId,
        name: "Test compliance",
        slug: "test-compliance",
        status: "live",
        publishedAt: new Date(),
        feeBasis: "per_return",
        deliveredWhere: "remote",
      },
      select: { id: true },
    });
    for (const row of input.service.narrowedTo ?? []) {
      await prisma.serviceCoverage.create({
        data: { businessId: business.id, serviceId: service.id, emirate: row.emirate, areaId: row.areaId ?? null },
      });
    }
  }
  if (input.fta) {
    await prisma.credential.create({
      data: {
        businessId: business.id,
        kind: "fta_tax_agent",
        identifier: `2${id.slice(-7).padStart(7, "0")}`,
        expiresOn: input.fta.expiresOn,
        trust: "register_verified",
        verifiedOn: new Date(Date.now() - 30 * DAY),
        verifiedBy: "FTA tax agent register",
        review: "auto_verified",
        reviewOpenedAt: new Date(Date.now() - 30 * DAY),
      },
    });
  }
  firms[input.key] = business.id;
  return business.id;
}

async function scopeOf(areaSlug: string): Promise<LandingScope> {
  const vat = await prisma.category.findUniqueOrThrow({ where: { id: vatId }, select: { slug: true } });
  return (await resolveAreaScope({ emirate: "dubai", area: areaSlug, category: vat.slug })) as LandingScope;
}

async function writeCopy(scope: LandingScope) {
  if (scope.area) {
    await saveAreaIntro({ actor: lead, areaId: scope.area.id, categoryId: vatId, intro: INTRO, reason: REASON });
  } else {
    await saveEmirateIntro({ actor: lead, emirate: scope.emirate, categoryId: vatId, intro: INTRO, reason: REASON });
  }
  await saveLandingFaq(lead, scope, FAQ, REASON);
}

async function removeFixtures() {
  const categories = await prisma.category.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  const ids = categories.map((row) => row.id);
  await purgeAuditRows({
    OR: [
      { subject: { in: ids.map((id) => `Category:${id}`) } },
      { subject: { startsWith: `AreaPage:${PREFIX}` } },
      { subject: { contains: `/${PREFIX}` } },
    ],
  });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.areaPage.deleteMany({ where: { categoryId: { in: ids } } });
  await prisma.emiratePage.deleteMany({ where: { categoryId: { in: ids } } });
  await prisma.area.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { parentId: { in: ids } } });
  await prisma.category.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  const opsLead = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_ops_lead" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  lead = { id: opsLead.id, roles: ["staff_ops_lead"] };
  await removeFixtures();

  // A services sector and its VAT trade. Small floors, so a handful of firms
  // can clear them — the rules are the goods gate's, only the numbers are ours.
  const rules = { publishThreshold: 4, verifiedShareMin: 0.3, minIntroWords: 50 };
  sectorId = (
    await prisma.category.create({
      data: { name: "Svc Test Sector", slug: `${PREFIX}sector`, code: "SX", tradeKind: "services", sortOrder: 99, ...rules },
      select: { id: true },
    })
  ).id;
  vatId = (
    await prisma.category.create({
      data: { parentId: sectorId, name: "Svc Test VAT", slug: `${PREFIX}vat`, code: "SV", sortOrder: 99, ...rules },
      select: { id: true },
    })
  ).id;
  goodsId = (
    await prisma.category.create({
      data: { parentId: sectorId, name: "Svc Test Supplies", slug: `${PREFIX}supplies`, code: "SG", tradeKind: "goods", sortOrder: 99 },
      select: { id: true },
    })
  ).id;

  bay = await prisma.area.create({
    data: { emirate: "dubai", name: "Svc Test Bay", slug: `${PREFIX}bay`, lat: 25.18, lng: 55.26 },
    select: { id: true, slug: true },
  });
  down = await prisma.area.create({
    data: { emirate: "dubai", name: "Svc Test Down", slug: `${PREFIX}down`, lat: 25.19, lng: 55.27 },
    select: { id: true, slug: true },
  });
  far = await prisma.area.create({
    data: { emirate: "dubai", name: "Svc Test Far", slug: `${PREFIX}far`, lat: 25.27, lng: 55.31 },
    select: { id: true, slug: true },
  });

  const today = dubaiDayStart(new Date());
  // Covers Dubai from an office elsewhere, a checked FTA number — the premise.
  await makeFirm({
    key: "remote",
    defaults: [{ emirate: "dubai" }],
    branch: { emirate: "dubai", areaId: far.id },
    service: {},
    fta: { expiresOn: new Date(today.getTime() + 200 * DAY) },
  });
  // Dubai default, but its VAT service is narrowed to Sharjah: the union lies.
  await makeFirm({ key: "narrowed", defaults: [{ emirate: "dubai" }], service: { narrowedTo: [{ emirate: "sharjah" }] } });
  // Filed under a goods trade, publishing a live VAT service that covers Dubai.
  await makeFirm({ key: "crossfiled", primary: goodsId, defaults: [{ emirate: "dubai" }], service: {} });
  // An unclaimed licence import, in the district by address and nothing else.
  await makeFirm({ key: "office", tier: 0, claimed: false, branch: { emirate: "dubai", areaId: bay.id }, service: null });
  // Its default names the bay alone.
  await makeFirm({ key: "baronly", defaults: [{ emirate: "dubai", areaId: bay.id }], service: {} });
  // Tier 2 stored, licence lapsed yesterday, sweep not yet run.
  await makeFirm({ key: "lapsedlicence", licenceDays: -1, defaults: [{ emirate: "dubai" }], service: {} });
  // A checked FTA number whose confirmed date passed yesterday.
  await makeFirm({
    key: "lapsedfta",
    defaults: [{ emirate: "dubai" }],
    service: {},
    fta: { expiresOn: new Date(today.getTime() - DAY) },
  });
}, 120_000);

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("B1 — the set is a coverage query, resolved per service", () => {
  it("lists firms that cover the place, wherever they sit, and none the union would", async () => {
    const scope = await scopeOf(bay.slug);
    expect(scope.trade).toBe("services");
    const members = await servicesMembers(memberScopeOf(scope));
    const ids = new Set(members.map((member) => member.id));

    expect(ids.has(firms["remote"]!)).toBe(true);
    expect(ids.has(firms["crossfiled"]!)).toBe(true);
    expect(ids.has(firms["office"]!)).toBe(true);
    expect(ids.has(firms["baronly"]!)).toBe(true);
    expect(ids.has(firms["narrowed"]!)).toBe(false);

    expect(members.find((m) => m.id === firms["remote"])?.membership.reach).toBe("coverage");
    expect(members.find((m) => m.id === firms["office"])?.membership.reach).toBe("branch");
  });

  it("drops a firm whose only reach is an area row somewhere else", async () => {
    const members = await servicesMembers(memberScopeOf(await scopeOf(down.slug)));
    const ids = new Set(members.map((member) => member.id));
    expect(ids.has(firms["baronly"]!)).toBe(false);
    expect(ids.has(firms["office"]!)).toBe(false);
    expect(ids.has(firms["remote"]!)).toBe(true);
  });

  it("counts the gate, the pager and the digest over the same set", async () => {
    const scope = await scopeOf(bay.slug);
    const [members, state, count, digest] = await Promise.all([
      servicesMembers(memberScopeOf(scope)),
      landingState(scope),
      landingResultCount(scope, null),
      supplyDigest(scope),
    ]);
    expect(state.listings).toBe(members.length);
    expect(count).toBe(members.length);
    expect(digest.startsWith(`${members.length}-`)).toBe(true);
    // Licence-verified is the tier AND a licence that has not lapsed today.
    expect(state.verified).toBe(members.filter((m) => m.verified).length);
    expect(members.find((m) => m.id === firms["lapsedlicence"])?.verified).toBe(false);
  });
});

describe("B4 — a credential counts when it is checked and current", () => {
  it("counts the checked FTA agent, not the lapsed one, for a trade that names the credential", async () => {
    await prisma.category.update({ where: { id: vatId }, data: { credentialKind: "fta_tax_agent" } });
    const scope = await scopeOf(bay.slug);
    const origin = await credentialKindFor(vatId);
    expect(origin).toEqual({ kind: "fta_tax_agent", from: "own" });
    const stats = await servicesStats(memberScopeOf(scope), origin.kind);
    expect(stats.credential).toEqual({ kind: "fta_tax_agent", holders: 1 });
    expect(stats.unclaimed).toBe(1);
  });

  it("states no credential count for a kind no register can check", async () => {
    const scope = await scopeOf(bay.slug);
    const stats = await servicesStats(memberScopeOf(scope), "mof_audit_approval");
    expect(stats.credential).toBeNull();
  });
});

describe("the rollout flag and the gate", () => {
  it("keeps a published page dark while the template is closed, and refuses to publish it", async () => {
    const scope = await scopeOf(bay.slug);
    await writeCopy(scope);
    const closed = await landingState(scope);
    expect(closed.clearsFloors).toBe(true);
    expect(closed.templateOpen).toBe(false);

    const refused = await publishAreaPage(lead, bay.id, vatId, REASON);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toBe("template_closed");
  });

  it("opens with a reason, audited, and the page goes live and into the sitemap", async () => {
    const opened = await setServicesLandingOpen({ actor: lead, categoryId: vatId, open: true, reason: REASON });
    expect(opened).toEqual({ ok: true });
    const audit = await prisma.auditEvent.findFirst({
      where: { subject: `Category:${vatId}`, reason: REASON },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();

    const published = await publishAreaPage(lead, bay.id, vatId, REASON);
    expect(published.ok).toBe(true);
    const state = await landingState(await scopeOf(bay.slug));
    expect(state.live).toBe(true);
    const paths = (await livePages()).map((page) => `/${page.emirate}/${page.areaSlug}/${page.categorySlug}`);
    expect(paths).toContain(`/dubai/${bay.slug}/${PREFIX}vat`);
  });

  it("refuses to open the template for a trade sold by the item", async () => {
    const refused = await setServicesLandingOpen({ actor: lead, categoryId: goodsId, open: true, reason: REASON });
    expect(refused).toEqual({ ok: false, error: "not_services" });
  });

  it("agrees with the 6f matrix about the row: the same count, the same live state", async () => {
    const matrix = await areaMatrix({ categoryId: vatId, emirate: "dubai", perPage: 1_000 });
    const row = matrix.rows.find((entry) => entry.areaId === bay.id);
    const state = await landingState(await scopeOf(bay.slug));
    expect(row?.trade).toBe("services");
    expect(row?.listings).toBe(state.listings);
    expect(row?.verified).toBe(state.verified);
    expect(row?.live).toBe(state.live);
  });
});

describe("D-EMI — the emirate class below sector level, for work only", () => {
  it("resolves a services subcategory across an emirate, and never a goods one", async () => {
    const services = await resolveEmirateScope({ emirate: "dubai", category: `${PREFIX}vat` });
    expect(services?.trade).toBe("services");
    expect(await resolveEmirateScope({ emirate: "dubai", category: `${PREFIX}supplies` })).toBeNull();
  });

  it("publishes, and joins the sitemap and the area pages' link graph", async () => {
    const scope = (await resolveEmirateScope({ emirate: "dubai", category: `${PREFIX}vat` }))!;
    await writeCopy(scope);
    const published = await publishEmiratePage(lead, "dubai", vatId, REASON);
    expect(published.ok).toBe(true);
    expect((await landingState(scope)).live).toBe(true);
    expect(await liveEmiratePages()).toContainEqual({ emirate: "dubai", categorySlug: `${PREFIX}vat` });
  });

  it("is linked from the category index, in a row under its sector, so it is never an orphan", async () => {
    // The only live page in its trade so far — nothing else would link it.
    const row = (await servicesTradeRows()).find((entry) => entry.id === vatId);
    expect(row?.sectorId).toBe(sectorId);
    expect(row?.cells.map((cell) => cell.emirate)).toEqual([...MATRIX_EMIRATES]);
    expect(row?.cells.filter((cell) => cell.live).map((cell) => cell.emirate)).toEqual(["dubai"]);
    // The count in the cell is the page's own.
    const scope = (await resolveEmirateScope({ emirate: "dubai", category: `${PREFIX}vat` }))!;
    expect(row?.cells.find((cell) => cell.emirate === "dubai")?.listings).toBe((await landingState(scope)).listings);
  });
});

describe("B7 — the anchors across the class are the live pages, exactly", () => {
  it("holds as a set comparison once a second area page is live", async () => {
    const downScope = await scopeOf(down.slug);
    await writeCopy(downScope);
    expect((await publishAreaPage(lead, down.id, vatId, REASON)).ok).toBe(true);

    const bayScope = await scopeOf(bay.slug);
    const emirate = (await resolveEmirateScope({ emirate: "dubai", category: `${PREFIX}vat` }))!;
    const live = new Set(
      [
        ...(await livePages()).map((page) => `/${page.emirate}/${page.areaSlug}/${page.categorySlug}`),
        ...(await liveEmiratePages()).map((page) => `/${page.emirate}/${page.categorySlug}`),
      ].filter((path) => path.includes(PREFIX)),
    );

    // Two area pages and the emirate page — a comparison of two empty sets
    // would pass as well, and prove nothing.
    expect(live.size).toBe(3);

    const emirateLive = (await landingState(emirate)).live;
    const anchors = new Set<string>();
    for (const scope of [bayScope, downScope, emirate]) {
      const siblings = await siblingLinks(scope);
      for (const link of [...siblings.otherAreas, ...siblings.otherEmirates, ...siblings.otherTrades]) anchors.add(link.href);
      for (const link of await areaPagesInEmirate(scope)) anchors.add(link.href);
      // The breadcrumb's emirate crumb is an anchor only where that page is live.
      if (scope.area && emirateLive) anchors.add(`/${scope.emirate}/${scope.category.slug}`);
    }
    const fixtureAnchors = new Set([...anchors].filter((href) => href.includes(PREFIX)));
    expect(fixtureAnchors).toEqual(live);
  });

  it("drops every anchor and every sitemap entry when the template closes", async () => {
    await setServicesLandingOpen({ actor: lead, categoryId: vatId, open: false, reason: REASON });
    const paths = (await livePages()).map((page) => page.categorySlug);
    expect(paths).not.toContain(`${PREFIX}vat`);
    const siblings = await siblingLinks(await scopeOf(bay.slug));
    expect(siblings.otherAreas).toEqual([]);
    expect(await liveEmiratePages()).not.toContainEqual({ emirate: "dubai", categorySlug: `${PREFIX}vat` });
    await setServicesLandingOpen({ actor: lead, categoryId: vatId, open: true, reason: REASON });
  });
});

describe("B3 — the fan-out states the matcher's count, never the page's", () => {
  it("counts only verified, claimed firms whose service covers the site, capped at eight", async () => {
    const scope = await scopeOf(bay.slug);
    const members = await servicesMembers(memberScopeOf(scope));
    const preview = await previewBrief({
      categoryId: vatId,
      site: { emirate: "dubai", areaId: bay.id },
      scope: "area",
      engagement: null,
    });
    // remote, crossfiled, baronly and lapsedfta: verified, claimed, a live
    // service covering the bay. Not the unclaimed office, the lapsed licence or
    // the firm whose VAT work stops at Sharjah.
    expect(preview.count).toBe(4);
    expect(preview.count).toBeLessThanOrEqual(members.length);

    for (let i = 0; i < 6; i += 1) await makeFirm({ key: `extra${i}`, defaults: [{ emirate: "dubai" }], service: {} });
    const capped = await previewBrief({
      categoryId: vatId,
      site: { emirate: "dubai", areaId: bay.id },
      scope: "area",
      engagement: null,
    });
    expect(capped.count).toBe(BRIEF_MAX_RECIPIENTS);
    expect((await servicesMembers(memberScopeOf(scope))).length).toBeGreaterThan(capped.count);
  });
});

describe("the trade's own wording", () => {
  it("saves the noun, the credential and three questions with a reason, and refuses a fourth", async () => {
    const asks = [
      { question: "Are you an agent?", why: "Only an agent deals with the authority in your name." },
      { question: "Per return or retainer?", why: "A retainer usually covers the queries between returns." },
      { question: "Who handles an audit?", why: "Often excluded and quoted separately." },
    ];
    const saved = await saveServicesLandingCopy({
      actor: lead,
      categoryId: vatId,
      pluralHuman: "  Test   consultants ",
      credentialKind: "fta_tax_agent",
      asks,
      reason: REASON,
    });
    expect(saved).toEqual({ ok: true });
    expect((await prisma.category.findUniqueOrThrow({ where: { id: vatId } })).pluralHuman).toBe("Test consultants");
    expect((await categoryAsks(vatId)).map((ask) => ask.question)).toEqual(asks.map((ask) => ask.question));

    const again = await saveServicesLandingCopy({
      actor: lead,
      categoryId: vatId,
      pluralHuman: "Test consultants",
      credentialKind: "fta_tax_agent",
      asks,
      reason: REASON,
    });
    expect(again).toEqual({ ok: false, error: "unchanged" });

    const four = await saveServicesLandingCopy({
      actor: lead,
      categoryId: vatId,
      pluralHuman: "Test consultants",
      credentialKind: null,
      asks: [...asks, { question: "A fourth?", why: "No." }],
      reason: REASON,
    });
    expect(four).toEqual({ ok: false, error: "too_many_asks" });
  });

  it("refuses the database a fourth question even past the service", async () => {
    await expect(
      prisma.categoryAsk.create({ data: { categoryId: vatId, position: 3, question: "Q?", why: "W." } }),
    ).rejects.toThrow();
  });

  it("refuses wording for a trade sold by the item", async () => {
    const refused = await saveServicesLandingCopy({
      actor: lead,
      categoryId: goodsId,
      pluralHuman: "Suppliers",
      credentialKind: null,
      asks: [],
      reason: REASON,
    });
    expect(refused).toEqual({ ok: false, error: "not_services" });
  });
});

describe("the snapshot lists a services trade by coverage, as its pages do", () => {
  it("puts a remote firm in the emirate its service covers, with no branch there", async () => {
    const kinds = await loadTradeKinds();
    const row: DirectoryRow = {
      id: "snapshot-remote",
      primaryCategoryId: vatId,
      verificationTier: 2,
      responseTimeMedianMs: null,
      specCompleteness: null,
      plan: null,
      categories: [],
      locations: [{ emirate: "sharjah" }],
      services: [
        {
          name: "Test compliance",
          categoryId: vatId,
          engagementType: null,
          feeBasis: null,
          turnaround: null,
          deliveredWhere: null,
          deliverable: null,
          coverage: [],
        },
      ],
      coverageDefault: [{ emirate: "dubai", areaId: null }],
    };
    const scopes = scopesOf(candidatesFrom([row], new Map()), {
      vectors: { goods: DEFAULT_WEIGHTS, services: null },
      kinds,
    });
    const emirates = scopes
      .filter((scope) => scope.categoryId === vatId && scope.emirate !== null)
      .map((scope) => scope.emirate);
    // Dubai by coverage, Sharjah by the branch — the page's own two readings.
    expect(new Set(emirates)).toEqual(new Set(["dubai", "sharjah"]));
  });
});
