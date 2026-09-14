import { NextResponse, type NextRequest } from "next/server";
import { readResetGrant, RESET_COOKIE } from "@/lib/auth/reset";

/**
 * Where an emailed reset link lands — board 7a `B6`.
 *
 * **It reads and never consumes.** Mail scanners follow links, and a person may
 * open the same email on a laptop and then a phone. Only saving a password uses
 * a grant, so neither of those spends it.
 *
 * **The token leaves the URL here.** It moves into an httpOnly cookie scoped to
 * `/reset` and the browser is sent to a clean `/reset?stage=set`, so the address
 * bar, the history, a screenshot and any `Referer` the reset page sends carry
 * nothing redeemable. The cookie lives only as long as the grant has left.
 *
 * An expired, used or malformed token is one answer — "request another" — for
 * the same reason a wrong code and an expired code are one answer on `/verify`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const grant = await readResetGrant(token);

  if (!grant || !token) return redirectTo("/reset?error=link_expired");

  const response = redirectTo("/reset?stage=set");
  response.cookies.set(RESET_COOKIE, token, {
    httpOnly: true,
    secure: url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    sameSite: "lax",
    path: "/reset",
    maxAge: Math.max(1, Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000)),
  });
  return response;
}

/**
 * A relative `Location`, resolved by the browser against the address it used.
 *
 * `request.url` is the server's idea of its own origin, which is not always the
 * one in the address bar — behind a proxy, or `next dev` answering 127.0.0.1 as
 * localhost. The grant cookie is set for the host the browser asked, and a
 * redirect to a different host arrives without it, reading as an expired link
 * to somebody holding a good one.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: path, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
  });
}
