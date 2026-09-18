import { NextResponse, type NextRequest } from "next/server";
import { changeTray, trayCookie } from "@/lib/compare/service";
import { COMPARE_COOKIE, isCompareIntent, parseTray, type CompareChange } from "@/lib/compare/tray";

/**
 * Board `10d` — the one writer of the comparison tray.
 *
 * ## Why a route and not a Server Action
 *
 * A Server Action that sets a cookie re-renders the page it was called from, on
 * the server, so the UI can reflect the cookie. On `/search` that is the whole
 * blended loader again — four candidate queries, the rail and the ranking — for
 * a click that changes a strip at the foot of the page. A route answers with the
 * cookie and nothing else, and the tray redraws itself from it.
 *
 * ## Two callers, one answer
 *
 * The tick posts a form. With JavaScript on, it posts with `Accept:
 * application/json` and gets the new tray back; with it off, the browser posts
 * the form itself and is sent back to the page it came from with a 303, the
 * cookie already set. The rules are the same either way because they are
 * `changeTray`'s, not this file's.
 *
 * ## Nothing here is about who the buyer is
 *
 * No session, no account, no audit row and no event. The cookie holds products
 * the buyer chose and is read for nothing but drawing their tray
 * (`docs/telemetry.md` §4b).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A tick's form is three short fields. Anything larger is not one. */
const MAX_BODY_BYTES = 2048;

/**
 * Whether a request came from a page of ours.
 *
 * `SameSite=Lax` keeps the tray cookie off a cross-site POST, but a forged form
 * could still *set* a tray. Nothing is harmed by that — it is the buyer's own
 * scratchpad — and it is refused anyway, because a public endpoint that writes
 * state for a page on another site is a shape worth never having. A request
 * with no `Origin` header is a same-origin one from a browser that omits it on
 * form posts, and is allowed.
 */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Where a plain form post goes back to — the page it came from, never another site. */
function returnPath(request: NextRequest): string {
  const referer = request.headers.get("referer");
  if (!referer) return "/compare";
  try {
    const url = new URL(referer);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (url.host !== host || url.pathname.startsWith("/api/")) return "/compare";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/compare";
  }
}

/**
 * An absolute URL on the host the buyer is actually on.
 *
 * `request.url` behind the platform's proxy can name the deployment rather than
 * the address in the bar, and a redirect there drops the buyer onto a host
 * their tray cookie was never set on.
 */
function publicUrl(request: NextRequest, path: string): URL {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "");
  return new URL(path, `${proto}://${host}`);
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const intent = form.get("intent");
  if (!isCompareIntent(intent)) return new NextResponse(null, { status: 400 });
  const productId = typeof form.get("productId") === "string" ? String(form.get("productId")) || null : null;

  const current = parseTray(request.cookies.get(COMPARE_COOKIE)?.value);
  const change: CompareChange = await changeTray(current, intent, productId);

  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  const response = wantsJson ? NextResponse.json(change) : NextResponse.redirect(publicUrl(request, returnPath(request)), 303);

  /*
     Written only when the tray actually changed. A refused fifth, a product no
     longer listed and an idempotent re-add leave the cookie as it was — there is
     nothing to write, and writing it anyway would restart nothing but still
     cost a header on a response that has none to spare.
  */
  if (change.outcome === "added" || change.outcome === "replaced" || change.outcome === "removed" || change.outcome === "cleared") {
    const cookie = trayCookie(change.tray);
    if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
    else response.cookies.delete(COMPARE_COOKIE);
  }
  /* Never cached: the answer is this buyer's tray. */
  response.headers.set("cache-control", "no-store");
  return response;
}
