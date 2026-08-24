import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { destinationFor, fromSupabaseError, isSafeNext, verifyCode } from "@/lib/auth/flow";

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
const EMAIL = "bl.integration.buyer@gmail.com";

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

/** Clear any leftover from an interrupted run. */
async function removeExisting(email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of data?.users ?? []) {
    if (user.email === email) {
      await prisma.user.deleteMany({ where: { id: user.id } });
      await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    }
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
    }
  });

  it("accepts an ordinary same-origin path", () => {
    expect(isSafeNext("/search?q=valve")).toBe(true);
  });
});
