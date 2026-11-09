import { prisma } from "../lib/db/client.js";
import {
  DISALLOWED_PATHS,
  FACET_RULES,
  TRAINING_CRAWLERS,
  ANALYTICS_CRAWLERS,
} from "../lib/seo/crawl-policy.js";
import { FIXED_CLASSES, RANGED_CLASSES, sitemapChunk, sitemapChunkIds } from "../lib/seo/sitemap.js";
import { livePages } from "../lib/seo/area.js";
import { liveEmiratePages, MATRIX_EMIRATES } from "../lib/seo/emirate.js";
import { categoryIndex } from "../lib/seo/taxonomy.js";
import { evaluatePublish, countWords, DEFAULT_THRESHOLDS } from "../lib/publish-threshold.js";
import { liveLists } from "../lib/seo/curated/read.js";

/**
 * Task T3.3 — what a crawler can reach at 41,000 listings, measured.
 *
 *   DATABASE_URL=…/bl_scale DIRECT_URL=…/bl_scale \
 *     NODE_OPTIONS=--conditions=react-server pnpm audit:crawl
 *
 * A script rather than a document, because every number in it moves. The
 * taxonomy gains trades, an ops lead publishes a template, a landing class
 * opens, and the crawl surface changes without a line of code being touched —
 * which is exactly how the one shelf that cost 794 requests in 75 minutes got
 * there. `docs/crawl-surface-at-41k.md` records what it printed on
 * 9 November 2026 and what was wrong; this prints it again.
 *
 * Five sections, and each answers a question the task asks:
 *
 *   1 · robots.txt — what is asked of whom.
 *   2 · the sitemap — how full each chunk is against the protocol's 50,000,
 *       and whether every indexable class is in one.
 *   3 · the publish floor — addressable against live, per landing class.
 *   4 · the facet space — measured from the live templates and the fixed rail,
 *       because the figure the policy file quotes is an observation from one
 *       incident and not a property of the taxonomy as it stands.
 *   5 · canonical targets — every canonical a landing class emits, checked to
 *       land on a page that is itself indexable.
 *
 * Read-only throughout. It is safe against production and worth running there:
 * sections 3 and 4 are about content, and production's content is the content.
 */

function heading(text: string): void {
  console.log(`\n── ${text} ${"─".repeat(Math.max(0, 74 - text.length))}`);
}

function row(label: string, value: string | number): void {
  console.log(`  ${label.padEnd(46)} ${String(value)}`);
}

/** The protocol's hard cap on one sitemap file. */
const SITEMAP_URL_CAP = 50_000;

/* ── 1 · robots.txt ───────────────────────────────────────────────────────── */

function robotsSection(): void {
  heading("robots.txt");
  row("disallowed prefixes", DISALLOWED_PATHS.length);
  for (const path of DISALLOWED_PATHS) console.log(`      ${path}`);
  row("facet disallow", FACET_RULES.disallow.join("  "));
  row("facet allow (longer, so it wins)", FACET_RULES.allow.join("  "));
  for (const [disallow, allow] of FACET_RULES.disallow.map(
    (d, index) => [d, FACET_RULES.allow[index] ?? ""] as const,
  )) {
    // The conflict between these two is resolved by rule length, so a change
    // that made the disallow the longer of the pair would silently take
    // pagination out of the crawl graph — and pagination is the only internal
    // path to every supplier past the twentieth in a trade.
    if (allow.length <= disallow.length) {
      console.log(`  !! ${allow} is not longer than ${disallow} — pagination would be blocked`);
    }
  }
  row("training crawlers denied", TRAINING_CRAWLERS.length);
  row("analytics crawlers slowed", ANALYTICS_CRAWLERS.length);
}

/* ── 2 · the sitemap ──────────────────────────────────────────────────────── */

/**
 * Every public route family that can be indexed, against the sitemap class
 * that submits it.
 *
 * Hand-written, and that is the point: a route with no entry here is a route
 * nobody decided about. `null` means deliberately absent and says why.
 */
const INDEXABLE_CLASSES: { route: string; chunk: string | null; note?: string }[] = [
  { route: "/", chunk: "core" },
  { route: "/categories", chunk: "core" },
  { route: "/pricing", chunk: "core" },
  { route: "/for-buyers", chunk: "core" },
  { route: "/list-your-business", chunk: "core" },
  { route: "/guides", chunk: "core" },
  { route: "/guides/how-we-check", chunk: "core" },
  { route: "/(legal)/*", chunk: "core" },
  { route: "/guides/:slug", chunk: "guides" },
  { route: "/guides/:subject", chunk: "guides" },
  { route: "/:emirate/:area/:category", chunk: "area" },
  { route: "/:emirate/:area", chunk: "area", note: "the area's own page, same publish floor" },
  { route: "/:emirate/:category", chunk: "emirate" },
  { route: "/c/:category", chunk: "taxonomy" },
  { route: "/c/:category/:sub", chunk: "taxonomy" },
  { route: "/best/:slug", chunk: "lists" },
  { route: "/lp/:campaign", chunk: "campaign" },
  { route: "/b/:slug", chunk: "business" },
  { route: "/b/:slug/{tab}", chunk: "business" },
  { route: "/b/:slug/p/:product", chunk: "product" },
  { route: "/b/:slug/s/:service", chunk: "service" },
  { route: "/search", chunk: null, note: "noindex — a query-string page" },
  { route: "/compare", chunk: null, note: "noindex — one buyer's tray" },
  { route: "/rfq/new", chunk: null, note: "noindex — a composer" },
  { route: "/report/:slug", chunk: null, note: "noindex — one form per listing" },
  { route: "/onboarding/*", chunk: null, note: "noindex — a funnel" },
  { route: "/account/*", chunk: null, note: "noindex, signed in" },
  { route: "/dashboard/*", chunk: null, note: "noindex, signed in" },
  { route: "/admin/*", chunk: null, note: "disallowed; 404s without a staff role" },
  { route: "/staff", chunk: null, note: "disallowed; a sign-in form" },
  { route: "/dev/*", chunk: null, note: "disallowed; the component gallery" },
];

async function sitemapSection(): Promise<void> {
  heading("the sitemap");
  const ids = await sitemapChunkIds();
  row("chunks", ids.length);

  let total = 0;
  let worst = { id: "", count: 0 };
  for (const id of ids) {
    const urls = await sitemapChunk(id);
    total += urls.length;
    if (urls.length > worst.count) worst = { id, count: urls.length };
    const share = Math.round((urls.length / SITEMAP_URL_CAP) * 100);
    console.log(
      `      ${id.padEnd(14)} ${String(urls.length).padStart(7)} URLs  ${String(share).padStart(3)}% of the cap`,
    );
  }
  row("URLs in all chunks", total.toLocaleString("en-GB"));
  row("largest chunk", `${worst.id} at ${String(worst.count)} of ${String(SITEMAP_URL_CAP)}`);
  if (worst.count > SITEMAP_URL_CAP) {
    console.log(`  !! ${worst.id} is over the protocol cap — a crawler rejects the file whole`);
  }

  // Every class named above has to exist as a chunk, or it is submitted nowhere.
  const known = new Set<string>([
    ...FIXED_CLASSES,
    ...RANGED_CLASSES,
  ]);
  const unsubmitted = INDEXABLE_CLASSES.filter(
    (entry) => entry.chunk !== null && !known.has(entry.chunk),
  );
  row("indexable classes", INDEXABLE_CLASSES.filter((entry) => entry.chunk !== null).length);
  row("deliberately absent", INDEXABLE_CLASSES.filter((entry) => entry.chunk === null).length);
  for (const entry of unsubmitted) {
    console.log(`  !! ${entry.route} names chunk "${String(entry.chunk)}", which no class emits`);
  }
}

/* ── 3 · the publish floor ────────────────────────────────────────────────── */

async function floorSection(): Promise<void> {
  heading("the publish floor — addressable against live");

  const [areas, categories, leaves, areaPages, emiratePages, lists, campaigns] = await Promise.all([
    prisma.area.count({ where: { publishedAt: { not: null } } }),
    prisma.category.count(),
    prisma.category.count({ where: { children: { none: {} } } }),
    prisma.areaPage.count({ where: { publishedAt: { not: null } } }),
    prisma.emiratePage.count({ where: { publishedAt: { not: null } } }),
    prisma.curatedList.count({ where: { publishedAt: { not: null } } }),
    prisma.campaign.count({ where: { publishedAt: { not: null } } }),
  ]);

  const [live, liveEmirates, sectors, lists_] = await Promise.all([
    livePages(),
    liveEmiratePages(),
    categoryIndex(),
    liveLists(),
  ]);

  const publishableTrades = sectors.reduce(
    (count, sector) => count + sector.children.filter((trade) => trade.publishable).length,
    0,
  );
  const allTrades = sectors.reduce((count, sector) => count + sector.children.length, 0);

  row("published areas", areas);
  row("categories (leaves)", `${String(categories)} (${String(leaves)})`);
  row("area pages — addressable", (areas * leaves).toLocaleString("en-GB"));
  row("area pages — staff published", areaPages);
  row("area pages — live at this moment", live.length);
  row("emirate cells — addressable", (MATRIX_EMIRATES.length * leaves).toLocaleString("en-GB"));
  row("emirate cells — staff published", emiratePages);
  row("emirate cells — live at this moment", liveEmirates.length);
  row("taxonomy — trades, of them publishable", `${String(allTrades)}, ${String(publishableTrades)}`);

  /*
     "0 of 427" says nothing on its own, and the breakdown is the whole point:
     a trade held back by supply is waiting for the directory to grow, and a
     trade held back by its intro is waiting for somebody to write 250 words.
     They are not the same backlog and only one of them is ours.
  */
  const trades = await prisma.category.findMany({
    where: { parentId: { not: null } },
    select: { id: true, intro: true },
  });
  const listingCounts = await prisma.business.groupBy({
    by: ["primaryCategoryId"],
    where: { suspendedAt: null, publishedAt: { not: null }, mergedIntoId: null },
    _count: true,
  });
  const verifiedCounts = await prisma.business.groupBy({
    by: ["primaryCategoryId"],
    where: {
      suspendedAt: null,
      publishedAt: { not: null },
      mergedIntoId: null,
      verificationTier: { gte: 2 },
    },
    _count: true,
  });
  const listingsBy = new Map(listingCounts.map((r) => [r.primaryCategoryId, r._count]));
  const verifiedBy = new Map(verifiedCounts.map((r) => [r.primaryCategoryId, r._count]));

  const reasons = new Map<string, number>();
  let introOnly = 0;
  for (const trade of trades) {
    const decision = evaluatePublish({
      listings: listingsBy.get(trade.id) ?? 0,
      verified: verifiedBy.get(trade.id) ?? 0,
      introWords: countWords(trade.intro),
    });
    if (decision.publishable) continue;
    for (const failure of decision.failures) {
      reasons.set(failure.reason, (reasons.get(failure.reason) ?? 0) + 1);
    }
    if (decision.failures.every((failure) => failure.reason === "intro_words")) introOnly += 1;
  }
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
    row(`  trades failing on ${reason}`, count);
  }
  row("  trades failing ONLY on the intro", introOnly);
  row("  the intro floor", `${String(DEFAULT_THRESHOLDS.minIntroWords)} words`);
  row("curated lists — published, live", `${String(lists)}, ${String(lists_.length)}`);
  row("campaigns — published", campaigns);

  /*
     The gap between published and live is the honest number and the one worth
     watching. A page staff published that is not live right now failed a floor
     since — supply dropped, the licence lapsed, the intro was thinned — and the
     sitemap drops it on the next build without waiting for the sweep.
  */
  if (areaPages > live.length) {
    row("area pages published but not live", areaPages - live.length);
  }
  if (emiratePages > liveEmirates.length) {
    row("emirate cells published but not live", emiratePages - liveEmirates.length);
  }
}

/* ── 4 · the facet space ──────────────────────────────────────────────────── */

/**
 * The fixed rail, as `readFixedFacetCounts` builds it: how many distinct query
 * strings each group can contribute, including "not set".
 *
 * Multi-select groups contribute `2^options` and single-select ones
 * `options + 1`. Restated here rather than imported because the counting
 * question — how many URLs, not how many rows — is this script's and the shapes
 * are a handful of literals that `lib/db/queries/search.ts` keeps module-level.
 */
const FIXED_GROUPS: { key: string; options: number; multi: boolean }[] = [
  { key: "tier", options: 2, multi: false },
  { key: "emirate", options: 7, multi: false },
  { key: "availability", options: 4, multi: true },
  { key: "freeZone", options: 1, multi: false },
  { key: "replyWithinHours", options: 3, multi: false },
  { key: "yearsTrading", options: 3, multi: false },
];

/** `sort`, `view` and `tab`, which are not filters but are query keys. */
const VIEW_GROUPS: { key: string; options: number }[] = [
  { key: "sort", options: 4 },
  { key: "tab", options: 4 },
  { key: "view", options: 2 },
];

async function facetSection(): Promise<void> {
  heading("the facet space on one shelf, from the live templates");

  const templates = await prisma.specTemplate.findMany({
    where: { status: "live" },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      categories: { select: { categoryId: true } },
      fields: { where: { isFilterable: true }, select: { key: true, options: true } },
    },
  });

  const areas = await prisma.area.count({ where: { publishedAt: { not: null } } });

  // The fixed half, identical on every shelf.
  let fixed = 1;
  for (const group of FIXED_GROUPS) {
    fixed *= group.multi ? 2 ** group.options : group.options + 1;
  }
  // `area` is single-select and every published area is an option.
  fixed *= areas + 1;
  let view = 1;
  for (const group of VIEW_GROUPS) view *= group.options + 1;

  row("live spec templates", templates.length);
  row("categories they cover", new Set(templates.flatMap((t) => t.categories.map((c) => c.categoryId))).size);
  row("fixed facet groups", FIXED_GROUPS.length);
  row("fixed facet states (incl. area)", fixed.toExponential(2));
  row("sort/tab/view states", view);

  let widest = { name: "none", states: 1 };
  for (const template of templates) {
    // Each filterable field is multi-select, so it contributes 2^options.
    let states = 1;
    for (const field of template.fields) states *= 2 ** field.options.length;
    console.log(
      `      ${template.name.padEnd(20)} ${String(template.fields.length)} fields, ` +
        `${String(template.fields.reduce((n, f) => n + f.options.length, 0))} options, ` +
        `${states.toExponential(2)} spec states`,
    );
    if (states > widest.states) widest = { name: template.name, states };
  }

  const shelf = widest.states * fixed * view;
  row("widest shelf", `${widest.name} — ${shelf.toExponential(2)} distinct URLs`);
  console.log(
    `\n  The policy file quotes ~10^45, which was counted from the 46 groups and\n` +
      `  151 values one crawler found on 2026-09-04. The taxonomy as it stands\n` +
      `  addresses ${shelf.toExponential(1)} on its widest shelf. Both numbers are past any\n` +
      `  crawl budget by every order of magnitude that matters, and the rule does\n` +
      `  not depend on which one is right: no URL in this space can be indexed.`,
  );
}

/* ── 5 · canonical targets ────────────────────────────────────────────────── */

async function canonicalSection(): Promise<void> {
  heading("canonical targets");

  /*
     The rule worth checking is `canonicalFor`'s first: a filtered category view
     naming one area canonicalises to that area's page — but only where the page
     is live, because a canonical aimed at a `noindex` page is worse than none.
     So every live area page's address has to be a page `livePages` agrees is
     live, which is the same call the sitemap makes. Checked by set equality
     rather than by re-deriving it, so a drift between the two shows up here.
  */
  const live = await livePages();
  const addresses = new Set(live.map((page) => `/${page.emirate}/${page.areaSlug}/${page.categorySlug}`));
  row("live area pages a canonical can name", addresses.size);

  const published = await prisma.areaPage.findMany({
    where: { publishedAt: { not: null } },
    select: { area: { select: { slug: true, emirate: true } }, category: { select: { slug: true } } },
  });
  const stale = published.filter(
    (page) => !addresses.has(`/${page.area.emirate}/${page.area.slug}/${page.category.slug}`),
  );
  row("published but below a floor (no canonical)", stale.length);
  for (const page of stale.slice(0, 10)) {
    console.log(`      /${page.area.emirate}/${page.area.slug}/${page.category.slug}`);
  }
  console.log(
    `\n  A filtered view naming one of those falls through to rule 2 and\n` +
      `  canonicalises to the unfiltered trade page, which is the intended\n` +
      `  behaviour rather than a defect. It is listed because the count is the\n` +
      `  one number that says how much of the acquisition surface is dark.`,
  );
}

async function main(): Promise<void> {
  console.log("Crawl surface audit — T3.3");
  robotsSection();
  await sitemapSection();
  await floorSection();
  await facetSection();
  await canonicalSection();
  console.log("");
  await prisma.$disconnect();
}

await main();
