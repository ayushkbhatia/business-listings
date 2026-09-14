import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { verifyCode } from "@/lib/auth/flow";
import { signInWithPassword } from "@/lib/auth/password";
import {
  hashResetToken,
  issueResetGrant,
  newResetToken,
  readResetGrant,
  requestPasswordReset,
  RESET_LINK_MINUTES,
  setPasswordFromGrant,
} from "@/lib/auth/reset";

/**
 * Board 7a, reset — criteria 2 and 6, against real Supabase and Postgres.
 *
 *   2. Account recovery works from the mobile number alone.
 *   6. Reset links expire in one hour and are single-use.
 *
 * The grant is ours (see `PasswordReset` in the schema), so most of this needs
 * Postgres only. Saving a password and signing in with it needs Supabase, and
 * those cases skip without a service key.
 */
const SECRET = process.env["SUPABASE_SECRET_KEY"];
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const live = Boolean(SECRET && URL);

const RUN = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const NEW_PASSWORD = "dhow wharf at deira creek";
let seq = 0;

let admin: SupabaseClient;
const madeUsers: string[] = [];
const authUsers: string[] = [];
const identifiers: string[] = [];

beforeAll(() => {
  if (live) admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
});

afterEach(async () => {
  if (identifiers.length) await prisma.authAttempt.deleteMany({ where: { identifier: { in: identifiers } } });
});

afterAll(async () => {
  if (madeUsers.length) await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
  if (live) for (const id of authUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  await prisma.$disconnect();
});

function anon(): SupabaseClient {
  return createClient(URL!, process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** A profile row only — enough for everything that does not touch Supabase. */
async function profile(extra: { suspended?: boolean; provisional?: boolean; phone?: string } = {}) {
  const id = crypto.randomUUID();
  const email = `bl.integration.reset+${RUN}-${seq++}@gmail.com`;
  identifiers.push(email);
  madeUsers.push(id);
  await prisma.user.create({
    data: {
      id,
      email,
      ...(extra.phone ? { phone: extra.phone } : {}),
      roles: extra.provisional ? [] : ["buyer"],
      isProvisional: Boolean(extra.provisional),
      ...(extra.suspended ? { suspendedAt: new Date() } : {}),
    },
  });
  return { id, email };
}

/** A real account in both stores, with no password yet. */
async function account() {
  const email = `bl.integration.reset+${RUN}-${seq++}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("no user");
  authUsers.push(data.user.id);
  madeUsers.push(data.user.id);
  identifiers.push(email);
  await prisma.user.create({ data: { id: data.user.id, email, roles: ["buyer"] } });
  return { id: data.user.id, email };
}

describe("asking for a reset", () => {
  it("issues a grant for an hour and answers neutrally", async () => {
    const { id, email } = await profile();
    const before = Date.now();
    const outcome = await requestPasswordReset({ identifier: email });

    expect(outcome).toMatchObject({ ok: true, kind: "reset_sent" });
    const grant = await prisma.passwordReset.findFirstOrThrow({ where: { userId: id } });
    expect(grant.channel).toBe("email");
    expect(grant.usedAt).toBeNull();
    const lifetime = grant.expiresAt.getTime() - grant.createdAt.getTime();
    expect(lifetime).toBe(RESET_LINK_MINUTES * 60_000);
    expect(grant.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // Stored hashed: 64 hex characters, never the 43-character token.
    expect(grant.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says the same thing for an address with no account, and issues nothing", async () => {
    const nobody = `bl.integration.reset.nobody+${RUN}@gmail.com`;
    identifiers.push(nobody);
    const outcome = await requestPasswordReset({ identifier: nobody });
    expect(outcome).toEqual({ ok: true, kind: "reset_sent", masked: expect.stringContaining("@gmail.com") });
  });

  it("sends a suspended account nothing", async () => {
    const { id, email } = await profile({ suspended: true });
    expect(await requestPasswordReset({ identifier: email })).toMatchObject({ ok: true, kind: "reset_sent" });
    expect(await prisma.passwordReset.count({ where: { userId: id } })).toBe(0);
  });

  it("holds a fourth request in an hour", async () => {
    const { email } = await profile();
    for (let i = 0; i < 3; i += 1) {
      await prisma.authAttempt.create({
        data: { identifier: email, kind: "reset_request", succeeded: false, createdAt: new Date(Date.now() - (i + 1) * 60_000) },
      });
    }
    expect(await requestPasswordReset({ identifier: email })).toMatchObject({ ok: false, kind: "too_many_attempts" });
  });
});

describe("reading a grant", () => {
  it("reads a live grant without using it — a mail scanner spends nothing", async () => {
    const { id } = await profile();
    const token = await issueResetGrant({ userId: id, channel: "email", ip: null });
    expect(await readResetGrant(token)).toMatchObject({ userId: id, channel: "email" });
    expect(await readResetGrant(token)).toMatchObject({ userId: id });
    expect((await prisma.passwordReset.findFirstOrThrow({ where: { userId: id } })).usedAt).toBeNull();
  });

  it("refuses an expired grant, a malformed token and a token nobody issued", async () => {
    const { id } = await profile();
    const issuedAt = new Date(Date.now() - 61 * 60_000);
    const expired = await issueResetGrant({ userId: id, channel: "email", ip: null, now: issuedAt });
    expect(await readResetGrant(expired)).toBeNull();
    expect(await readResetGrant("not-a-token")).toBeNull();
    expect(await readResetGrant(newResetToken())).toBeNull();
    expect(await readResetGrant(undefined)).toBeNull();
  });

  it("cannot hold a grant longer than an hour, whatever the service says", async () => {
    const { id } = await profile();
    const now = new Date();
    await expect(
      prisma.passwordReset.create({
        data: {
          userId: id,
          channel: "email",
          tokenHash: hashResetToken(newResetToken()),
          createdAt: now,
          expiresAt: new Date(now.getTime() + 61 * 60_000),
        },
      }),
    ).rejects.toThrow(/password_reset_at_most_an_hour/);
  });
});

describe("saving a password against a grant", () => {
  it("refuses a weak password and leaves the link usable", async () => {
    const { id } = await profile();
    const token = await issueResetGrant({ userId: id, channel: "email", ip: null });
    const outcome = await setPasswordFromGrant({ token, password: "harbour" });
    expect(outcome).toEqual({ ok: false, kind: "password_rejected", problem: "too_short", length: 7 });
    expect(await readResetGrant(token)).not.toBeNull();
  });

  it("refuses a suspended account before anything is written (B7)", async () => {
    const { id } = await profile({ suspended: true });
    const token = await issueResetGrant({ userId: id, channel: "email", ip: null });
    expect(await setPasswordFromGrant({ token, password: NEW_PASSWORD })).toEqual({ ok: false, kind: "suspended" });
    expect(await readResetGrant(token)).not.toBeNull();
  });

  it("calls an expired link expired", async () => {
    const { id } = await profile();
    const token = await issueResetGrant({ userId: id, channel: "email", ip: null, now: new Date(Date.now() - 2 * 3_600_000) });
    expect(await setPasswordFromGrant({ token, password: NEW_PASSWORD })).toEqual({ ok: false, kind: "link_expired" });
  });

  it.skipIf(!live)("saves, signs in with the new password, and works once (criterion 6)", async () => {
    const { id, email } = await account();
    const token = await issueResetGrant({ userId: id, channel: "email", ip: null });

    const first = await setPasswordFromGrant({ token, password: NEW_PASSWORD }, { supabase: anon() });
    expect(first).toMatchObject({ ok: true, kind: "signed_in", userId: id });

    const row = await prisma.user.findUniqueOrThrow({ where: { id }, select: { passwordSetAt: true } });
    expect(row.passwordSetAt).not.toBeNull();
    expect((await prisma.passwordReset.findFirstOrThrow({ where: { userId: id } })).usedAt).not.toBeNull();

    const second = await setPasswordFromGrant({ token, password: "another quay at khalifa port" }, { supabase: anon() });
    expect(second).toEqual({ ok: false, kind: "link_expired" });

    // The password that stuck is the first one.
    expect(await signInWithPassword({ identifier: email, password: NEW_PASSWORD }, { supabase: anon() })).toMatchObject({
      ok: true,
    });
  });

  it.skipIf(!live)("lets exactly one of two tabs holding the same link set a password", async () => {
    const { id } = await account();
    const token = await issueResetGrant({ userId: id, channel: "email", ip: null });
    const results = await Promise.all([
      setPasswordFromGrant({ token, password: "first tab quay at mina zayed" }, { supabase: anon() }),
      setPasswordFromGrant({ token, password: "second tab quay at port rashid" }, { supabase: anon() }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.kind === "link_expired")).toHaveLength(1);
  });

  it.skipIf(!live)("mints a grant from a verified code, so recovery needs no link (criterion 2)", async () => {
    // A mobile's code travels the same `verifyCode` as an email's. The local and
    // CI Supabase have no SMS carrier, so the code is an email one — the thing
    // under test is that a code verified *for a reset* mints a grant rather than
    // landing, and that the grant carries the account.
    const { id, email } = await account();
    const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const outcome = await verifyCode(
      { identifier: email, code: data.properties!.email_otp, purpose: "reset" },
      { supabase: anon() },
    );
    expect(outcome).toMatchObject({ ok: true, kind: "reset_granted" });
    if (!outcome.ok || outcome.kind !== "reset_granted") throw new Error("unreachable");
    expect(await readResetGrant(outcome.token)).toMatchObject({ userId: id });
  });
});
