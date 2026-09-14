import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor, Role } from "@/lib/auth/roles";
import { PermissionError } from "@/lib/auth/errors";
import { getBusinessBySlug } from "@/lib/db/queries";
import { closedListing } from "@/lib/closure/public";
import { closureBlockers } from "@/lib/closure/blockers";
import { purgeRetainedDocuments } from "@/lib/closure/retention";
import { newReversalToken } from "@/lib/closure/policy";
import {
  giveLicenceLapseNotice,
  openClosureOwnedBy,
  reopenClosedBusiness,
  requestClosure,
  reverseAsOwner,
  reverseByToken,
  sweepClosures,
  withdrawClosure,
} from "@/lib/closure/service";
import { findClaimMatches, submitClaim } from "@/lib/onboarding/claim";
import { goLive } from "@/lib/onboarding/service";
import { postMessage } from "@/lib/messaging/service";
import { acceptQuote } from "@/lib/enquiry/service";

/**
 * Board 11i, against a real database — acceptance criteria 1–9.
 *
 * Create-and-destroy fixtures throughout. A closure revokes every seat on a
 * business and ends their sessions, so borrowing a seeded seller would sign out
 * the acceptance suite's own Pro seat — the "fixture reaching into shared data"
 * failure this repo has recorded four times.
 */

const DAY = 86_400_000;
const PREFIX = `close11i-${process.pid}-`;
let seq = 0;

const madeBusinesses: string[] = [];
const madeUsers: string[] = [];

let categoryId = "";
let areaId = "";

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({
    where: { parentId: null },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  categoryId = category.id;
  const area = await prisma.area.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } });
  areaId = area.id;
});

afterAll(async () => {
  if (madeBusinesses.length > 0) {
    await prisma.businessClosure.deleteMany({ where: { businessId: { in: madeBusinesses } } });
  }
  if (madeUsers.length > 0) {
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: madeUsers } } });
    await prisma.businessClosure.deleteMany({ where: { requestedById: { in: madeUsers } } });
  }
  if (madeBusinesses.length > 0) {
    await prisma.enquiry.deleteMany({ where: { recipients: { some: { businessId: { in: madeBusinesses } } } } });
    await prisma.business.deleteMany({ where: { id: { in: madeBusinesses } } });
  }
  if (madeUsers.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
  }
});

async function makeUser(roles: Role[], extra: { businessId?: string; email?: string } = {}) {
  const user = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      fullName: `Closure Fixture ${seq}`,
      email: extra.email ?? `${PREFIX}${seq++}@example.test`,
      roles,
      ...(extra.businessId ? { businessId: extra.businessId } : {}),
    },
    select: { id: true, roles: true, businessId: true },
  });
  madeUsers.push(user.id);
  return user;
}

function actorOf(user: { id: string; roles: string[]; businessId: string | null }): Actor {
  return { id: user.id, roles: user.roles as Role[], ...(user.businessId ? { businessId: user.businessId } : {}) };
}

/** A published, claimed business with an owner and a manager, on Free. */
async function makeBusiness(options: { plan?: "free" | "pro"; licenceExpiry?: Date } = {}) {
  const slug = `${PREFIX}${seq++}`;
  const publishedAt = new Date(Date.now() - 40 * DAY);
  const business = await prisma.business.create({
    data: {
      tradeName: `Closure Fixture ${slug} LLC`,
      displayName: `Closure Fixture ${slug}`,
      slug,
      licenceNumber: `CLS-${slug}`,
      licenceAuthority: "DED",
      licenceExpiry: options.licenceExpiry ?? new Date(Date.now() + 300 * DAY),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId: options.plan ?? "free",
      publishedAt,
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Unit 1, Street 1",
          published: true,
        },
      },
    },
    select: { id: true, slug: true, publishedAt: true },
  });
  madeBusinesses.push(business.id);

  const owner = await makeUser(["seller_owner"], { businessId: business.id });
  const manager = await makeUser(["seller_manager", "buyer"], { businessId: business.id });

  if (options.plan === "pro") {
    await prisma.subscription.create({
      data: {
        businessId: business.id,
        planId: "pro",
        status: "active",
        renewsAt: new Date(Date.now() + 20 * DAY),
      },
    });
  }

  return { business, owner, manager };
}

describe("criterion 1 — blocked at request time, on the server", () => {
  it("refuses while a paid subscription is still charging", async () => {
    const { business, owner } = await makeBusiness({ plan: "pro" });

    const result = await requestClosure(actorOf(owner));

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "blocked") throw new Error("expected blocked");
    expect(result.blockers.subscription?.planName).toBe("Pro");
    // Nothing moved.
    const row = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(row.publishedAt).toEqual(business.publishedAt);
    expect(row.closureRequestedAt).toBeNull();
  });

  it("clears once the cancellation is scheduled, because nothing more will be charged", async () => {
    const { business } = await makeBusiness({ plan: "pro" });
    await prisma.subscription.update({
      where: { businessId: business.id },
      data: { cancelledAt: new Date(), endsAt: new Date(Date.now() + 20 * DAY) },
    });
    expect((await closureBlockers(business.id)).subscription).toBeNull();
  });

  it("refuses while an enquiry is open or a quote is waiting on a buyer", async () => {
    const { business, owner } = await makeBusiness();
    const buyer = await makeUser(["buyer"]);
    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `${PREFIX}enq${seq++}`,
        buyerId: buyer.id,
        requirement: "Butterfly valves, DN200.",
        closesAt: new Date(Date.now() + 7 * DAY),
        recipients: { create: { businessId: business.id, state: "delivered" } },
      },
      select: { id: true },
    });

    const open = await requestClosure(actorOf(owner));
    expect(open.ok).toBe(false);
    if (open.ok || open.error !== "blocked") throw new Error("expected blocked");
    expect(open.blockers.enquiries?.openEnquiries).toBe(1);

    // Quoted: the enquiry leaves the Open tab and becomes a quote a buyer has
    // not answered — still a blocker, now of the other kind.
    await prisma.quote.create({
      data: {
        ref: `${PREFIX}q${seq++}`,
        enquiryId: enquiry.id,
        businessId: business.id,
        status: "sent",
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * DAY),
      },
    });
    await prisma.enquiryRecipient.update({
      where: { enquiryId_businessId: { enquiryId: enquiry.id, businessId: business.id } },
      data: { state: "quoted" },
    });

    const quoted = await closureBlockers(business.id);
    expect(quoted.enquiries?.openEnquiries).toBe(0);
    expect(quoted.enquiries?.awaitingQuotes).toBe(1);
    // Masked exactly as board 3k masks it: never the buyer's company.
    expect(quoted.enquiries?.firstQuote?.buyer.released).toBe(false);
  });

  it("is the owner's alone — Q4", async () => {
    const { manager } = await makeBusiness();
    await expect(requestClosure(actorOf(manager))).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("criteria 2, 6 and 7 — what a request does", () => {
  it("takes the listing down now, revokes every seat, and keeps the slug on the row", async () => {
    const { business, owner, manager } = await makeBusiness();
    await prisma.customDomain.create({
      data: {
        businessId: business.id,
        hostname: `${business.slug.replace(/[^a-z0-9]/g, "")}.businesslistings.me`,
        token: "",
        status: "verified",
        verifiedAt: new Date(),
      },
    });
    await prisma.teamInvite.create({
      data: {
        businessId: business.id,
        email: `${PREFIX}invite@example.test`,
        roles: ["seller_sales"],
        invitedById: owner.id,
        token: `${PREFIX}tok${seq++}`,
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });

    const result = await requestClosure(actorOf(owner));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seatsRevoked).toBe(2);

    const row = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    // B2 — out of every public read.
    expect(row.publishedAt).toBeNull();
    expect(row.closureRequestedAt).not.toBeNull();
    expect(await getBusinessBySlug(business.slug)).toBeNull();
    // Q5 — and the notice, not a 404.
    expect((await closedListing(business.slug))?.id).toBe(business.id);

    // B7 — both seats, owner included, with non-seller roles kept.
    const people = await prisma.user.findMany({
      where: { id: { in: [owner.id, manager.id] } },
      select: { id: true, businessId: true, roles: true },
    });
    for (const person of people) {
      expect(person.businessId).toBeNull();
      expect(person.roles.some((role) => role.startsWith("seller_"))).toBe(false);
    }
    expect(people.find((person) => person.id === manager.id)?.roles).toEqual(["buyer"]);

    // B10 — the address released; the invite revoked.
    expect(await prisma.customDomain.findUnique({ where: { businessId: business.id } })).toBeNull();
    expect(await prisma.teamInvite.count({ where: { businessId: business.id, revokedAt: null } })).toBe(0);

    // Criterion 6 — the slug stays on this row, so no other business can have it.
    await expect(
      prisma.business.create({
        data: {
          tradeName: "Squatter LLC",
          displayName: "Squatter",
          slug: business.slug,
          licenceNumber: `SQ-${seq++}`,
          licenceAuthority: "DED",
          licenceExpiry: new Date(Date.now() + 300 * DAY),
          primaryCategoryId: categoryId,
        },
      }),
    ).rejects.toThrow();

    // A second request finds the one already open.
    expect(await requestClosure({ ...actorOf(owner), businessId: business.id })).toMatchObject({
      ok: false,
      error: "already_closing",
    });
  });

  it("refuses a row that is both closing and published, by constraint", async () => {
    const { business, owner } = await makeBusiness();
    await requestClosure(actorOf(owner));
    await expect(
      prisma.business.update({ where: { id: business.id }, data: { publishedAt: new Date() } }),
    ).rejects.toThrow(/business_closure_unpublishes/);
  });

  it("refuses go-live, so nothing but a reversal puts it back up", async () => {
    const { business, owner } = await makeBusiness();
    await requestClosure(actorOf(owner));
    const result = await goLive(business.id);
    expect(result.ok).toBe(false);
  });
});

describe("criterion 3 — reversible for the window, from the email or the dashboard", () => {
  it("restores the listing exactly as it was, by the link", async () => {
    const { business, owner, manager } = await makeBusiness();
    await requestClosure(actorOf(owner));

    /*
       The token exists only in the email, and the database holds its hash. To
       reach the link path without a mail carrier, the test mints its own token
       and puts that hash on the row — the service code under test is unchanged.
    */
    const { token, hash } = newReversalToken();
    await prisma.businessClosure.updateMany({
      where: { businessId: business.id, reversedAt: null },
      data: { tokenHash: hash },
    });

    const result = await reverseByToken(token);
    expect(result).toMatchObject({ ok: true, slug: business.slug, seatsRestored: 2, seatsSkipped: 0 });

    const row = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    // The original go-live date, not a new one.
    expect(row.publishedAt).toEqual(business.publishedAt);
    expect(row.closureRequestedAt).toBeNull();
    const restored = await prisma.user.findMany({
      where: { id: { in: [owner.id, manager.id] } },
      select: { id: true, businessId: true, roles: true },
    });
    expect(restored.every((person) => person.businessId === business.id)).toBe(true);
    expect(restored.find((person) => person.id === manager.id)?.roles.sort()).toEqual(
      ["buyer", "seller_manager"].sort(),
    );

    const closure = await prisma.businessClosure.findFirstOrThrow({ where: { businessId: business.id } });
    expect(closure.reversedVia).toBe("email");
    // Spent.
    expect(await reverseByToken(token)).toMatchObject({ ok: false, error: "already_reversed" });
  });

  it("does not put back a seat whose person joined another business meanwhile", async () => {
    const { business, owner, manager } = await makeBusiness();
    await requestClosure(actorOf(owner));
    const elsewhere = await makeBusiness();
    await prisma.user.update({ where: { id: manager.id }, data: { businessId: elsewhere.business.id } });

    const result = await reverseAsOwner({ id: owner.id, roles: [] });
    expect(result).toMatchObject({ ok: true, seatsRestored: 1, seatsSkipped: 1 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: manager.id } })).businessId).toBe(
      elsewhere.business.id,
    );
    void business;
  });

  it("offers the owner the reversal screen when they sign in with no seat", async () => {
    const { owner } = await makeBusiness();
    await requestClosure(actorOf(owner));
    expect(await openClosureOwnedBy(owner.id)).not.toBeNull();
  });

  it("refuses a mangled link and a window that has passed", async () => {
    expect(await reverseByToken("not-a-token")).toMatchObject({ ok: false, error: "invalid" });

    const { business, owner } = await makeBusiness();
    const requestedAt = new Date(Date.now() - 20 * DAY);
    await requestClosure(actorOf(owner), requestedAt);
    const { token, hash } = newReversalToken();
    await prisma.businessClosure.updateMany({ where: { businessId: business.id }, data: { tokenHash: hash } });

    expect(await reverseByToken(token)).toMatchObject({ ok: false, error: "expired" });
  });
});

describe("the nightly sweep — final, and criterion 5's clock", () => {
  it("finalises a closure whose window has passed, and deletes documents twelve months later", async () => {
    const { business, owner } = await makeBusiness();
    await requestClosure(actorOf(owner), new Date(Date.now() - 20 * DAY));

    const swept = await sweepClosures();
    expect(swept.finalised).toBeGreaterThanOrEqual(1);
    const row = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(row.closedAt).not.toBeNull();
    expect(row.slug).toBe(business.slug);

    // A licence document, and a quote attachment that must survive the purge.
    const licence = await prisma.document.create({
      data: {
        kind: "trade_licence",
        storagePath: `${PREFIX}licence-${seq++}.pdf`,
        filename: "licence.pdf",
        businessId: business.id,
      },
    });

    // Twelve months ago is not yet thirteen: nothing is deleted early.
    expect((await purgeRetainedDocuments()).documents).toBe(0);
    expect(await prisma.document.findUnique({ where: { id: licence.id } })).not.toBeNull();

    await prisma.businessClosure.updateMany({
      where: { businessId: business.id },
      data: { finalisedAt: new Date(Date.now() - 400 * DAY) },
    });
    const purged = await purgeRetainedDocuments();
    if (purged.storageFailures === 0) {
      expect(await prisma.document.findUnique({ where: { id: licence.id } })).toBeNull();
      const closure = await prisma.businessClosure.findFirstOrThrow({ where: { businessId: business.id } });
      expect(closure.documentsPurgedAt).not.toBeNull();
    } else {
      // No storage API reachable from this runner. The row is kept so the next
      // run retries — which is the behaviour, stated rather than skipped.
      expect(await prisma.document.findUnique({ where: { id: licence.id } })).not.toBeNull();
    }
  });
});

describe("criterion 4 — retained, with buyer access intact", () => {
  it("keeps the enquiry and refuses messages and acceptances into it", async () => {
    const { business, owner } = await makeBusiness();
    const buyer = await makeUser(["buyer"]);
    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `${PREFIX}enq${seq++}`,
        buyerId: buyer.id,
        requirement: "Pressure gauges.",
        closesAt: new Date(Date.now() + 7 * DAY),
        recipients: { create: { businessId: business.id, state: "declined" } },
      },
      select: { id: true },
    });
    const quote = await prisma.quote.create({
      data: {
        ref: `${PREFIX}q${seq++}`,
        enquiryId: enquiry.id,
        businessId: business.id,
        status: "lost",
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * DAY),
      },
      select: { id: true },
    });

    const result = await requestClosure(actorOf(owner));
    expect(result.ok).toBe(true);

    // Retained: nothing about the buyer's record moved.
    expect(await prisma.enquiry.findUnique({ where: { id: enquiry.id } })).not.toBeNull();
    expect(await prisma.quote.findUnique({ where: { id: quote.id } })).not.toBeNull();

    expect(
      await postMessage({
        enquiryId: enquiry.id,
        businessId: business.id,
        senderId: buyer.id,
        sender: "buyer",
        body: "Are you still there?",
      }),
    ).toMatchObject({ ok: false, error: "supplier_closed" });
    expect(await acceptQuote(buyer.id, quote.id)).toMatchObject({ ok: false, error: "supplier_closed" });
  });
});

describe("Q2 — the slug goes back to the same licence holder, and only through staff", () => {
  it("hides a closed business from name search, refuses a self-serve claim, and reopens by staff", async () => {
    const { business, owner } = await makeBusiness();
    await requestClosure(actorOf(owner), new Date(Date.now() - 20 * DAY));
    await sweepClosures();

    const byName = await findClaimMatches(`Closure Fixture ${business.slug}`);
    expect(byName.results.some((result) => result.id === business.id)).toBe(false);
    const byLicence = await findClaimMatches(`CLS-${business.slug}`);
    expect(byLicence.results.some((result) => result.id === business.id)).toBe(true);

    const claimant = await makeUser(["buyer"]);
    const claim = await submitClaim(actorOf(claimant), {
      businessId: business.id,
      route: "phone_callback",
      phone: "+971500000000",
    });
    expect(claim.ok).toBe(false);

    const opsLead = await makeUser(["staff_ops_lead"]);
    const reopened = await reopenClosedBusiness({
      actor: actorOf(opsLead),
      businessId: business.id,
      ownerEmail: (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email!,
      reason: "Licence checked against the DED record; same holder reopening.",
    });
    expect(reopened).toEqual({ ok: true, slug: business.slug });

    const row = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(row.closedAt).toBeNull();
    // Not published by staff: the owner goes live again through the hub.
    expect(row.publishedAt).toBeNull();
    // Criterion 9 — the staff act is audited with its reason.
    expect(
      await prisma.auditEvent.count({ where: { subject: `Business:${business.id}`, action: "closure_reopened" } }),
    ).toBe(1);
  });
});

describe("B8 — a platform closure, noticed first", () => {
  it("gives notice, withdraws it when the licence is renewed, and applies it when not", async () => {
    // Lapsed before the notice below is dated, or the notice is refused as
    // being about a licence that was still current on the day it was given.
    const lapsed = new Date(Date.now() - 20 * DAY);
    const opsLead = await makeUser(["staff_ops_lead"]);

    const renewed = await makeBusiness({ licenceExpiry: lapsed });
    const notice = await giveLicenceLapseNotice({
      actor: actorOf(opsLead),
      businessId: renewed.business.id,
      reason: "Licence expired ten days ago and no renewal was uploaded.",
      now: new Date(Date.now() - 15 * DAY),
    });
    expect(notice.ok).toBe(true);
    // Nothing comes down on notice.
    expect((await prisma.business.findUniqueOrThrow({ where: { id: renewed.business.id } })).publishedAt).not.toBeNull();

    await prisma.business.update({
      where: { id: renewed.business.id },
      data: { licenceExpiry: new Date(Date.now() + 365 * DAY) },
    });

    const unrenewed = await makeBusiness({ licenceExpiry: lapsed });
    await giveLicenceLapseNotice({
      actor: actorOf(opsLead),
      businessId: unrenewed.business.id,
      reason: "Licence expired ten days ago and no renewal was uploaded.",
      now: new Date(Date.now() - 15 * DAY),
    });

    await sweepClosures();

    const withdrawn = await prisma.businessClosure.findFirstOrThrow({ where: { businessId: renewed.business.id } });
    expect(withdrawn.reversedVia).toBe("licence_renewed");
    expect((await prisma.business.findUniqueOrThrow({ where: { id: renewed.business.id } })).publishedAt).not.toBeNull();

    const applied = await prisma.business.findUniqueOrThrow({ where: { id: unrenewed.business.id } });
    expect(applied.publishedAt).toBeNull();
    expect(applied.closureRequestedAt).not.toBeNull();

    // The owner cannot undo a platform closure with a button; staff can, with a reason.
    expect(await reverseAsOwner({ id: unrenewed.owner.id, roles: [] })).toMatchObject({ ok: false, error: "platform" });
    const undone = await withdrawClosure({
      actor: actorOf(opsLead),
      businessId: unrenewed.business.id,
      reason: "Renewed licence received by email and checked against DED.",
    });
    expect(undone).toMatchObject({ ok: true, restored: true });
    expect((await prisma.business.findUniqueOrThrow({ where: { id: unrenewed.business.id } })).publishedAt).not.toBeNull();

    expect(
      await prisma.auditEvent.count({
        where: { subject: `Business:${unrenewed.business.id}`, action: { in: ["closure_noticed", "closure_withdrawn"] } },
      }),
    ).toBe(2);
  });

  it("refuses notice over a licence that is still current", async () => {
    const opsLead = await makeUser(["staff_ops_lead"]);
    const { business } = await makeBusiness();
    expect(
      await giveLicenceLapseNotice({
        actor: actorOf(opsLead),
        businessId: business.id,
        reason: "Testing the refusal path for a current licence.",
      }),
    ).toMatchObject({ ok: false, error: "licence_current" });
  });
});
