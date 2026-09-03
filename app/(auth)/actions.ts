"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  isSafeNext,
  requestPasswordReset,
  startSignIn,
  startSignUp,
  verifyCode,
  type AuthOutcome,
} from "@/lib/auth/flow";
import { absoluteUrl } from "@/lib/site";

/**
 * The four forms.
 *
 * Thin: read the form, ask the service, turn the outcome into a redirect. Every
 * invariant is in lib/auth/flow.ts, where it is testable without a request —
 * see tests/integration/auth-flow.test.ts.
 *
 * Outcomes travel in the query string rather than in a cookie or a POST body,
 * because each one is a page somebody may reload, bookmark or be sent back to
 * by the browser's back button. None of them carries anything secret: an
 * identifier is masked before it is rendered, and the code never leaves the
 * form it was typed into.
 */

async function callerIp(): Promise<string | null> {
  const h = await headers();
  // Vercel sets x-forwarded-for. Take the first hop; the rest are proxies and
  // any of them can be spoofed by the client, so this is a signal, not proof.
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * Where an outcome sends the browser. One place, so the screens stay dumb.
 *
 * `from` is the screen the form was on. It exists because there is now more
 * than one door: `/signin`, `/for-buyers`, `/list-your-business` and `/staff`
 * all post to these same actions, and a refusal that always landed on
 * `/signin` would drop a supplier out of the flow they were reading. It is
 * carried on to `/verify` for the same reason — "start again" should start
 * again where they started, not somewhere they have never been.
 *
 * Attacker-controlled, like `next`, and validated the same way. Unlike `next`
 * it decides nothing but which page renders a form; it is never a destination
 * for a signed-in session.
 */
function outcomeUrl(
  outcome: AuthOutcome,
  base: string,
  identifier: string,
  next: string | null,
  from: string | null,
): string {
  const params = new URLSearchParams();
  if (next && isSafeNext(next)) params.set("next", next);

  const origin = from && isSafeNext(from) ? from : base;
  if (origin !== "/signin") params.set("from", origin);

  if (outcome.ok && outcome.kind === "code_sent") {
    params.set("to", identifier);
    params.set("masked", outcome.masked);
    return `/verify?${params}`;
  }
  if (outcome.ok && outcome.kind === "reset_sent") {
    params.set("sent", outcome.masked);
    return `/reset?${params}`;
  }
  if (outcome.ok && outcome.kind === "signed_in") return outcome.destination;

  params.set("error", outcome.kind);
  if ("retryAfterSeconds" in outcome) params.set("retry", String(outcome.retryAfterSeconds));
  if ("limit" in outcome) params.set("limit", String(outcome.limit));
  if (outcome.kind === "suspended") params.set("since", outcome.since.toISOString());
  if (identifier) params.set("to", identifier);
  // Back to the page the form was on, with its own copy intact — so `from` is
  // the destination here rather than a parameter on it.
  params.delete("from");
  return `${origin}?${params}`;
}

export async function signInAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const next = asString(formData.get("next"));
  const from = asString(formData.get("from"));
  const outcome = await startSignIn({ identifier, ip: await callerIp() });
  redirect(outcomeUrl(outcome, "/signin", identifier, next, from));
}

export async function signUpAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const wantsToBuy = formData.get("wantsToBuy") === "on";
  const wantsToList = formData.get("wantsToList") === "on";
  const next = asString(formData.get("next"));
  const from = asString(formData.get("from"));

  if (!fullName) {
    redirect(`/signup?error=name_required&to=${encodeURIComponent(identifier)}`);
  }
  if (!wantsToBuy && !wantsToList) {
    redirect(`/signup?error=intent_required&to=${encodeURIComponent(identifier)}`);
  }

  const outcome = await startSignUp({
    identifier,
    fullName,
    wantsToBuy,
    wantsToList,
    ip: await callerIp(),
  });
  redirect(outcomeUrl(outcome, "/signup", identifier, next, from));
}

export async function verifyAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const code = String(formData.get("code") ?? "");
  const next = asString(formData.get("next"));
  const from = asString(formData.get("from"));

  const outcome = await verifyCode({ identifier, code, next, ip: await callerIp() });
  redirect(outcomeUrl(outcome, "/verify", identifier, next, from));
}

/** The resend on the verify screen. Same throttle, same cooldown. */
export async function resendAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const next = asString(formData.get("next"));
  const from = asString(formData.get("from"));
  const outcome = await startSignIn({ identifier, ip: await callerIp() });
  redirect(outcomeUrl(outcome, "/verify", identifier, next, from));
}

export async function requestResetAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const outcome = await requestPasswordReset({
    identifier,
    ip: await callerIp(),
    redirectTo: absoluteUrl("/auth/callback?flow=reset"),
  });
  redirect(outcomeUrl(outcome, "/reset", identifier, null, null));
}

/**
 * Set a new password, inside the recovery session the callback established.
 *
 * There is no token here on purpose. By this point Supabase has exchanged the
 * link for a session; taking a token from the form as well would be a second,
 * weaker way in.
 */
export async function setPasswordAction(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 12) {
    redirect(`/reset?error=too_short&length=${password.length}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  redirect(error ? "/reset?error=link_expired" : "/reset?done=1");
}

function asString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value ? value : null;
}
