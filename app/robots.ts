import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import {
  ANALYTICS_CRAWL_DELAY,
  ANALYTICS_CRAWLERS,
  DISALLOWED_PATHS,
  FACET_RULES,
  TRAINING_CRAWLERS,
} from "@/lib/seo/crawl-policy";

/**
 * Four surfaces are kept out of the index, for four different reasons.
 *
 * /search  a query-string page. Indexing it means a crawler generating
 *          thousands of near-identical result pages, which is how a directory
 *          teaches Google that most of it is filler.
 * /compare a tray of whichever suppliers one buyer happened to pick. It means
 *          nothing to anyone else.
 * /dev     the component gallery. Not a product surface at all.
 * /admin   the staff console, added in handoff 4. Every page under it 404s for
 *          anybody without a staff role, so this changes nothing about who can
 *          reach it — it keeps the URLs out of a search result, which is where
 *          somebody finds out they exist.
 * /staff   the staff sign-in form. Same reason as /admin and rather more
 *          pointed: the console is unguessable only while nothing advertises
 *          it, and a sign-in page in a search result is an advertisement. The
 *          page also sets `robots: { index: false }` itself, because a
 *          disallow is a request and a meta directive is the one crawlers that
 *          ignore the first tend to honour.
 *
 * ## And then the facet space, which is what this file is mostly about now
 *
 * Everything above was already here on 2026-09-04, when a training crawler
 * spent 75 minutes making 794 requests to one category shelf. Every URL was
 * different, every one missed the cache, every one was a billed function
 * invocation — and every one was crawl-legal, because nothing in this file said
 * otherwise. The rules and the reasoning are in lib/seo/crawl-policy.ts; this
 * route renders them.
 *
 * The three groups below are a deliberate distinction and not a blanket. A
 * crawler that fetches because a buyer asked an assistant a question sends us
 * buyers, and it is not in the blocked list. A crawler that fetches to build a
 * training corpus sends nothing, and it is.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          /*
             Pagination, back through the disallow below it.

             Load-bearing, and the rule most likely to be deleted by someone
             tidying: `PAGE_SIZE` is 20 and the pager is prev/next only, so
             `?page=` is the sole internal-link path to every supplier past the
             twentieth in a trade. Blocking the whole query string would have
             been the cheap version of this fix and would have cut a large part
             of the directory out of the crawl to save function time.

             It wins over the disallow on rule length, which is how both major
             crawlers resolve the conflict — hence the assertion in
             crawl-policy.test.ts that this rule stays the longer of the two.
          */
          ...FACET_RULES.allow,
        ],
        disallow: [
          ...DISALLOWED_PATHS,
          /*
             The facet URL space. One shelf can address roughly 10^45 distinct
             URLs, none of which can ever be indexed — they are `noindex` and
             canonicalise back to the clean shelf — so every fetch of one is
             budget taken from a supplier page that could rank.

             Named as "the query string, except pagination" rather than as the
             parameters themselves, because there is nothing here to name: a
             spec facet's key IS the SpecField id, and the namespace is open by
             design so a new filterable field needs no code change. See
             lib/seo/crawl-policy.ts.
          */
          ...FACET_RULES.disallow,
        ],
      },
      {
        /*
           Training crawlers, denied outright.

           The arithmetic rather than a principle: one of these spent 794
           requests on a single shelf in 75 minutes and sent no buyer. A
           directory is paid when somebody finds a supplier and sends an
           enquiry, and there is no version of that trade worth the compute.

           Listed by name rather than matched by pattern because the pattern
           would catch the group below, which is the group that sends buyers.
        */
        userAgent: [...TRAINING_CRAWLERS],
        disallow: "/",
      },
      {
        /*
           SEO tooling. Allowed, and asked to slow down.

           `Crawl-delay` is not part of the standard and Google ignores it.
           These particular crawlers honour it, which is the entire reason it is
           worth a line.
        */
        userAgent: [...ANALYTICS_CRAWLERS],
        /*
           The whole rule set is repeated rather than inherited, because a
           crawler obeys the single most specific group that matches it and
           ignores `*` entirely once one does. A group here carrying only
           `Crawl-delay` would have quietly re-opened the facet space to exactly
           the four agents it was meant to slow down.
        */
        allow: ["/", ...FACET_RULES.allow],
        disallow: [...DISALLOWED_PATHS, ...FACET_RULES.disallow],
        crawlDelay: ANALYTICS_CRAWL_DELAY,
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
