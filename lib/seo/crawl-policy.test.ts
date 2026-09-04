import { describe, expect, it } from "vitest";
import {
  ASSISTANT_FETCHERS,
  CRAWLABLE_QUERY_KEYS,
  DISALLOWED_PATHS,
  FACET_RULES,
  TRAINING_CRAWLERS,
  crawlRel,
  isCrawlable,
  isCrawler,
  isDisallowedPath,
} from "./crawl-policy";

/**
 * The two tests that matter are the two that would have caught the incident and
 * the two that would catch the overcorrection: a facet URL is out of the graph,
 * and a paginated URL is still in it. Everything else here defends the edges
 * those two rules have.
 */
describe("isCrawlable", () => {
  it("keeps a bare category path in the graph", () => {
    expect(isCrawlable("/c/valves-and-fittings")).toBe(true);
  });

  it("keeps unfiltered pagination in the graph", () => {
    // Load-bearing. PAGE_SIZE is 20 and the pager is prev/next only, so
    // blocking this severs the only internal-link path to every supplier past
    // the twentieth in a trade.
    expect(isCrawlable("/c/valves-and-fittings?page=2")).toBe(true);
    expect(isCrawlable("/c/valves-and-fittings?page=17")).toBe(true);
  });

  it("takes a spec facet out of the graph", () => {
    // The exact shape from the 2026-09-04 log: the query key is a SpecField
    // cuid, and the value is a comma-joined multi-select.
    expect(isCrawlable("/c/valves-and-fittings?cmtj5jbxc00cptcitmq1urzua=DN80%2CDN200")).toBe(false);
  });

  it("takes a facet out even when it travels with crawlable pagination", () => {
    // A URL carrying both is a node inside the combinatorial space, not a
    // pagination link. One unknown key is enough.
    expect(isCrawlable("/c/valves-and-fittings?cmtj5jbxc00cptcitmq1urzua=DN80&page=2")).toBe(false);
  });

  it("takes sort, view, tab and the comparison tray out of the graph", () => {
    expect(isCrawlable("/c/valves-and-fittings?sort=rating")).toBe(false);
    expect(isCrawlable("/c/valves-and-fittings?view=grid")).toBe(false);
    expect(isCrawlable("/c/valves-and-fittings?tab=products")).toBe(false);
    expect(isCrawlable("/c/valves-and-fittings?compare=al-marwan-industrial-supplies-llc")).toBe(
      false,
    );
  });

  it("treats an empty query string as a bare path", () => {
    // What toSearchParams produces once everything has been toggled off. It
    // addresses the same page, so it stays followable — this is the case a
    // hardcoded rel attribute on the facet anchors would have got wrong.
    expect(isCrawlable("/c/valves-and-fittings?")).toBe(true);
  });

  it("ignores a fragment, which never reaches the server", () => {
    expect(isCrawlable("/c/valves-and-fittings#results")).toBe(true);
    expect(isCrawlable("/c/valves-and-fittings?sort=rating#results")).toBe(false);
  });

  it("reads an encoded key rather than the raw one", () => {
    // `page` cannot arrive percent-encoded from our own code, but a link built
    // from a URL a crawler invented can, and the decision must not be dodgeable
    // by encoding the key.
    expect(isCrawlable("/c/valves-and-fittings?%70age=2")).toBe(true);
    expect(isCrawlable("/c/valves-and-fittings?%73ort=rating")).toBe(false);
  });
});

describe("crawlRel", () => {
  it("marks a filtered href and leaves a clean one bare", () => {
    expect(crawlRel("/c/valves-and-fittings?sort=rating")).toBe("nofollow");
    // undefined rather than "" so JSX emits no attribute at all.
    expect(crawlRel("/c/valves-and-fittings")).toBeUndefined();
    expect(crawlRel("/c/valves-and-fittings?page=3")).toBeUndefined();
  });
});

describe("FACET_RULES", () => {
  it("blocks the query space on both faceted route families", () => {
    expect(FACET_RULES.disallow).toEqual(["/c/*?", "/b/*?"]);
  });

  it("allows pagination back through, on a longer rule than the one blocking it", () => {
    expect(FACET_RULES.allow).toEqual(["/c/*?page=", "/b/*?page="]);
    // Both major crawlers resolve Allow against Disallow by rule length. If the
    // allow rule were ever the shorter of the two, pagination would go dark and
    // nothing else in this file would notice.
    for (const [i, allow] of FACET_RULES.allow.entries()) {
      expect(allow.length).toBeGreaterThan((FACET_RULES.disallow[i] ?? "").length);
    }
  });
});

describe("isDisallowedPath", () => {
  it("matches a prefix, not an exact string", () => {
    expect(isDisallowedPath("/admin")).toBe(true);
    expect(isDisallowedPath("/admin/businesses")).toBe(true);
  });

  it("never blocks the home page", () => {
    expect(isDisallowedPath("")).toBe(false);
  });

  it("leaves the public directory alone", () => {
    expect(isDisallowedPath("/c/valves-and-fittings")).toBe(false);
    expect(isDisallowedPath("/b/al-marwan-industrial-supplies-llc")).toBe(false);
  });
});

describe("the crawler groups", () => {
  it("keeps the assistant fetchers out of the blocked list", () => {
    // The distinction the whole policy turns on. A crawler that fetches because
    // a buyer asked a question sends buyers; one that fetches to build a
    // training corpus sends nothing. Blocking the first to save function time
    // would be saving money by turning off the product.
    for (const agent of ASSISTANT_FETCHERS) {
      expect(TRAINING_CRAWLERS as readonly string[]).not.toContain(agent);
    }
  });

  it("blocks ClaudeBot and allows Claude-User", () => {
    // Named because they are one vendor's two agents and the log that started
    // this carried the first. Getting these two the same way round is the
    // difference between a fix and an outage of a traffic source.
    expect(TRAINING_CRAWLERS as readonly string[]).toContain("ClaudeBot");
    expect(ASSISTANT_FETCHERS as readonly string[]).toContain("Claude-User");
  });
});

describe("the policy's own shape", () => {
  it("keeps exactly one query key crawlable", () => {
    // A second key does not double the crawlable space, it squares it against
    // the first. Widening this set is a measurement, not an opinion, and this
    // test is where that argument has to be had.
    expect([...CRAWLABLE_QUERY_KEYS]).toEqual(["page"]);
  });

  it("does not disallow a path the sitemap submits", () => {
    // The contradiction guard. A sitemap entry for a disallowed path is the
    // site telling a crawler to index a page it has asked it not to fetch, and
    // it is spent budget arguing with itself. The sitemap is built from the
    // database, so this asserts on the prefixes it can emit rather than on the
    // rendered document.
    const emitted = ["", "/c/valves-and-fittings", "/b/al-marwan", "/dubai/al-quoz-industrial-1"];
    for (const path of emitted) {
      expect(isDisallowedPath(path, DISALLOWED_PATHS)).toBe(false);
    }
  });
});

describe("isCrawler", () => {
  it("recognises the agent from the incident", () => {
    expect(
      isCrawler(
        "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      ),
    ).toBe(true);
  });

  it("recognises the search engines it does not block", () => {
    // Allowed everywhere, and still not a buyer. The write paths on the results
    // page are for buyers.
    expect(isCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isCrawler("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe(true);
  });

  it("treats a missing user agent as a robot", () => {
    // Every real browser sends the header.
    expect(isCrawler(null)).toBe(true);
    expect(isCrawler("")).toBe(true);
    expect(isCrawler(undefined)).toBe(true);
  });

  it("catches an unlisted agent by shape", () => {
    expect(isCrawler("SomeNewAIBot/2.0")).toBe(true);
    expect(isCrawler("python-requests/2.31.0")).toBe(true);
    expect(isCrawler("curl/8.4.0")).toBe(true);
  });

  it("leaves a real browser alone", () => {
    // The false-negative direction is the one that matters: a buyer wrongly
    // matched loses a row in a demand table, and that is the whole cost.
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    ]) {
      expect(isCrawler(ua)).toBe(false);
    }
  });
});
