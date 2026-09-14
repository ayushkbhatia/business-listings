import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { checkThrottle } from "@/lib/auth/attempts";
import { landingFor } from "@/lib/auth/flow";
import { signInWithPassword } from "@/lib/auth/password";

/**
 * Board 7a — signing in with a password, against real Supabase and Postgres.
 *
 * `signInWithPassword` appeared nowhere in this repository before board 7a. The
 * three things most likely to be built wrong are the three this file pins:
 *
 *   1. assuming a password exists (`B3`) — an account with none gets the same
 *      answer as a wrong one, and nothing throws;
 *   2. letting a password lockout lock the account (`B5`) — the code path stays
 *      open while the password path is shut;
 *   3. a suspended account holding the session it just earned (`B7`).
 *
 * Skipped without a service key, like the code round trip beside it.
 */
const SECRET = process.env["SUPABASE_SECRET_KEY"];
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const live = Boolean(SECRET && URL);

const RUN = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const PASSWORD = "harbour crane at jebel ali";
let seq = 0;

let admin: SupabaseClient;
const madeUsers: string[] = [];
const madeClosures: string[] = [];
const identifiers: string[] = [];

beforeAll(() => {
  if (!live) return;
  admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
});

afterEach(async () => {
  if (identifiers.length) await prisma.authAttempt.deleteMany({ where: { identifier: { in: identifiers } } });
});

afterAll(async () => {
  if (live) {
    if (madeClosures.length) await prisma.businessClosure.deleteMany({ where: { id: { in: madeClosures } } });
    for (const id of madeUsers) {
      await prisma.user.deleteMany({ where: { id } });
      await admin.auth.admin.deleteUser(id).catch(() => undefined);
    }
  }
  await prisma.$disconnect();
});

function anon(): SupabaseClient {
  return createClient(URL!, process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** A real account: a Supabase user and the profile row sharing its id. */
async function account(options: { password?: string | null; phone?: string; suspended?: boolean } = {}) {
  const email = `bl.integration.pw+${RUN}-${seq++}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    ...(options.password === null ? {} : { password: options.password ?? PASSWORD }),
  });
  if (error || !data.user) throw error ?? new Error("no user");
  madeUsers.push(data.user.id);
  identifiers.push(email);
  if (options.phone) identifiers.push(options.phone);
  await prisma.user.create({
    data: {
      id: data.user.id,
      email,
      ...(options.phone ? { phone: options.phone } : {}),
      fullName: "Suresh Menon",
      roles: ["buyer"],
      ...(options.suspended ? { suspendedAt: new Date() } : {}),
    },
  });
  return { id: data.user.id, email };
}

describe.skipIf(!live)("signing in with a password", () => {
  it("signs in and lands in the buyer account", async () => {
    const { id, email } = await account();
    const outcome = await signInWithPassword({ identifier: email, password: PASSWORD }, { supabase: anon() });
    expect(outcome).toEqual({ ok: true, kind: "signed_in", userId: id, destination: "/account/enquiries" });
  });

  it("returns a buyer to where they were sent from", async () => {
    const { email } = await account();
    const outcome = await signInWithPassword(
      { identifier: email, password: PASSWORD, next: "/b/al-waha-industrial-supplies" },
      { supabase: anon() },
    );
    expect(outcome).toMatchObject({ ok: true, destination: "/b/al-waha-industrial-supplies" });
  });

  it("signs in by mobile an account whose Supabase identity is its email", async () => {
    // One account answers to both. Supabase's password grant takes one identity
    // and only one it holds, so the mobile is resolved through the profile.
    const phone = `+97150${String(Date.now()).slice(-7)}`;
    const { id } = await account({ phone });
    const outcome = await signInWithPassword({ identifier: phone, password: PASSWORD }, { supabase: anon() });
    expect(outcome).toMatchObject({ ok: true, kind: "signed_in", userId: id });
  });

  it("gives an account with no password the same answer as a wrong one (B3)", async () => {
    const withNone = await account({ password: null });
    const withOne = await account();

    const none = await signInWithPassword({ identifier: withNone.email, password: PASSWORD }, { supabase: anon() });
    const wrong = await signInWithPassword({ identifier: withOne.email, password: "not the password at all" }, { supabase: anon() });

    expect(none).toEqual({ ok: false, kind: "password_incorrect", attemptsLeft: 4 });
    expect(wrong).toEqual(none);
  });

  it("spends an attempt against an address with no account, so the lockout is no oracle", async () => {
    const nobody = `bl.integration.nobody+${RUN}@gmail.com`;
    identifiers.push(nobody);
    const outcome = await signInWithPassword({ identifier: nobody, password: PASSWORD }, { supabase: anon() });
    expect(outcome).toEqual({ ok: false, kind: "password_incorrect", attemptsLeft: 4 });
  });

  it("asks for a password it was not given, without spending an attempt", async () => {
    const { email } = await account();
    expect(await signInWithPassword({ identifier: email, password: "" }, { supabase: anon() })).toEqual({
      ok: false,
      kind: "password_required",
    });
    expect(await checkThrottle(email, "password_verify")).toEqual({ allowed: true });
  });

  it("locks the password after five, refuses the right one while locked, and leaves the code path open (B5)", async () => {
    const { email } = await account();
    const client = anon();
    const answers = [];
    for (let i = 0; i < 5; i += 1) {
      answers.push(await signInWithPassword({ identifier: email, password: `wrong-password-${i}-xx` }, { supabase: client }));
    }
    expect(answers.slice(0, 4).map((a) => ("attemptsLeft" in a ? a.attemptsLeft : null))).toEqual([4, 3, 2, 1]);
    expect(answers[4]).toMatchObject({ ok: false, kind: "password_locked" });

    const right = await signInWithPassword({ identifier: email, password: PASSWORD }, { supabase: client });
    expect(right).toMatchObject({ ok: false, kind: "password_locked" });
    if (right.ok || !("retryAfterSeconds" in right)) throw new Error("unreachable");
    expect(right.retryAfterSeconds).toBeGreaterThan(14 * 60);

    // The offer on the lockout screen, honoured.
    expect(await checkThrottle(email, "otp_request")).toEqual({ allowed: true });
    expect(await checkThrottle(email, "otp_verify")).toEqual({ allowed: true });
  });

  it("turns a suspended account back out with the right password, and says nothing of why (B7)", async () => {
    const { email } = await account({ suspended: true });
    const client = anon();
    const outcome = await signInWithPassword({ identifier: email, password: PASSWORD }, { supabase: client });
    expect(outcome).toEqual({ ok: false, kind: "suspended" });
    const { data } = await client.auth.getSession();
    expect(data.session).toBeNull();
  });
});

describe.skipIf(!live)("where a closing owner lands (Q2)", () => {
  it("offers the reversal to an owner whose closure is in its window", async () => {
    const owner = await account();
    const business = await prisma.business.findFirstOrThrow({
      where: { closures: { none: { reversedAt: null, finalisedAt: null } } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const now = Date.now();
    const closure = await prisma.businessClosure.create({
      data: {
        businessId: business.id,
        initiator: "owner",
        requestedById: owner.id,
        ownerId: owner.id,
        requestedAt: new Date(now),
        effectiveAt: new Date(now),
        appliedAt: new Date(now),
        finalAt: new Date(now + 14 * 86_400_000),
        tokenHash: `test-${randomUUID()}`,
      },
      select: { id: true },
    });
    madeClosures.push(closure.id);

    // Seat revoked by the closure: a buyer's roles, no business.
    expect(await landingFor(owner.id, ["buyer"], null)).toBe("/dashboard/account/close");
    // A dashboard `next` would 404 on a revoked seat; the reversal wins.
    expect(await landingFor(owner.id, ["buyer"], "/dashboard/leads")).toBe("/dashboard/account/close");
    // Anywhere else they asked to go, they go.
    expect(await landingFor(owner.id, ["buyer"], "/rfq/new")).toBe("/rfq/new");
  });

  it("leaves everybody else where they were going", async () => {
    const buyer = await account();
    expect(await landingFor(buyer.id, ["buyer"], null)).toBe("/account/enquiries");
  });
});
