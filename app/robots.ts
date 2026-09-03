import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

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
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/search", "/compare", "/dev", "/admin", "/staff"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
