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
  return "http://localhost:3000";
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
