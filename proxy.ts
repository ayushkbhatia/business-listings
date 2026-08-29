import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_MAX_AGE_S,
  encode,
  fromSearchParams,
} from "@/lib/campaign/attribution";

/**
 * Session refresh, and criterion 9's first half.
 *
 * Attribution is captured here rather than on the campaign page for two
 * reasons. A page component cannot modify cookies in the App Router — Next
 * refuses with "cookies can only be modified in a Server Action or Route
 * Handler" — and a tagged link can point at a guide or a trade page as easily
 * as at `/lp/...`, so one place catches all of them.
 *
 * No database client here, which is why the cookie stores the campaign slug
 * rather than its id. `createEnquiry` resolves it.
 */
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

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff2?)$).*)",
  ],
};
