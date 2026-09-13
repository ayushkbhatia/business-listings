import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Build note `B2` at the render layer.
 *
 * The data change is immediate: `publishedAt` is null the moment the request
 * commits, so every dynamic page — search, the enquiry fan-out, the dashboards —
 * stops showing the business on its next render. What this adds is the cached
 * pages. The storefront and its subpages are purged now, because a buyer holding
 * the link is the person most likely to arrive next. Category, area and emirate
 * pages revalidate every five minutes and curated lists every hour, and they
 * are left to do so: purging every listing page in the directory for one
 * closure would start the whole site cold, which is the cost the workspace's
 * deploy rules exist to avoid.
 *
 * Only callable inside a request — an action or a route handler — which is why
 * it is not inside the service. See lib/taxonomy/service.ts for the same split.
 */
export function revalidateClosure(slug: string): void {
  revalidatePath(`/b/${slug}`, "layout");
  revalidatePath("/sitemap.xml");
}
