import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSafeNext } from "@/lib/auth/flow";

/**
 * Where an emailed link lands.
 *
 * Two jobs, and the second is the one board 7a draws. If the link is good,
 * exchange it for a session and move on. If it is not, translate whatever
 * Supabase put in the query string into one of our states — an expired link is
 * `error=access_denied&error_code=otp_expired`, and left alone it reaches the
 * user as a raw OAuth error in an address bar.
 *
 * Nothing here trusts `next`: it is attacker-controlled, and a redirect that
 * accepts an absolute URL is an open redirect with a session attached.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const flow = url.searchParams.get("flow");
  const next = url.searchParams.get("next");

  const errorCode = url.searchParams.get("error_code");
  const error = url.searchParams.get("error");

  if (errorCode || error) {
    const expired = errorCode === "otp_expired" || /expired/i.test(url.searchParams.get("error_description") ?? "");
    const destination = flow === "reset" ? "/reset" : "/signin";
    return NextResponse.redirect(
      new URL(`${destination}?error=${expired ? "link_expired" : "unavailable"}`, url.origin),
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/signin?error=link_expired", url.origin));
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    // A code that will not exchange is, from the user's side, an expired link:
    // it was in an email, they clicked it, it did not work. The distinction
    // between expired and already-used is ours to log, not theirs to read.
    const destination = flow === "reset" ? "/reset" : "/signin";
    return NextResponse.redirect(new URL(`${destination}?error=link_expired`, url.origin));
  }

  if (flow === "reset") {
    // Straight to the form, inside the recovery session.
    return NextResponse.redirect(new URL("/reset?stage=set", url.origin));
  }

  const destination = next && isSafeNext(next) ? next : "/account/enquiries";
  return NextResponse.redirect(new URL(destination, url.origin));
}
