import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  destinationFor,
  fromSupabaseError,
  isSafeNext,
  repairClaims,
  verifyCode,
} from "@/lib/auth/flow";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The whole sign-up and verify path, against the real Supabase project.
 *
 * The one thing that is not real is the delivery: `admin/generate_link` returns
 * the code Supabase generated without sending it anywhere. That is the leg
 * blocked on external configuration — Meta has not approved the WhatsApp
 * authentication template and the project's built-in SMTP sends two emails an
 * hour — so it is the one leg worth substituting. Everything after it is the
 * production code path: verifyOtp, the profile row, the roles claim, the
 * suspension check and the throttle.
 *
 * Skipped without a service key, and loudly. CI does not have one, and adding
 * a production key to CI is a decision to take deliberately rather than by
 * writing a test that needs it.
 */
const SECRET = process.env["SUPABASE_SECRET_KEY"];
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const live = Boolean(SECRET && URL);

if (!live) {
  console.warn(
    "[auth-flow] skipped: needs SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_URL. " +
      "The OTP round trip is unproven in this environment.",
  );
}

/** A gmail address: Supabase rejects reserved TLDs like .example as undeliverable. */
/**
 * One address per run, not one per suite.
 *
 * This test talks to the real Supabase project, and that project is shared:
 * CI and a laptop use the same one, while their Postgres databases are
 * separate. With a fixed address, `removeExisting` in one run deletes the auth
 * user the other has just created — which is exactly what happened when a CI
 * run at 17:21 overlapped a local `pnpm verify`, and produced a profile row
 * that was there a moment ago and gone by the update.
 *
 * Gmail's `+tag` addressing makes each run its own address, and Supabase treats
 * them as distinct users. `removeExisting` then only ever clears its own.
 */
const RUN = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const EMAIL = `bl.integration.buyer+${RUN}@gmail.com`;

let admin: SupabaseClient;
const createdUserIds: string[] = [];

beforeAll(() => {
  if (!live) return;
  admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
});

afterEach(async () => {
  if (!live) return;
  for (const id of createdUserIds.splice(0)) {
    await prisma.user.deleteMany({ where: { id } });
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
  await prisma.authAttempt.deleteMany({ where: { identifier: EMAIL } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Clear any leftover from an interrupted run.
 *
 * Paged, because this used to read the first 200 users and stop. Against a
 * throwaway instance that is every user; against the project `.env.local`
 * points at, it stopped being every user somewhere around 200, and from then on
 * the cleanup quietly found nothing and each interrupted run left one more
 * account behind. `nextPage` comes from the server's Link header, so this ends
 * on what the API actually returned rather than on a page size it may clamp.
 */
async function removeExisting(email: string) {
  for (let page = 1; ; ) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;

    for (const user of data.users) {
      if (user.email === email) {
        await prisma.user.deleteMany({ where: { id: user.id } });
        await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
      }
    }

    if (!data.nextPage) return;
    page = data.nextPage;
  }
}

/**
 * A code Supabase generated, without a send. `signup` is the link type that
 * exists for an address with no account, which is what a sign-up is.
 */
async function issueCode(email: string, metadata: Record<string, unknown>) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password: `${Math.random().toString(36).slice(2)}Aa1!${Math.random().toString(36).slice(2)}`,
    options: { data: metadata },
  });
  if (error || !data.properties) throw error ?? new Error("no link generated");
  createdUserIds.push(data.user!.id);
  return { code: data.properties.email_otp, userId: data.user!.id };
}

/** A browser-shaped client, which is what verifyOtp needs to mint a session. */
function anonClient(): SupabaseClient {
  return createClient(URL!, process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.skipIf(!live)("sign up, then verify", () => {
  it("creates a profile, grants buyer, and records the listing intent", async () => {
    await removeExisting(EMAIL);
    const { code, userId } = await issueCode(EMAIL, {
      full_name: "Mariam Al Suwaidi",
      wants_to_buy: true,
      wants_to_list: true,
    });

    const outcome = await verifyCode(
      { identifier: EMAIL, code },
      { supabase: anonClient() },
    );

    expect(outcome).toMatchObject({ ok: true, kind: "signed_in", userId });

    const profile = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(profile.fullName).toBe("Mariam Al Suwaidi");
    // The intent, not the role. `seller_owner` is scoped to a business and
    // there is no business until the claim flow in handoff 3 attaches one.
    expect(profile.roles).toEqual(["buyer"]);
    expect(profile.wantsToList).toBe(true);

    // The roles claim `getActor` reads, which only the service role may write.
    const { data } = await admin.auth.admin.getUserById(userId);
    expect(data.user?.app_metadata?.["roles"]).toEqual(["buyer"]);
  });

  it("turns a suspended account straight back out", async () => {
    await removeExisting(EMAIL);
    const { code, userId } = await issueCode(EMAIL, { full_name: "Suspended Person" });

    // Verify once to create the profile row, then suspend it and try again.
    await verifyCode({ identifier: EMAIL, code }, { supabase: anonClient() });
    await prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: new Date("2026-08-11T09:00:00Z") },
    });

    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
    const second = await verifyCode(
      { identifier: EMAIL, code: link.properties!.email_otp },
      { supabase: anonClient() },
    );

    expect(second).toMatchObject({ ok: false, kind: "suspended" });
  });

  it("refuses a wrong code without claiming it expired", async () => {
    // Supabase answers a wrong code and an expired one identically, and it is
    // right to: saying "expired" would confirm the code was once valid. This
    // asserts we do not pass that guess on as if we knew.
    await removeExisting(EMAIL);
    await issueCode(EMAIL, {});
    const outcome = await verifyCode(
      { identifier: EMAIL, code: "000000" },
      { supabase: anonClient() },
    );
    expect(outcome).toEqual({ ok: false, kind: "code_incorrect" });
  });

  it("locks the identifier out after five wrong codes", async () => {
    await removeExisting(EMAIL);
    await issueCode(EMAIL, {});
    const client = anonClient();
    for (let i = 0; i < 5; i += 1) {
      await verifyCode({ identifier: EMAIL, code: "000000" }, { supabase: client });
    }
    const locked = await verifyCode({ identifier: EMAIL, code: "000000" }, { supabase: client });
    expect(locked).toMatchObject({ ok: false, kind: "too_many_attempts" });
  });
});

describe("reading a Supabase error", () => {
  /*
   * Asserted on the mapping rather than by round-tripping through Supabase.
   * The live version needed the project's built-in SMTP, which sends two mails
   * an hour, so it passed or failed depending on what had run before it — and
   * the thing worth protecting is the decision, not the round trip.
   */
  it("calls a rejected address the user's typo, not a delivery failure", () => {
    expect(fromSupabaseError({ code: "email_address_invalid" })).toEqual({
      ok: false,
      kind: "invalid_identifier",
    });
  });

  it("reports the provider's own ceiling without quoting our limit", () => {
    // limit 0 means the ceiling was theirs; the screen must not say "5 codes".
    expect(fromSupabaseError({ code: "over_email_send_rate_limit" })).toMatchObject({
      kind: "too_many_attempts",
      limit: 0,
    });
  });

  it("calls a disabled provider unavailable rather than blaming the address", () => {
    expect(fromSupabaseError({ code: "phone_provider_disabled" })).toEqual({
      ok: false,
      kind: "unavailable",
    });
  });

  it("falls back to a delivery failure for anything unrecognised", () => {
    expect(fromSupabaseError({ code: "something_new", message: "?" })).toEqual({
      ok: false,
      kind: "delivery_failed",
    });
  });
});

describe("where a session lands", () => {
  it("sends a seller to their leads", () => {
    expect(destinationFor(["seller_owner"], null)).toBe("/dashboard/leads");
  });

  it("returns a buyer to where they came from", () => {
    expect(destinationFor(["buyer"], "/b/al-marwan-industrial-supplies-llc")).toBe(
      "/b/al-marwan-industrial-supplies-llc",
    );
  });

  it("sends a new supplier to the claim flow rather than the directory", () => {
    /*
       The gap `/list-your-business` opens. `adoptProfile` grants `buyer` and
       nothing else — `seller_owner` is scoped to a business and there is no
       business yet — so somebody who has just said they want to list would
       otherwise land on the home page with no hint that claiming a listing is
       the next thing.
    */
    expect(destinationFor(["buyer"], null, true)).toBe("/onboarding/claim");
  });

  it("still sends a supplier who already has a listing to their dashboard", () => {
    // Intent ranks below the role. Somebody with a business does not need the
    // claim flow, whatever they ticked at signup.
    expect(destinationFor(["seller_owner"], null, true)).toBe("/dashboard/leads");
  });

  it("puts staff ahead of a listing intent", () => {
    expect(destinationFor(["staff_ops_lead"], null, true)).toBe("/admin");
  });

  it("leaves a buyer with no listing intent on the directory", () => {
    expect(destinationFor(["buyer"], null, false)).toBe("/");
    expect(destinationFor(["buyer"], null)).toBe("/");
  });

  it("refuses a next that leaves the site", () => {
    // An open redirect with a fresh session attached is the worst kind.
    for (const hostile of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example",
      "http://evil.example",
    ]) {
      expect(isSafeNext(hostile), hostile).toBe(false);
      expect(destinationFor(["buyer"], hostile)).toBe("/");
      // And a listing intent does not turn a hostile next into a way out.
      expect(destinationFor(["buyer"], hostile, true)).toBe("/onboarding/claim");
    }
  });

  it("accepts an ordinary same-origin path", () => {
    expect(isSafeNext("/search?q=valve")).toBe(true);
  });
});

describe("a business_id claim is a cache, and caches go stale", () => {
  /*
     The bug this pins cost a whole CI run.

     `syncClaims` used to omit `business_id` when there was none, which meant a
     claim could be written once and never removed. `getActor` then trusted it,
     so a seller carried an id pointing at a business that no longer existed —
     and roughly a hundred and fifty call sites read that id to answer "is this
     mine?".

     It surfaced where an environment shares an auth project with a database it
     does not share: the claim was written against one database and read against
     another. It fails closed there, which is the lucky version. The unlucky one
     is an id that resolves to somebody else's business.
  */
  it("clears the claim when the record says there is no business", async () => {
    const admin = createAdminClient();
    const email = `bl.claim.${Date.now()}@example.com`;

    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    const userId = created.data.user?.id;
    expect(userId).toBeTruthy();
    if (!userId) return;

    try {
      await repairClaims(userId, ["seller_owner"], "cbogusbusinessid0000000000");
      const withClaim = await admin.auth.admin.getUserById(userId);
      expect(withClaim.data.user?.app_metadata?.business_id).toBe("cbogusbusinessid0000000000");

      // The record now says they belong to nothing. The claim has to be able to
      // say that too, or it outlives every correction.
      await repairClaims(userId, ["seller_owner"], null);
      const cleared = await admin.auth.admin.getUserById(userId);
      expect(cleared.data.user?.app_metadata?.business_id ?? null).toBeNull();
      expect(cleared.data.user?.app_metadata?.roles).toEqual(["seller_owner"]);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
