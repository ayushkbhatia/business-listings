"use server";

import { cookies, headers } from "next/headers";
import { getActor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { siteUrl } from "@/lib/site";
import { sourcePathFrom, type LandlineNumber, type LeadProblems } from "@/lib/contact/lead-form";
import {
  SESSION_COOKIE,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE_S,
  readSessionId,
  readVisitorId,
  recordWhatsAppOpen,
  revealedInSession,
  revealForReturningVisitor,
  submitContactLead,
  type LeadPrefill,
  type RevealOutcome,
  type RevealViewer,
} from "@/lib/contact/service";

/**
 * Board `1d` amendment — the storefront's three contact actions.
 *
 * Server actions because the reveal is written server-side (`B1`): a reveal the
 * browser merely drew would make the seller's lead count a function of ad
 * blockers. And because the number is not in the page (`B2`), the action's
 * reply is the only place it comes from.
 *
 * The rules live in `lib/contact/service.ts`. What is here is the request: who
 * is asking, from which page, and the two cookies the answer sets.
 */

export type RevealActionResult =
  | { ok: true; numbers: Record<string, LandlineNumber>; headLocationId: string | null }
  | { ok: false; reason: "form_required"; prefill: LeadPrefill | null }
  | { ok: false; reason: "no_landline" | "unavailable" }
  | { ok: false; reason: "invalid"; problems: LeadProblems }
  | { ok: false; reason: "rate_limited"; retryAfterS: number };

async function viewer(): Promise<RevealViewer> {
  const [store, actor] = await Promise.all([cookies(), getActor()]);
  return {
    visitorId: readVisitorId(store.get(VISITOR_COOKIE)?.value),
    sessionId: readSessionId(store.get(SESSION_COOKIE)?.value),
    actorId: await accountOf(actor?.id ?? null),
  };
}

/**
 * The actor's id only where a profile row backs it.
 *
 * `getActor` returns an actor for any live auth session, and a session can
 * exist with no `user` row — a sign-in abandoned before its profile was
 * written, or an auth user from another database sharing the auth project.
 * Clicking through this screen found the second: the lead and the reveal both
 * failed their foreign key, and the buyer's details were lost while the number
 * showed. A lead with no account is still a lead; one written against an
 * account that does not exist is no row at all.
 */
async function accountOf(actorId: string | null): Promise<string | null> {
  if (!actorId) return null;
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true } });
  return user?.id ?? null;
}

/** `B9`. The platform's own hosts: the one this request came in on, and the configured site. */
async function platformHosts(): Promise<string[]> {
  const store = await headers();
  const hosts = [store.get("x-forwarded-host"), store.get("host")].filter((h): h is string => Boolean(h));
  try {
    hosts.push(new URL(siteUrl()).host);
  } catch {
    // A misconfigured site URL costs the source column, not the reveal.
  }
  return hosts;
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * A browser-session cookie: no max-age, so closing the browser ends it and the
 * storefront is masked again next time (`B6`).
 *
 * Readable by the page's script, deliberately. It grants nothing on its own —
 * the server looks the reveal up — and a cached page (the branches tab) needs
 * to know whether there is a session worth asking about before it asks.
 */
function setSessionCookie(store: CookieStore, sessionId: string): void {
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

async function settle(outcome: RevealOutcome): Promise<RevealActionResult> {
  if (!outcome.ok) return outcome;

  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  setSessionCookie(store, outcome.sessionId);
  if (outcome.visitorId) {
    // Set by a submitted form and by nothing before it — a visitor who never
    // asks for a number is never given an identifier.
    store.set(VISITOR_COOKIE, outcome.visitorId, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: VISITOR_COOKIE_MAX_AGE_S,
    });
  }
  return { ok: true, numbers: outcome.landlines.numbers, headLocationId: outcome.landlines.headLocationId };
}

/**
 * The masked chip, clicked. Reveals directly for a visitor who has answered the
 * form on this listing before (`B10`); otherwise says the form is needed, and
 * the dialog opens. Nothing is written on that refusal.
 */
export async function revealLandlineAction(input: {
  businessId: string;
  referrer: string | null;
}): Promise<RevealActionResult> {
  try {
    const [who, hosts] = await Promise.all([viewer(), platformHosts()]);
    return await settle(
      await revealForReturningVisitor({
        businessId: String(input.businessId),
        viewer: who,
        sourcePath: sourcePathFrom(input.referrer, hosts),
      }),
    );
  } catch (error) {
    console.error("[contact] reveal failed", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** The form, submitted. Every field problem at once, or the numbers. */
export async function submitLandlineLeadAction(input: {
  businessId: string;
  name: string;
  email: string;
  mobile: string;
  referrer: string | null;
}): Promise<RevealActionResult> {
  try {
    const [who, hosts] = await Promise.all([viewer(), platformHosts()]);
    return await settle(
      await submitContactLead({
        businessId: String(input.businessId),
        fields: {
          name: String(input.name ?? ""),
          email: String(input.email ?? ""),
          mobile: String(input.mobile ?? ""),
        },
        viewer: who,
        sourcePath: sourcePathFrom(input.referrer, hosts),
      }),
    );
  } catch (error) {
    console.error("[contact] lead submit failed", error);
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * The WhatsApp chip, opened (`B4`). Recorded and never waited on — the link has
 * already opened in its own tab.
 *
 * **Sets no cookie.** Every other cookie on this path answers something the
 * buyer asked for — keep the number I revealed, do not ask me again — and so
 * does not need consent (`docs/telemetry.md` §4a). Deduplicating a counter is
 * not something a buyer asked for, so an open is tied to a session only where
 * the buyer already has one from a reveal, and the island sends one per page
 * otherwise.
 */
export async function recordWhatsAppAction(input: { businessId: string; referrer: string | null }): Promise<void> {
  try {
    const [who, hosts] = await Promise.all([viewer(), platformHosts()]);
    await recordWhatsAppOpen({
      businessId: String(input.businessId),
      viewer: who,
      sourcePath: sourcePathFrom(input.referrer, hosts),
    });
  } catch (error) {
    console.error("[contact] whatsapp open was not recorded", error);
  }
}

/**
 * For a cached storefront route: whether this session already revealed on the
 * listing, and the numbers if it did. Writes nothing.
 */
export async function revealedStateAction(input: {
  businessId: string;
}): Promise<{ numbers: Record<string, LandlineNumber>; headLocationId: string | null } | null> {
  try {
    const landlines = await revealedInSession(String(input.businessId), await viewer());
    return landlines ? { numbers: landlines.numbers, headLocationId: landlines.headLocationId } : null;
  } catch (error) {
    console.error("[contact] revealed state could not be read", error);
    return null;
  }
}
