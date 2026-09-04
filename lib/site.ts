/**
 * The site's own origin.
 *
 * Canonicals, OpenGraph URLs and the sitemap all have to be absolute, and all
 * three are wrong in a way nobody notices until Google indexes localhost. One
 * place to get it from, one env var to set.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  // Vercel supplies this on preview deployments, where there is no stable URL
  // to configure.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  /*
     Fall through to localhost anywhere but production, and refuse in it.

     robots.txt and the sitemap are static build-time prerenders, so whatever
     this returns during the build is baked into the deployed file with no
     runtime path that could correct it later. A production build that reached
     this line would ship, serve 200, and tell every crawler that the site's
     host and sitemap were on localhost — a silent failure that looks like a
     crawling problem rather than a configuration one.

     The comment at the top of this file already said "wrong in a way nobody
     notices until Google indexes localhost". This is that sentence made into a
     build failure, which is the only place the check is worth anything.
  */
  if (process.env.VERCEL_ENV === "production") {
    throw new Error(
      "siteUrl(): production build with no NEXT_PUBLIC_SITE_URL, " +
        "VERCEL_PROJECT_PRODUCTION_URL or VERCEL_URL. robots.txt and sitemap.xml " +
        "are prerendered at build time, so this would ship pointing at localhost.",
    );
  }

  return "http://localhost:3000";
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
