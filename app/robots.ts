import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * Three surfaces are kept out of the index, for three different reasons.
 *
 * /search  a query-string page. Indexing it means a crawler generating
 *          thousands of near-identical result pages, which is how a directory
 *          teaches Google that most of it is filler.
 * /compare a tray of whichever suppliers one buyer happened to pick. It means
 *          nothing to anyone else.
 * /dev     the component gallery. Not a product surface at all.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/search", "/compare", "/dev"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
