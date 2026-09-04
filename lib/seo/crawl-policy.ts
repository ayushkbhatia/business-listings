/**
 * What this site asks a crawler to fetch, and what it takes out of the crawl
 * graph entirely. Both halves live in one file so they cannot contradict each
 * other, and so the next results surface inherits the policy by importing it
 * rather than by somebody remembering it.
 *
 * ## Why this file exists
 *
 * On 2026-09-04, between 01:25 and 02:40 UTC, one AI crawler made 794 requests
 * to `/c/valves-and-fittings`. Every one carried a different query string —
 * 797 unique URLs, zero repeats. Every one missed the Vercel cache. Every one
 * was a billed function invocation, ~16 Postgres round trips deep. Twelve a
 * minute, steady, with no sign of stopping.
 *
 * It was not guessing those URLs. **We linked them.**
 *
 * The filter rail renders every facet option as an anchor, and a facet anchor
 * ADDS its value to whatever is already active. So a one-facet page links to
 * two-facet pages and those link to three. On that one shelf the crawler had
 * already found 46 facet groups holding 151 distinct option values. Each group
 * is multi-select, so each contributes 2^k states, and the product over 46
 * groups is on the order of 10^45 distinct URLs — before `view`, `tab`, `sort`,
 * `page` and a comparison tray with 1.3 million permutations of its own.
 *
 * 797 requests into a 10^45 space is not a crawler misbehaving. It is a crawler
 * doing exactly what our markup told it to do, and it will never finish.
 *
 * ## The rule
 *
 * A URL stays in the crawl graph when its query string carries nothing but
 * `page`. Everything else — facets, sort, view, tab, the comparison tray — is
 * `nofollow`, and disallowed in robots.txt besides.
 *
 * `page` is the deliberate exception, and it is load-bearing. Category
 * pagination lives entirely in the query string here (`?page=2`, prev/next
 * only, `PAGE_SIZE` of 20), so a rule that blocked every `/c/` query string
 * would sever the only internal-link path to every supplier past the twentieth
 * in a trade. The sibling project nearly shipped that rule and measured its way
 * out of it; this is the same lesson, kept.
 *
 * ## Why `nofollow` and not just robots.txt
 *
 * robots.txt only asks. `nofollow` is what removes the links from the graph, so
 * it is the half that works on a crawler which does not read robots.txt or
 * reads it and declines. Both halves ship, because neither is sufficient:
 * robots.txt stops the compliant before they spend a request, and `nofollow`
 * stops the rest from ever learning the URLs exist.
 *
 * Nothing is lost by either. Filtered views are `noindex` and canonicalise back
 * to the clean shelf, so they were never going to rank and have no link equity
 * to pass on.
 *
 * ## Why the decision is derived from the href
 *
 * Not hardcoded per link. `toSearchParams` already draws exactly the right
 * line — it emits a bare path when nothing is filtering and the query form only
 * when something is — so reading the href gets the case a hardcoded attribute
 * would miss: toggling the last active facet OFF yields a clean URL, and that
 * link should stay followable.
 *
 * Deliberately free of `next` and of `@/lib/db`, so `app/robots.ts`, a server
 * component, a client component and a plain unit test can all read it.
 */

/**
 * The query parameters that keep a URL in the crawl graph.
 *
 * Exactly one, and see the file header for why it is not zero. Adding a key
 * here widens the crawlable URL space multiplicatively — a second key does not
 * double it, it squares it against the first — so a change to this set needs a
 * measurement, not an opinion.
 */
export const CRAWLABLE_QUERY_KEYS: ReadonlySet<string> = new Set(["page"]);

/**
 * Split a site-relative href into its path and its query string.
 *
 * By hand rather than through `URL`, which needs an absolute base we do not
 * have in a component and would throw on the relative hrefs every one of these
 * anchors carries. A hash is dropped: it never reaches the server.
 */
function splitHref(href: string): { path: string; query: string } {
  const hash = href.indexOf("#");
  const withoutHash = hash === -1 ? href : href.slice(0, hash);
  const mark = withoutHash.indexOf("?");
  if (mark === -1) return { path: withoutHash, query: "" };
  return { path: withoutHash.slice(0, mark), query: withoutHash.slice(mark + 1) };
}

/**
 * True when this href belongs in the crawl graph.
 *
 * A bare path always does. A query string does only when every key in it is in
 * `CRAWLABLE_QUERY_KEYS` — one unknown key is enough to take the whole URL out,
 * because the unbounded part of the space is reached by combination and a URL
 * carrying `page=2&someFacet=x` is a node inside it.
 *
 * An empty query (`/c/valves-and-fittings?`) counts as a bare path. It is the
 * shape `toSearchParams` produces when everything has been toggled off, and it
 * addresses the same page.
 */
export function isCrawlable(href: string): boolean {
  const { query } = splitHref(href);
  if (query === "") return true;
  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const key = decodeURIComponent(pair.split("=")[0] ?? "");
    if (!CRAWLABLE_QUERY_KEYS.has(key)) return false;
  }
  return true;
}

/**
 * The `rel` an anchor carrying this href should render, or `undefined` for
 * none.
 *
 * `undefined` rather than an empty string so that spreading it into JSX emits
 * no attribute at all — `rel=""` on a followable link is noise in the markup
 * and one more thing to explain.
 */
export function crawlRel(href: string): "nofollow" | undefined {
  return isCrawlable(href) ? undefined : "nofollow";
}

/**
 * Paths kept out of the index entirely, as robots.txt prefixes.
 *
 * None is useful as a landing page. `/search` and `/compare` are session-
 * coupled or thin, `/dev` is the component gallery, and `/admin` and `/staff`
 * are the staff console and its sign-in form — every page under them 404s
 * without a staff role, so this changes nothing about who can reach them. It
 * keeps the URLs out of a search result, which is where somebody would find out
 * they exist.
 */
export const DISALLOWED_PATHS = [
  "/search",
  "/compare",
  "/dev",
  "/admin",
  "/staff",
] as const;

/**
 * The route families that render the shared results surface, and therefore the
 * filter rail, and therefore the combinatorial URL space.
 *
 * `Results` is imported by four pages, not one. The crawler found the first;
 * denying it there without covering the others would move the load rather than
 * remove it — which is precisely what happened on the sibling project when one
 * crawler was blocked on one path.
 *
 * `/b/` is here for `/b/:slug/products` and `/b/:slug/reviews`, which are the
 * same shelf rebuilt per seller with an open query namespace of their own.
 */
export const FACETED_PATH_PREFIXES = ["/c/", "/b/"] as const;

/**
 * `Disallow` / `Allow` pairs that take the facet query space out of the crawl
 * without taking pagination with it.
 *
 * ## Why not name the parameter, the way the sibling project could
 *
 * There the facet arrived under a fixed name and `Disallow: /c/*spec=` was
 * exact. Here it cannot be: a spec facet's query key IS the `SpecField` id, a
 * cuid, and `parseSearchQuery` treats every non-reserved key as one so that
 * adding a filterable field needs no code change. The parameter namespace is
 * open by design and there is no name to disallow.
 *
 * So the rule inverts. Rather than naming what is blocked, it blocks the query
 * space and names what is allowed — which is exact here in a way it would not
 * have been there, because exactly one parameter is crawlable and
 * `toSearchParams` emits `page` last and alone when nothing else is set.
 *
 * Both major crawlers resolve `Allow` against `Disallow` by rule length, and
 * `/c/*?page=` is longer than `/c/*?`; where length ties, `Allow` wins. A
 * crawler that implements neither is the reason `nofollow` ships alongside
 * this, not instead of it.
 */
export const FACET_RULES: { disallow: string[]; allow: string[] } = {
  disallow: FACETED_PATH_PREFIXES.map((prefix) => `${prefix}*?`),
  allow: FACETED_PATH_PREFIXES.map((prefix) => `${prefix}*?page=`),
};

/**
 * Crawlers that fetch to build a training corpus, and take nothing back.
 *
 * These get `Disallow: /`. The reasoning is arithmetic rather than principle:
 * one of them spent 794 requests in 75 minutes on a single shelf and sent no
 * buyer, and a directory's whole business is being found by people who then
 * send an enquiry. There is no version of that trade worth a function
 * invocation.
 *
 * Note what is NOT here, and why the list is three groups rather than one.
 */
export const TRAINING_CRAWLERS = [
  "ClaudeBot",
  "GPTBot",
  "meta-externalagent",
  "Applebot-Extended",
  "Google-Extended",
  "Bytespider",
  "CCBot",
  "Amazonbot",
  "Omgilibot",
  "Diffbot",
  "Timpibot",
  "cohere-ai",
] as const;

/**
 * Crawlers that fetch because a person asked a question, or that index for an
 * assistant which then cites the answer.
 *
 * These stay allowed everywhere the ordinary rules allow, and they are the
 * reason this file does not simply block every user agent with "bot" in it.
 * A buyer who asks an assistant "who supplies DN100 ductile iron valves in Al
 * Quoz" and is handed one of our suppliers is the same conversion as a buyer
 * who arrived from a search result. Blocking that traffic to save function time
 * would be saving money by turning off the product.
 *
 * They are listed rather than merely omitted so that the distinction is written
 * down, and so the next person to add a rule has to decide which group a new
 * agent belongs in rather than reaching for the blanket.
 */
export const ASSISTANT_FETCHERS = [
  "Claude-User",
  "Claude-SearchBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
] as const;

/**
 * SEO tooling. Allowed, but asked to slow down.
 *
 * They read the same pages a competitor's analyst would and cost the same per
 * fetch. `Crawl-delay` is not in the standard and Google ignores it; these
 * particular crawlers honour it, which is the whole reason it is worth writing.
 */
export const ANALYTICS_CRAWLERS = ["AhrefsBot", "SemrushBot", "MJ12bot", "DataForSeoBot"] as const;

/** Seconds between fetches, asked of the crawlers that honour the directive. */
export const ANALYTICS_CRAWL_DELAY = 10;

/**
 * True when `path` is covered by a `DISALLOWED_PATHS` prefix.
 *
 * Prefix matching, because that is what robots.txt means: `Disallow: /admin`
 * blocks `/admin`, `/admin/` and everything beneath. The empty path — the home
 * page — is the one entry that can never match, and is handled explicitly
 * rather than left to `"".startsWith("/admin")`.
 */
export function isDisallowedPath(
  path: string,
  disallow: readonly string[] = DISALLOWED_PATHS,
): boolean {
  if (path === "") return false;
  return disallow.some((rule) => path === rule || path.startsWith(rule));
}

/**
 * Search-engine crawlers we want, named so `isCrawler` recognises them.
 *
 * They are not blocked anywhere — a directory that Google cannot read is a
 * directory nobody finds. They are listed because a crawler is still not a
 * buyer, and the write paths on the results page are for buyers.
 */
export const SEARCH_CRAWLERS = ["Googlebot", "bingbot", "DuckDuckBot", "YandexBot", "Baiduspider"] as const;

/** Every agent this file knows by name, in one array for `isCrawler`. */
const KNOWN_AGENTS: readonly string[] = [
  ...TRAINING_CRAWLERS,
  ...ASSISTANT_FETCHERS,
  ...ANALYTICS_CRAWLERS,
  ...SEARCH_CRAWLERS,
];

/**
 * A last-resort shape match, for the agents nobody has listed yet.
 *
 * Deliberately loose, because of what the answer is used for: it gates whether
 * a public GET writes a row to a demand-signal table, and a false positive
 * costs one unrecorded search while a false negative costs an unbounded table
 * and a polluted call list. Never gate CONTENT on this — a buyer wrongly
 * matched must still get the whole page.
 */
const BOT_SHAPE = /bot|crawl|spider|scrap|http-client|python-requests|curl\/|wget/i;

/**
 * True when this user agent is a robot rather than a buyer.
 *
 * `null` — no `User-Agent` header at all — counts as one. Every real browser
 * sends the header; something that does not is not a person looking at a page.
 *
 * ## What this is for, and what it must never be for
 *
 * The results page writes two rows on a plain GET: `recordSearch`, which
 * authors the home page's "Popular:" chips, and `recordZeroResult`, which
 * authors the admin recruitment call list. Both are business signals about what
 * buyers want, and a crawler walking facet combinations is not a buyer wanting
 * anything. On 2026-09-04 one of them generated 797 zero-result-shaped requests
 * in 75 minutes, and the only thing that stopped those becoming 797 rows was
 * that the page was already 500ing for an unrelated reason.
 *
 * It must NOT decide what a request is shown. Serving a crawler different
 * markup from a buyer is cloaking, it is the fastest way to lose the index, and
 * a loose regex is exactly the wrong instrument for it.
 */
export function isCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  const ua = userAgent.toLowerCase();
  if (KNOWN_AGENTS.some((agent) => ua.includes(agent.toLowerCase()))) return true;
  return BOT_SHAPE.test(ua);
}
