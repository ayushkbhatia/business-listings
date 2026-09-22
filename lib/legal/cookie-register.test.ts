import { describe, expect, it } from "vitest";
import { ATTRIBUTION_COOKIE } from "@/lib/campaign/attribution";
import { COMPARE_COOKIE } from "@/lib/compare/tray";
import { SESSION_COOKIE, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE_S } from "@/lib/contact/cookies";
import { en } from "@/lib/i18n";
import {
  COOKIE_CATEGORIES,
  COOKIE_REGISTER,
  REGISTERED_COOKIE_NAMES,
  type CookieCategory,
} from "./cookie-register";

/**
 * Board 13h §3 asks for a crawl: `Set-Cookie` across the public routes and a
 * signed-in dashboard, in three consent states, asserted to equal the register.
 * That job cannot be written yet — there is no banner, no `bl_consent` and no
 * analytics collection to turn off, all three of which 13h §4 files as owed.
 *
 * What can be written is the half that does not need a running site: the shape
 * of the register, and the names the code declares. The second one already
 * fails the page's own claim, and the pin at the bottom is that failure written
 * down rather than discovered later by a reader counting cookies.
 */

describe("the cookie register", () => {
  it("holds twelve distinct cookies", () => {
    // Nine from board 13h, and the three the 22 Sep 2026 amendment added.
    expect(COOKIE_REGISTER).toHaveLength(12);
    expect(REGISTERED_COOKIE_NAMES.size).toBe(12);
  });

  it("uses the four categories the page bands, in that order", () => {
    const bands = COOKIE_CATEGORIES.map((band) => band.category);
    expect(bands).toEqual(["essential", "preferences", "analytics", "advertising"]);

    const seen: CookieCategory[] = [];
    for (const cookie of COOKIE_REGISTER) {
      if (seen[seen.length - 1] !== cookie.category) seen.push(cookie.category);
    }
    expect(seen).toEqual(bands);
  });

  it("carries copy for every cookie and every band", () => {
    for (const cookie of COOKIE_REGISTER) {
      expect(en[cookie.purposeKey], cookie.name).toBeTruthy();
      expect(en[cookie.lifeKey], cookie.name).toBeTruthy();
    }
    for (const band of COOKIE_CATEGORIES) expect(en[band.labelKey]).toBeTruthy();
  });

  it("remembers the consent cookie is essential", () => {
    // 13h §2. A "no" that is not remembered means asking again on every page,
    // which is worse than the cookie — so it is set whatever the answer is.
    const consent = COOKIE_REGISTER.find((cookie) => cookie.name === "bl_consent");
    expect(consent?.category).toBe("essential");
  });

  /*
     The gap, pinned.

     §02 of the page says "a cookie not on this list is a defect". `bl_attr` is
     one: the proxy sets it on any inbound link carrying UTM parameters, it has
     been shipped since criterion 9, and it is not in the register. Whether it
     belongs there as analytics, as advertising, or not at all — it is
     first-party, holds three values the inbound link already declared, and
     identifies nobody — is legal's call, and it is the same question 13h §7
     asks about `bl_sp`.

     Two Supabase auth cookies (`sb-<project>-auth-token`, and its chunked
     siblings) are the other half of the same gap: the register names the
     session cookie `bl_session`, and the shipped session is Supabase's. That
     one is a rename, not a decision.

     This assertion is a tripwire and is meant to be deleted. Registering
     `bl_attr` breaks it, and the diff that breaks it is the diff that fixes the
     page.
  */
  it("does not yet name the attribution cookie the proxy sets", () => {
    expect(REGISTERED_COOKIE_NAMES.has(ATTRIBUTION_COOKIE)).toBe(false);
  });

});

/*
   The names the code sets, held to the names the page lists.

   Board `1d`'s reveal cookies and board `10d`'s comparison tray were each set
   for days before the register named them — found by a person reading, not by
   a test. The names are imported from the modules that set them, so renaming
   one in code without the register fails here rather than on the policy page.
*/
describe("the cookies a buyer's own actions set", () => {
  const OWN_ACTION = [
    [COMPARE_COOKIE, "Session"],
    [SESSION_COOKIE, "Session"],
    [VISITOR_COOKIE, "180 days"],
  ] as const;

  it.each(OWN_ACTION)("lists %s under Essential", (name) => {
    const entry = COOKIE_REGISTER.find((cookie) => cookie.name === name);
    expect(entry?.category).toBe("essential");
  });

  it.each(OWN_ACTION)("states the life %s is actually given", (name, life) => {
    const entry = COOKIE_REGISTER.find((cookie) => cookie.name === name)!;
    expect(en[entry.lifeKey]).toBe(life);
  });

  it("says 180 days because the code sets 180 days", () => {
    expect(VISITOR_COOKIE_MAX_AGE_S / 86_400).toBe(180);
  });
});
