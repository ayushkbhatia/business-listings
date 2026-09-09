import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_MAX_AGE_S,
  encode,
  fromSearchParams,
} from "@/lib/campaign/attribution";
import { labelFromHost } from "@/lib/domains/label";

/**
 * Session refresh, criterion 9's first half, and the one thing that has to
 * happen before a route is chosen: which host asked.
 *
 * Attribution is captured here rather than on the campaign page for two
 * reasons. A page component cannot modify cookies in the App Router — Next
 * refuses with "cookies can only be modified in a Server Action or Route
 * Handler" — and a tagged link can point at a guide or a trade page as easily
 * as at `/lp/...`, so one place catches all of them.
 *
 * No database client here, which is why the cookie stores the campaign slug
 * rather than its id. `createEnquiry` resolves it. The same constraint is why
 * `lib/domains/label.ts` is pure: a storefront's host has to become a path by
 * string work alone, because there is nothing here to ask.
 */

/**
 * Paths that stay on the platform even when the host is a seller's.
 *
 * A subdomain is a storefront and everything under it is that storefront's —
 * except the two that are not pages at all. `/api` carries the cron routes and
 * the OTP hook, and `/auth` carries Supabase's callback; rewriting either into
 * `/b/<label>` would turn a working endpoint into a 404 on that host.
 */
const PLATFORM_PREFIXES = ["/api", "/auth"];

export default async function proxy(request: NextRequest) {
  const { response } = await updateSession(request);

  // First touch wins, so an existing cookie is never overwritten.
  if (!request.cookies.has(ATTRIBUTION_COOKIE)) {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const landing = request.nextUrl.pathname.match(/^\/lp\/([a-z0-9][a-z0-9-]*)\/?$/);
    const attribution = fromSearchParams(params, landing?.[1] ?? null);

    if (attribution) {
      response.cookies.set(ATTRIBUTION_COOKIE, encode(attribution), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ATTRIBUTION_MAX_AGE_S,
      });
    }
  }

  /*
     A seller's own web address, served as their storefront.

     `labelFromHost` returns null for the apex, for `www`, for anything outside
     our zone and for every reserved label, so the directory routes exactly as
     it did on every host but a seller's. It cannot check the label exists —
     there is no database here — so an unclaimed one rewrites to `/b/<label>`
     and the storefront route 404s it, which is the same answer a wrong slug
     already gets.

     A rewrite rather than a redirect: the address the seller was given is the
     one that stays in the bar, which is the whole of what they bought. The page
     underneath still declares `businesslistings.me/b/<slug>` as its canonical —
     `metadataBase` is built from `NEXT_PUBLIC_SITE_URL` rather than from the
     request — so search engines are told, on every one of these pages, that the
     directory holds the copy worth indexing.
  */
  const label = labelFromHost(request.headers.get("host"));
  if (label) {
    const { pathname } = request.nextUrl;
    const platform = PLATFORM_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );

    if (!platform) {
      const url = request.nextUrl.clone();
      url.pathname = pathname === "/" ? `/b/${label}` : `/b/${label}${pathname}`;

      // The rewrite is a new response, so the cookies the two steps above set
      // have to be carried onto it. Dropping them would sign a visitor out on
      // every storefront request and lose the campaign the click came from.
      const rewritten = NextResponse.rewrite(url, { request });
      for (const cookie of response.cookies.getAll()) rewritten.cookies.set(cookie);
      return rewritten;
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff2?)$).*)",
  ],
};
