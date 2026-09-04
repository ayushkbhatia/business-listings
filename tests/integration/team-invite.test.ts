import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { acceptInvite, expireInvites, readInvite, removeSeat } from "@/lib/team/invite";
import { inviteSeat } from "@/lib/team/service";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * The half of board 7d that did not exist.
 *
 * `inviteSeat` wrote a `TeamInvite` row with a token, and `acceptedAt` had no
 * writer anywhere in the codebase: no route, no service, no job. So a supplier
 * could invite somebody and that person could do nothing about it, which is
 * also why the setup hub's "invite somebody" task could not be completed
 * through the product.
 *
 * The assertions worth having here are the refusals. A path that seated
 * everybody who held a link would pass a test that only accepted a good one —
 * so the ceiling on roles, the address check and the one-seat conflict each get
 * their own case, and each checks the row afterwards rather than only the
 * returned value.
 */

const PREFIX = "team-invite-test-";
const EMAIL_DOMAIN = "@team-invite.test";

let categoryId: string;
let alphaId: string;
let alphaName: string;
let betaId: string;
let ownerId: string;
let ownerActor: Actor;
let seq = 0;

/** No stored RESEND key when this suite runs — see beforeAll. */
let savedResendKey: string | undefined;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

function emailFor(label: string) {
  return `${PREFIX}${label}-${stamp()}${EMAIL_DOMAIN}`;
}

async function addBusiness(name: string) {
  const id = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `${name} Trading LLC`,
      displayName: name,
      slug: `${PREFIX}${id}`,
      licenceNumber: `DED-TI${id.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date("2030-01-01T00:00:00.000Z"),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  return business.id;
}

async function addUser(fields: { roles: Role[]; businessId?: string | null; email?: string }) {
  const email = fields.email ?? emailFor("person");
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email,
      fullName: `Invite Test ${stamp()}`,
      roles: fields.roles,
      businessId: fields.businessId ?? null,
    },
    select: { id: true, email: true },
  });
  return { id: user.id, email: user.email as string };
}

async function addInvite(fields: {
  businessId: string;
  email: string;
  roles: Role[];
  expiresAt?: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
}) {
  const token = `${PREFIX}${stamp()}`;
  await prisma.teamInvite.create({
    data: {
      businessId: fields.businessId,
      email: fields.email,
      roles: fields.roles,
      invitedById: ownerId,
      token,
      expiresAt: fields.expiresAt ?? new Date(Date.now() + 7 * 86_400_000),
      acceptedAt: fields.acceptedAt ?? null,
      revokedAt: fields.revokedAt ?? null,
    },
  });
  return token;
}

function actorFor(id: string, roles: Role[], businessId?: string): Actor {
  return { id, roles, ...(businessId ? { businessId } : {}) };
}

async function removeFixtures() {
  await prisma.message.deleteMany({ where: { body: { startsWith: PREFIX } } });
  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: PREFIX } } });
  await prisma.teamInvite.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  /*
     No mail carrier for the duration.

     `inviteSeat` now sends the invitation as part of creating it, and
     `resolveNotificationSenders` picks the real Resend sender whenever a key is
     configured — which it is, in the `.env.local` these tests load. A suite that
     puts mail in somebody's inbox every time it runs is a suite people stop
     running. Without the key the console sender takes the channel, which is the
     same code path minus the HTTP call.
  */
  savedResendKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  await removeFixtures();

  const category = await prisma.category.create({
    data: { slug: `${PREFIX}valves`, code: "TINV", name: "Invite test trade" },
  });
  categoryId = category.id;

  alphaName = "Invite Test Alpha";
  alphaId = await addBusiness(alphaName);
  betaId = await addBusiness("Invite Test Beta");

  const owner = await addUser({ roles: ["seller_owner"], businessId: alphaId });
  ownerId = owner.id;
  ownerActor = actorFor(ownerId, ["seller_owner"], alphaId);
});

afterAll(async () => {
  await removeFixtures();
  if (savedResendKey !== undefined) process.env.RESEND_API_KEY = savedResendKey;
});

describe("accepting a seat", () => {
  it("grants exactly the roles the invitation offered, on top of the ones they had", async () => {
    const invitee = await addUser({ roles: ["buyer"] });
    const token = await addInvite({
      businessId: alphaId,
      email: invitee.email,
      roles: ["seller_sales"],
    });

    const result = await acceptInvite(token, actorFor(invitee.id, ["buyer"]));
    if (!result.ok) throw new Error(`expected the seat to be granted, got ${result.reason}`);
    expect(result.businessId).toBe(alphaId);

    const seated = await prisma.user.findUniqueOrThrow({
      where: { id: invitee.id },
      select: { businessId: true, roles: true },
    });
    expect(seated.businessId).toBe(alphaId);
    // Their buyer role survives — somebody who answers enquiries for a supplier
    // is often also sending them — and nothing else was added.
    expect([...seated.roles].sort()).toEqual(["buyer", "seller_sales"]);

    const invite = await prisma.teamInvite.findUniqueOrThrow({
      where: { token },
      select: { acceptedAt: true },
    });
    expect(invite.acceptedAt).not.toBeNull();
  });

  it("treats the roles on the invitation as a ceiling, not a suggestion", async () => {
    const invitee = await addUser({ roles: ["buyer"] });
    /*
       A row that offers ownership. `inviteSeat` filters `seller_owner` out at
       creation, so this is what an older row — or any future path that writes
       one — could look like. The ceiling has to be applied where the row is
       redeemed, or a stored array decides who owns a listing.
    */
    const token = await addInvite({
      businessId: alphaId,
      email: invitee.email,
      roles: ["seller_owner", "seller_sales"],
    });

    expect(await readInvite(token)).toMatchObject({ state: "ok", roles: ["seller_sales"] });

    const result = await acceptInvite(token, actorFor(invitee.id, ["buyer"]));
    if (!result.ok) throw new Error(`expected the seat to be granted, got ${result.reason}`);

    const seated = await prisma.user.findUniqueOrThrow({
      where: { id: invitee.id },
      select: { roles: true },
    });
    expect(seated.roles).not.toContain("seller_owner");
    expect([...seated.roles].sort()).toEqual(["buyer", "seller_sales"]);
  });

  it("refuses somebody who already holds a seat on another business", async () => {
    const seated = await addUser({ roles: ["buyer", "seller_sales"], businessId: alphaId });
    const token = await addInvite({
      businessId: betaId,
      email: seated.email,
      roles: ["seller_sales"],
    });

    const result = await acceptInvite(token, actorFor(seated.id, ["seller_sales"], alphaId));
    expect(result).toMatchObject({ ok: false, reason: "other_business", otherBusinessName: alphaName });

    // The refusal is the point: a silent move would take their access to
    // Alpha's enquiries with them and tell neither supplier.
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: seated.id },
      select: { businessId: true },
    });
    expect(after.businessId).toBe(alphaId);
    expect(await prisma.teamInvite.findUniqueOrThrow({ where: { token }, select: { acceptedAt: true } }))
      .toMatchObject({ acceptedAt: null });
  });

  it("refuses an address the invitation was not sent to", async () => {
    const stranger = await addUser({ roles: ["buyer"] });
    const token = await addInvite({
      businessId: alphaId,
      email: emailFor("intended"),
      roles: ["seller_sales"],
    });

    const result = await acceptInvite(token, actorFor(stranger.id, ["buyer"]));
    expect(result).toMatchObject({ ok: false, reason: "wrong_account" });

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: stranger.id },
      select: { businessId: true, roles: true },
    });
    expect(after.businessId).toBeNull();
    expect(after.roles).toEqual(["buyer"]);
  });

  it("refuses a token that has expired", async () => {
    const invitee = await addUser({ roles: ["buyer"] });
    const token = await addInvite({
      businessId: alphaId,
      email: invitee.email,
      roles: ["seller_sales"],
      expiresAt: new Date(Date.now() - 86_400_000),
    });

    expect(await readInvite(token)).toMatchObject({ state: "expired", businessName: alphaName });

    const result = await acceptInvite(token, actorFor(invitee.id, ["buyer"]));
    expect(result).toMatchObject({ ok: false, reason: "expired" });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: invitee.id }, select: { businessId: true } }),
    ).toMatchObject({ businessId: null });
  });

  it("refuses a token that has already been used", async () => {
    const invitee = await addUser({ roles: ["buyer"] });
    const token = await addInvite({
      businessId: alphaId,
      email: invitee.email,
      roles: ["seller_sales"],
      acceptedAt: new Date(),
    });

    expect(await readInvite(token)).toEqual({ state: "already_used" });

    const result = await acceptInvite(token, actorFor(invitee.id, ["buyer"]));
    expect(result).toMatchObject({ ok: false, reason: "already_used" });
  });

  it("tells a token that is not ours nothing at all", async () => {
    expect(await readInvite("not-a-token-we-issued")).toEqual({ state: "not_found" });
    expect(await readInvite("")).toEqual({ state: "not_found" });
  });
});

describe("the link the owner can send themselves", () => {
  it("comes back from inviteSeat with the token already built into a URL", async () => {
    const email = emailFor("linked");
    const result = await inviteSeat(ownerActor, alphaId, { email, roles: ["seller_sales"] }, null);
    if (!result.ok) throw new Error(`expected the invitation to be created: ${result.error}`);

    expect(result.acceptUrl.endsWith(`/invite/${result.token}`)).toBe(true);
    expect(await readInvite(result.token)).toMatchObject({
      state: "ok",
      businessName: alphaName,
      email,
      roles: ["seller_sales"],
    });
  });
});

describe("sweeping invitations that ran out", () => {
  /*
     Dated far enough back that only these fixtures qualify.

     `expireInvites` has no business filter — it cannot have one, it is a nightly
     sweep — so a `now` of today would revoke seeded and sibling-suite rows on the
     shared local database. A cut-off in 2020 catches exactly the two rows below.
  */
  const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
  const CUTOFF = new Date("2020-06-01T00:00:00.000Z");

  it("revokes a lapsed offer so it stops occupying a seat, and leaves an accepted one alone", async () => {
    const lapsed = await addInvite({
      businessId: alphaId,
      email: emailFor("lapsed"),
      roles: ["seller_sales"],
      expiresAt: LONG_AGO,
    });
    const taken = await addInvite({
      businessId: alphaId,
      email: emailFor("taken"),
      roles: ["seller_sales"],
      expiresAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    });

    expect(await expireInvites(CUTOFF)).toBeGreaterThanOrEqual(1);

    const swept = await prisma.teamInvite.findUniqueOrThrow({
      where: { token: lapsed },
      select: { revokedAt: true },
    });
    expect(swept.revokedAt).toEqual(CUTOFF);

    // `acceptedAt` is the record that somebody took the seat. It has to survive
    // the offer lapsing, or the seat has no provenance.
    expect(
      await prisma.teamInvite.findUniqueOrThrow({ where: { token: taken }, select: { revokedAt: true } }),
    ).toMatchObject({ revokedAt: null });

    // Idempotent: a second run finds nothing to change and does not move the
    // withdrawal date of a row it already swept.
    await expireInvites(new Date("2020-07-01T00:00:00.000Z"));
    expect(
      await prisma.teamInvite.findUniqueOrThrow({ where: { token: lapsed }, select: { revokedAt: true } }),
    ).toMatchObject({ revokedAt: CUTOFF });
  });

  it("still reads as expired rather than withdrawn after the sweep", async () => {
    const token = await addInvite({
      businessId: alphaId,
      email: emailFor("lapsed-read"),
      roles: ["seller_sales"],
      expiresAt: LONG_AGO,
    });
    await expireInvites(CUTOFF);

    // The sweep sets `revokedAt`, and "withdrawn" means a person changed their
    // mind about you. A date passing is not that.
    expect(await readInvite(token)).toMatchObject({ state: "expired" });
  });
});

describe("taking a seat back", () => {
  it("clears the seat and leaves every message they sent on its thread", async () => {
    const leaver = await addUser({ roles: ["buyer", "seller_sales"], businessId: alphaId });
    const buyer = await addUser({ roles: ["buyer"] });

    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `${PREFIX}${stamp()}`,
        buyerId: buyer.id,
        requirement: "Resilient seated gate valves, flanged PN16.",
        closesAt: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { id: true },
    });
    const message = await prisma.message.create({
      data: {
        enquiryId: enquiry.id,
        businessId: alphaId,
        senderId: leaver.id,
        body: `${PREFIX} Twelve in stock, the rest is made to order.`,
      },
      select: { id: true },
    });

    const result = await removeSeat(ownerActor, leaver.id);
    expect(result.ok).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: leaver.id },
      select: { businessId: true, roles: true },
    });
    expect(after.businessId).toBeNull();
    // Seller roles go; everything else stays. A leftover seller role with no
    // business behind it is a capability scoped to nothing.
    expect(after.roles).toEqual(["buyer"]);

    /*
       The reason the row is never deleted. `Message.sender` is
       `onDelete: Cascade`, so removing the person would take their half of every
       negotiation thread with them — the buyer would open the conversation and
       find only their own messages.
    */
    const kept = await prisma.message.findUniqueOrThrow({
      where: { id: message.id },
      select: { senderId: true, businessId: true },
    });
    expect(kept).toEqual({ senderId: leaver.id, businessId: alphaId });
  });

  it("refuses the owner's seat and refuses your own", async () => {
    const coOwner = await addUser({ roles: ["seller_owner"], businessId: alphaId });

    expect(await removeSeat(ownerActor, coOwner.id)).toMatchObject({ ok: false });
    expect(await removeSeat(ownerActor, ownerId)).toMatchObject({ ok: false });

    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: coOwner.id }, select: { businessId: true } }),
    ).toMatchObject({ businessId: alphaId });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { businessId: true } }),
    ).toMatchObject({ businessId: alphaId });
  });

  it("refuses somebody on another team, and a seat that cannot manage the team at all", async () => {
    const theirs = await addUser({ roles: ["seller_sales"], businessId: betaId });

    // Their business is not the actor's, so the fence is ownership rather than role.
    expect(await removeSeat(ownerActor, theirs.id)).toMatchObject({ ok: false });

    const sales = await addUser({ roles: ["seller_sales"], businessId: alphaId });
    await expect(
      removeSeat(actorFor(sales.id, ["seller_sales"], alphaId), theirs.id),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});
