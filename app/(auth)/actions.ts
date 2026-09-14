"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  isSafeNext,
  startSignIn,
  startSignUp,
  verifyCode,
  type AuthOutcome,
  type CodePurpose,
} from "@/lib/auth/flow";
import { normaliseIdentifier } from "@/lib/auth/identity";
import { signInWithPassword } from "@/lib/auth/password";
import { requestPasswordReset, RESET_COOKIE, setPasswordFromGrant } from "@/lib/auth/reset";
import type { SignUpFormState } from "./_components/signup-state";

/**
 * The forms.
 *
 * Thin: read the form, ask the service, turn the outcome into a redirect. Every
 * invariant is in lib/auth — flow.ts, password.ts, reset.ts — where it is
 * testable without a request.
 *
 * Outcomes travel in the query string rather than in a cookie or a POST body,
 * because each one is a page somebody may reload, bookmark or be sent back to
 * by the browser's back button. None of them carries anything secret: an
 * identifier is masked before it is rendered, a code never leaves the form it
 * was typed into, and a password never reaches a URL at all.
 *
 * Two things do travel in cookies, and both because they must not sit in a URL:
 * a reset grant (`bl_reset`, see lib/auth/reset.ts), and the sign-up form's
 * fields for "use email instead" (`bl_signup`), which name a mobile, an email
 * and a person.
 */

const SIGNUP_COOKIE = "bl_signup";
const SIGNUP_COOKIE_SECONDS = 30 * 60;

async function callerIp(): Promise<string | null> {
  const h = await headers();
  // Vercel sets x-forwarded-for. Take the first hop; the rest are proxies and
  // any of them can be spoofed by the client, so this is a signal, not proof.
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function secureCookies(): Promise<boolean> {
  const h = await headers();
  return (h.get("x-forwarded-proto") ?? "").includes("https");
}

/**
 * Where an outcome sends the browser. One place, so the screens stay dumb.
 *
 * `from` is the screen the form was on. It exists because there is more than
 * one door: `/signin`, `/for-buyers`, `/list-your-business` and `/staff` all
 * post to these same actions, and a refusal that always landed on `/signin`
 * would drop a supplier out of the flow they were reading. It is carried on to
 * `/verify` for the same reason — "start again" should start again where they
 * started, not somewhere they have never been.
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
  purpose: CodePurpose = "signin",
): string {
  const params = new URLSearchParams();
  if (next && isSafeNext(next)) params.set("next", next);

  const origin = from && isSafeNext(from) ? from : base;
  if (origin !== "/signin") params.set("from", origin);

  /*
     A refusal on `/verify` stays on `/verify`. The code form is the screen the
     person is on — a wrong code, a lockout, a resend held behind its 24 seconds
     — and sending it back to the door they came through (`from`) threw away the
     code screen and put "that code did not match" above a sign-up form.
  */
  if (!outcome.ok && base === "/verify") {
    params.set("error", outcome.kind);
    if ("retryAfterSeconds" in outcome) params.set("retry", String(outcome.retryAfterSeconds));
    if ("limit" in outcome) params.set("limit", String(outcome.limit));
    if ("attemptsLeft" in outcome) params.set("left", String(outcome.attemptsLeft));
    params.set("to", identifier);
    return `/verify?${params}`;
  }
  if (purpose === "reset") params.set("purpose", "reset");

  if (outcome.ok && outcome.kind === "code_sent") {
    params.set("to", outcome.identifier.value);
    params.set("masked", outcome.masked);
    params.set("channel", outcome.channel);
    if (outcome.fellBack) params.set("fell", "1");
    return `/verify?${params}`;
  }
  if (outcome.ok && outcome.kind === "reset_sent") {
    params.delete("from");
    params.set("sent", outcome.masked);
    return `/reset?${params}`;
  }
  if (outcome.ok && outcome.kind === "signed_in") return outcome.destination;
  if (outcome.ok) return base;

  params.set("error", outcome.kind);
  if ("retryAfterSeconds" in outcome) params.set("retry", String(outcome.retryAfterSeconds));
  if ("limit" in outcome) params.set("limit", String(outcome.limit));
  if ("attemptsLeft" in outcome) params.set("left", String(outcome.attemptsLeft));
  if (identifier) params.set("to", identifier);
  // Back to the page the form was on, with its own copy intact — so `from` is
  // the destination here rather than a parameter on it.
  params.delete("from");
  return `${origin}?${params}`;
}

/** Ask for a code. `/signin`'s secondary button and every entry door. */
export async function signInAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const next = asString(formData.get("next"));
  const from = asString(formData.get("from"));
  const outcome = await startSignIn({ identifier, ip: await callerIp() });
  redirect(outcomeUrl(outcome, "/signin", identifier, next, from));
}

/**
 * Sign in with a password — board 7a, state one, as drawn.
 *
 * The password is read here and handed to the service, and appears in no
 * redirect: a refusal returns the identifier so the field is filled again, and
 * the password field comes back empty, which is what every browser expects.
 */
export async function passwordSignInAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = asString(formData.get("next"));
  const outcome = await signInWithPassword({ identifier, password, next, ip: await callerIp() });
  redirect(outcomeUrl(outcome, "/signin", identifier, next, null));
}

/**
 * Create an account — board 7a, state two.
 *
 * `useActionState` rather than a redirect, because this is the one auth form
 * with several fields worth keeping: a refusal about the email should not make
 * somebody type their name and mobile again, and putting a name, a mobile and an
 * email in a query string to preserve them would put all three in every log the
 * URL passes through. Success still redirects, to a `/verify` that is a page.
 */
export async function signUpAction(_previous: SignUpFormState, formData: FormData): Promise<SignUpFormState> {
  const values = {
    fullName: String(formData.get("fullName") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    intent: formData.get("intent") === "listing" ? ("listing" as const) : ("buying" as const),
  };
  const termsAccepted = formData.get("terms") === "on";
  const next = asString(formData.get("next"));

  const outcome = await startSignUp({ ...values, termsAccepted, ip: await callerIp() });

  if (!outcome.ok) {
    return {
      values,
      termsAccepted,
      error: outcome.kind,
      retry: "retryAfterSeconds" in outcome ? outcome.retryAfterSeconds : null,
      limit: "limit" in outcome ? outcome.limit : null,
    };
  }

  const jar = await cookies();
  jar.set(SIGNUP_COOKIE, JSON.stringify(values), {
    httpOnly: true,
    secure: await secureCookies(),
    sameSite: "lax",
    path: "/verify",
    maxAge: SIGNUP_COOKIE_SECONDS,
  });

  redirect(outcomeUrl(outcome, "/signup", values.phone, next, "/signup"));
}

export async function verifyAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const code = String(formData.get("code") ?? "");
  const next = asString(formData.get("next"));
  const from = asString(formData.get("from"));
  const purpose = asPurpose(formData.get("purpose"));

  const outcome = await verifyCode({ identifier, code, next, purpose, ip: await callerIp() });

  if (outcome.ok && outcome.kind === "reset_granted") {
    await setResetCookie(outcome.token);
    redirect("/reset?stage=set");
  }
  if (outcome.ok && outcome.kind === "signed_in") {
    (await cookies()).delete({ name: SIGNUP_COOKIE, path: "/verify" });
  }
  redirect(outcomeUrl(outcome, "/verify", identifier, next, from, purpose));
}

/** The resend on the verify screen. Same throttle, same 24-second lock. */
export async function resendAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const next = asString(formData.get("next"));
  const from = asString(formData.get("from"));
  const purpose = asPurpose(formData.get("purpose"));
  const outcome = await startSignIn({ identifier, ip: await callerIp() });
  redirect(outcomeUrl(outcome, "/verify", identifier, next, from, purpose));
}

/**
 * "Use email instead" — board 7a's verify panel, secondary action.
 *
 * For a sign-up it resends to the email typed on the form, read back from the
 * `bl_signup` cookie this browser was given when it sent that form. Anybody
 * else — a sign-in or a reset by mobile — goes back to their form to type the
 * email, because this screen does not know it and must not look it up: a
 * mobile number is not a key that should unlock a masked email address.
 */
export async function useEmailInsteadAction(formData: FormData): Promise<void> {
  const next = asString(formData.get("next"));
  const purpose = asPurpose(formData.get("purpose"));
  const jar = await cookies();
  const saved = readSignUpCookie(jar.get(SIGNUP_COOKIE)?.value);

  // Only the sign-up this browser just sent, for the mobile this screen is
  // verifying. A cookie left from an earlier sign-up must not redirect a later
  // sign-in's code to that form's email.
  const verifying = normaliseIdentifier(String(formData.get("identifier") ?? ""));
  const sameSignUp = saved && verifying && normaliseIdentifier(saved.phone)?.value === verifying.value;

  if (purpose === "signin" && saved && sameSignUp) {
    const outcome = await startSignUp({ ...saved, termsAccepted: true, prefer: "email", ip: await callerIp() });
    redirect(outcomeUrl(outcome, "/signup", saved.email, next, "/signup"));
  }

  const params = new URLSearchParams({ use: "email" });
  if (next && isSafeNext(next)) params.set("next", next);
  redirect(`${purpose === "reset" ? "/reset" : "/signin"}?${params}`);
}

export async function requestResetAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "");
  const outcome = await requestPasswordReset({ identifier, ip: await callerIp() });
  redirect(outcomeUrl(outcome, "/reset", identifier, null, null, "reset"));
}

/**
 * Save a new password against the grant in this browser's cookie, and sign in
 * with it — board 7a's "Save and sign in".
 *
 * There is no token in the form on purpose. The grant is the cookie the link or
 * the verified code set; taking a token from the form as well would be a second,
 * weaker way in.
 */
export async function setPasswordAction(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const next = asString(formData.get("next"));
  const jar = await cookies();
  const token = jar.get(RESET_COOKIE)?.value;

  const outcome = await setPasswordFromGrant({ token, password, next, ip: await callerIp() });
  const clear = () => jar.delete({ name: RESET_COOKIE, path: "/reset" });

  if (outcome.ok && outcome.kind === "signed_in") {
    clear();
    redirect(outcome.destination);
  }
  if (outcome.ok) {
    clear();
    redirect("/signin?notice=password_saved");
  }

  switch (outcome.kind) {
    case "password_rejected":
      redirect(`/reset?stage=set&error=password_rejected&problem=${outcome.problem}&length=${outcome.length}`);
    case "unavailable":
      redirect("/reset?stage=set&error=unavailable");
    default:
      clear();
      redirect(`/reset?error=${outcome.kind === "suspended" ? "suspended" : "link_expired"}`);
  }
}

async function setResetCookie(token: string): Promise<void> {
  const { RESET_LINK_MINUTES } = await import("@/lib/auth/reset");
  (await cookies()).set(RESET_COOKIE, token, {
    httpOnly: true,
    secure: await secureCookies(),
    sameSite: "lax",
    path: "/reset",
    maxAge: RESET_LINK_MINUTES * 60,
  });
}

function readSignUpCookie(
  raw: string | undefined,
): { fullName: string; phone: string; email: string; intent: "buying" | "listing" } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { fullName, phone, email, intent } = parsed;
    if (typeof fullName !== "string" || typeof phone !== "string" || typeof email !== "string") return null;
    return { fullName, phone, email, intent: intent === "listing" ? "listing" : "buying" };
  } catch {
    return null;
  }
}

function asPurpose(value: FormDataEntryValue | null): CodePurpose {
  return value === "reset" ? "reset" : "signin";
}

function asString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Sign out — board 10e's account menu.
 *
 * A POST from a form, never a link: a link that ends a session is one a
 * prefetch, a mail scanner or a crawler can follow. Supabase's `signOut` ends
 * this session and clears its cookies; other devices stay signed in, which is
 * what "sign out" means everywhere else.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
