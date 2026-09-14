import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { startSignUp, verifyCode } from "@/lib/auth/flow";
import { currentLegalVersions } from "@/lib/legal/documents";

/**
 * Board 7a, state two — one account, two roles — against real Supabase.
 *
 *   1. One account supports both roles; adding the second requires no new account.
 *   9. Terms acceptance stores the version and timestamp.
 *
 * The delivery leg is substituted the way the code round trip beside this file
 * substitutes it: `generate_link` returns the code Supabase made and sends
 * nothing, carrying exactly the metadata `startSignUp` writes. Everything after
 * it — `verifyOtp`, the profile row, the other identifier, the acceptance
 * record — is the production path. Sending real codes here would spend the
 * local project's two emails an hour on a test.
 */
const SECRET = process.env["SUPABASE_SECRET_KEY"];
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const live = Boolean(SECRET && URL);

const RUN = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
let admin: SupabaseClient;
const authUsers: string[] = [];
const profiles: string[] = [];

beforeAll(() => {
  if (live) admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
});

afterAll(async () => {
  if (profiles.length) {
    await prisma.termsAcceptance.deleteMany({ where: { userId: { in: profiles } } });
    await prisma.user.deleteMany({ where: { id: { in: profiles } } });
  }
  if (live) for (const id of authUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  await prisma.$disconnect();
});

function anon(): SupabaseClient {
  return createClient(URL!, process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const valid = {
  fullName: "Suresh Menon",
  phone: "050 641 2288",
  email: "suresh@alwaha.ae",
  intent: "buying" as const,
  termsAccepted: true,
};

describe("refusing a sign-up before anything is sent", () => {
  it("names the field that is wrong", async () => {
    expect(await startSignUp({ ...valid, fullName: "  " })).toEqual({ ok: false, kind: "name_required" });
    expect(await startSignUp({ ...valid, phone: "12345" })).toEqual({ ok: false, kind: "invalid_phone" });
    expect(await startSignUp({ ...valid, phone: "suresh@alwaha.ae" })).toEqual({ ok: false, kind: "invalid_phone" });
    expect(await startSignUp({ ...valid, email: "suresh@" })).toEqual({ ok: false, kind: "invalid_email" });
  });

  it("will not create an account without the terms accepted", async () => {
    expect(await startSignUp({ ...valid, termsAccepted: false })).toEqual({ ok: false, kind: "terms_required" });
  });

  it("sends somebody whose email is on another account to sign in there, rather than forking them (B1)", async () => {
    const id = crypto.randomUUID();
    profiles.push(id);
    const email = `bl.integration.taken+${RUN}@gmail.com`;
    await prisma.user.create({ data: { id, email, roles: ["buyer", "seller_owner"] } });
    expect(await startSignUp({ ...valid, phone: "+971509990001", email })).toEqual({ ok: false, kind: "email_taken" });
  });

  it("stops one address asking which emails have accounts", async () => {
    const id = crypto.randomUUID();
    profiles.push(id);
    const email = `bl.integration.probe+${RUN}@gmail.com`;
    const ip = "198.51.100.23";
    await prisma.user.create({ data: { id, email, roles: ["buyer"] } });
    try {
      for (let i = 0; i < 20; i += 1) {
        expect(await startSignUp({ ...valid, phone: `+97150999${String(1000 + i)}`, email, ip })).toMatchObject({ kind: "email_taken" });
      }
      expect(await startSignUp({ ...valid, phone: "+971509992000", email, ip })).toMatchObject({ kind: "too_many_attempts" });
      // Counted against the address, never the account it names.
      expect(await prisma.authAttempt.count({ where: { identifier: email } })).toBe(0);
    } finally {
      await prisma.authAttempt.deleteMany({ where: { ip } });
    }
  });
});

describe.skipIf(!live)("the first verification of a sign-up", () => {
  it("records the terms versions and when the box was ticked, and keeps the other identifier (criterion 9)", async () => {
    const email = `bl.integration.signup+${RUN}@gmail.com`;
    const phone = `+97155${String(Date.now()).slice(-7)}`;
    const tickedAt = new Date(Date.now() - 90_000);
    const versions = currentLegalVersions(tickedAt);

    const { data, error } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password: `${crypto.randomUUID()}Aa1!`,
      options: {
        data: {
          full_name: "Suresh Menon",
          wants_to_list: true,
          signup_phone: phone,
          signup_email: email,
          terms_version: versions.terms,
          privacy_version: versions.privacy,
          terms_accepted_at: tickedAt.toISOString(),
        },
      },
    });
    if (error || !data.user) throw error ?? new Error("no link");
    authUsers.push(data.user.id);
    profiles.push(data.user.id);

    const outcome = await verifyCode({ identifier: email, code: data.properties.email_otp }, { supabase: anon() });
    // Listing intent lands on the claim flow; the account is still one account.
    expect(outcome).toMatchObject({ ok: true, kind: "signed_in", destination: "/onboarding/claim" });

    const profile = await prisma.user.findUniqueOrThrow({
      where: { id: data.user.id },
      select: { roles: true, wantsToList: true, phone: true, email: true, passwordSetAt: true },
    });
    expect(profile).toEqual({ roles: ["buyer"], wantsToList: true, phone, email, passwordSetAt: null });

    const acceptances = await prisma.termsAcceptance.findMany({ where: { userId: data.user.id } });
    expect(acceptances).toHaveLength(1);
    expect(acceptances[0]).toMatchObject({
      termsVersion: versions.terms,
      privacyVersion: versions.privacy,
      source: "signup",
    });
    // The moment the form was sent, not the moment the code was typed.
    expect(acceptances[0]!.acceptedAt.getTime()).toBe(tickedAt.getTime());

    // The mobile is attached to the Supabase user too, so it works as a sign-in
    // identity later rather than existing only on our row.
    const { data: authUser } = await admin.auth.admin.getUserById(data.user.id);
    expect(authUser.user?.phone).toBe(phone.replace(/^\+/, ""));

    // Signing in again records nothing new — acceptance is a sign-up act.
    const { data: again } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    await verifyCode({ identifier: email, code: again.properties!.email_otp }, { supabase: anon() });
    expect(await prisma.termsAcceptance.count({ where: { userId: data.user.id } })).toBe(1);
  });
});
