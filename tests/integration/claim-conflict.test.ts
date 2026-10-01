import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { attachTenancyDocument } from "@/lib/claims/claimant";
import { escalateConflict, logConflictCall, requestConflictDocuments, resolveConflict } from "@/lib/claims/conflict";
import { lockListingClaims } from "@/lib/claims/lock";
import { conflictReviewFor } from "@/lib/claims/review";
import { assignRef } from "@/lib/moderation/decide";
import { approveClaim } from "@/lib/moderation/claims";
import { loadPending, loadQueue, refFor } from "@/lib/moderation/queue";
import { ConsoleNotificationSender } from "@/lib/notify/senders";
import { submitClaim, withdrawClaim } from "@/lib/onboarding/claim";
import { t } from "@/lib/i18n";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board 4c, against a real database — Phase 1, 2 and 5 of the handoff's build.
 *
 * Every claim here goes through `submitClaim`, the path `2b`'s submit and
 * `2a`'s *Report a dispute* take, because the defect this board found was in
 * the opening: a conflict opened only for a listing already claimed, and then
 * looked for two undecided claims a challenge never has. The old suite built
 * its conflicts by calling the opener directly and never noticed.
 *
 * Seats are attached the way the onboarding action attaches them — for an
 * uncontested claim, and only for one — so the award's seat moves are asserted
 * against the seats the product would really have handed out.
 */

const PREFIX = "c4c-";
const ENQUIRY = "ENQ-C4C-";
const NOTE = "Called both numbers on the public record. A answered as the company; B is a former service partner.";

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let ops: Actor;
let ops2: Actor;
let moderator: Actor;
let categoryId: string;
let area: { id: string; name: string; emirate: string };
let seq = 0;
const people: string[] = [];

/** Every body a claimant was sent: printed by the console sender, or held for quiet hours. */
const sent: string[] = [];
let spy: ReturnType<typeof vi.spyOn>;

async function heldBodies(userIds: readonly string[]): Promise<string[]> {
  const rows = await prisma.notificationDelivery.findMany({
    where: { recipientUserId: { in: [...userIds] }, payload: { not: undefined } },
    select: { payload: true },
  });
  return rows.flatMap((row) => {
    const payload = row.payload as { body?: string; subject?: string } | null;
    return payload?.body ? [payload.body, payload.subject ?? ""] : [];
  });
}

async function removeFixtures() {
  const businesses = await prisma.business.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  const ids = businesses.map((row) => row.id);
  if (ids.length > 0) {
    const conflicts = await prisma.claimConflict.findMany({
      where: { businessId: { in: ids } },
      select: { id: true, producedBusinessId: true },
    });
    const all = [...ids, ...conflicts.flatMap((row) => (row.producedBusinessId ? [row.producedBusinessId] : []))];
    const claims = await prisma.claimSubmission.findMany({ where: { businessId: { in: all } }, select: { id: true } });
    await purgeAuditRows({
      subject: {
        in: [...conflicts.map((row) => `ClaimConflict:${row.id}`), ...claims.map((row) => `ClaimSubmission:${row.id}`)],
      },
    });
    await prisma.queueItem.deleteMany({ where: { businessId: { in: all } } });
    // A conflict's claims are RESTRICT on it, and both cascade from the listing.
    await prisma.claimConflict.deleteMany({ where: { businessId: { in: all } } });
    await prisma.claimSubmission.deleteMany({ where: { businessId: { in: all } } });
    await prisma.document.deleteMany({ where: { businessId: { in: all } } });
    await prisma.business.deleteMany({ where: { id: { in: all } } });
  }
  await prisma.stagedListing.deleteMany({ where: { tradeName: { startsWith: "C4C " } } });
  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: ENQUIRY } } });
  const users = await prisma.user.findMany({ where: { fullName: { startsWith: "C4C " } }, select: { id: true } });
  const userIds = [...new Set([...users.map((row) => row.id), ...people])];
  if (userIds.length > 0) {
    await prisma.notificationDelivery.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await purgeAuditRows({ actorId: { in: userIds } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

beforeAll(async () => {
  const [opsRows, mod] = await Promise.all([
    prisma.user.findMany({ where: { roles: { has: "staff_ops_lead" } }, orderBy: { id: "asc" }, select: { id: true }, take: 2 }),
    prisma.user.findFirstOrThrow({ where: { roles: { has: "staff_moderator" } }, orderBy: { id: "asc" }, select: { id: true } }),
  ]);
  ops = actor(opsRows[0]!.id, "staff_ops_lead");
  ops2 = actor((opsRows[1] ?? opsRows[0]!).id, "staff_ops_lead");
  moderator = actor(mod.id, "staff_moderator");
  categoryId = (await prisma.category.findFirstOrThrow({ where: { parentId: null }, orderBy: { id: "asc" }, select: { id: true } })).id;
  area = await prisma.area.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true, name: true, emirate: true } });
  await removeFixtures();

  spy = vi.spyOn(ConsoleNotificationSender.prototype, "send").mockImplementation(async (message) => {
    sent.push(message.body, message.subject ?? "");
    return { delivered: true, providerRef: "test" };
  });
});

afterEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  spy.mockRestore();
  await removeFixtures();
});

function stamp(): string {
  seq += 1;
  return `${Date.now()}${String(seq).padStart(3, "0")}`;
}

async function listing(label: string, options: { owner?: boolean; enquiries?: number } = {}) {
  const s = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `C4C ${label} Cooling Services LLC`,
      displayName: `C4C ${label} Cooling Services`,
      slug: `${PREFIX}${label.toLowerCase()}-${s}`,
      licenceNumber: `ADDED-${s.slice(-6)}`,
      licenceAuthority: "ADDED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: options.owner ? "claimed" : "unclaimed",
      publishedAt: new Date(),
      locations: {
        create: {
          type: "head_office",
          emirate: area.emirate as never,
          areaId: area.id,
          addressLine: "Plot 22, Street 9",
          phone: `02 55${s.slice(-5)}`,
          published: true,
        },
      },
    },
    select: { id: true, slug: true, licenceNumber: true, displayName: true },
  });
  let owner: { id: string } | null = null;
  if (options.owner) {
    owner = await person(`${label} Owner`, { businessId: business.id, roles: ["buyer", "seller_owner"] });
  }
  for (let n = 0; n < (options.enquiries ?? 0); n += 1) {
    const buyer = await person(`${label} Buyer ${n}`);
    const enquiry = await prisma.enquiry.create({
      data: { ref: `${ENQUIRY}${s}-${n}`, buyerId: buyer.id, requirement: "Split units for a warehouse office.", closesAt: new Date(Date.now() + 7 * 86_400_000) },
      select: { id: true },
    });
    await prisma.enquiryRecipient.create({ data: { enquiryId: enquiry.id, businessId: business.id, state: "delivered" } });
  }
  return { ...business, owner };
}

async function person(name: string, extra: { businessId?: string; roles?: Role[]; email?: string } = {}) {
  const s = stamp();
  const user = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      phone: `+9715${s.slice(-8)}`,
      email: extra.email ?? `c4c.${s}@claimant.test`,
      fullName: `C4C ${name}`,
      roles: extra.roles ?? ["buyer"],
      businessId: extra.businessId ?? null,
    },
    select: { id: true, roles: true },
  });
  people.push(user.id);
  return user;
}

/** `2b`'s submit, and the seat the onboarding action attaches — for an uncontested claim only. */
async function claim(user: { id: string; roles: string[] }, businessId: string, extra: { licence?: string; name?: string } = {}) {
  const result = await submitClaim(actor(user.id, ...(user.roles as Role[])), {
    businessId,
    route: "phone_callback",
    phone: "+97125531190",
    claimantName: extra.name ?? "C4C Named Claimant",
    claimantRole: "owner",
    ...(extra.licence ? { statedLicenceNumber: extra.licence } : {}),
  });
  if (!result.ok) throw new Error(result.error);
  if (!result.contested) {
    await prisma.user.update({
      where: { id: user.id },
      data: { businessId, roles: user.roles.includes("seller_owner") ? (user.roles as Role[]) : [...(user.roles as Role[]), "seller_owner"] },
    });
  }
  return result;
}

async function race(label: string, options: { enquiries?: number } = {}) {
  const business = await listing(label, options);
  const a = await person(`${label} Faisal`, { email: `faisal.${stamp()}@coolbreeze.test` });
  const b = await person(`${label} Ahmed`);
  const first = await claim(a, business.id, { licence: business.licenceNumber, name: `C4C ${label} Faisal Al Marzooqi` });
  const second = await claim(b, business.id, { licence: `ADDED-${stamp().slice(-6)}`, name: `C4C ${label} Ahmed Siddiqui` });
  const conflictId = second.conflict!.conflictId;
  return { business, a, b, aClaim: first.submissionId, bClaim: second.submissionId, conflictId };
}

const seat = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: { businessId: true, roles: true } });

describe("opening a conflict, from the product's own path", () => {
  it("opens a race when a second claim lands on a listing nobody owns, and disputes the listing", async () => {
    const business = await listing("Race");
    const a = await person("Race A");
    const b = await person("Race B");

    const first = await claim(a, business.id);
    expect(first.contested).toBe(false);
    expect(first.conflict).toBeNull();

    const second = await claim(b, business.id);
    expect(second.contested).toBe(true);
    expect(second.conflict).toMatchObject({ opened: true, challenge: false });

    const conflict = await prisma.claimConflict.findUniqueOrThrow({
      where: { id: second.conflict!.conflictId },
      select: { submissionAId: true, submissionBId: true, challenge: true, claims: { select: { id: true, contested: true } } },
    });
    expect(conflict.submissionAId).toBe(first.submissionId);
    expect(conflict.submissionBId).toBe(second.submissionId);
    expect(conflict.claims.map((row) => row.id).sort()).toEqual([first.submissionId, second.submissionId].sort());
    expect(conflict.claims.every((row) => row.contested)).toBe(true);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { claimStatus: true } })).claimStatus).toBe("disputed");

    // B9's precondition: the side that made it a conflict was handed no seat.
    expect((await seat(b.id)).businessId).toBeNull();
    expect((await seat(a.id)).businessId).toBe(business.id);
  });

  it("joins a third claim to the open conflict rather than queueing it where it could be approved", async () => {
    const { business, conflictId } = await race("Third");
    const c = await person("Third C");
    const third = await claim(c, business.id);
    expect(third.conflict).toMatchObject({ conflictId, opened: false });

    const pending = await loadPending();
    expect(pending.some((raw) => raw.subject === "claim" && raw.id === third.submissionId)).toBe(false);
    const row = pending.find((raw) => raw.subject === "conflict" && raw.id === conflictId)!;
    expect(row.facts.kind === "conflict" && row.facts.claims.length).toBe(3);

    // And the plain-claim decider refuses it: it is settled with the others.
    expect(await approveClaim({ actor: ops, submissionId: third.submissionId, reason: NOTE })).toEqual({ ok: false, error: "in_conflict" });
  });

  it("opens a challenge on a listing that already has an owner, and attaches no seat — the hole this board closed", async () => {
    const business = await listing("Challenge", { owner: true });
    const challenger = await person("Challenger");
    const result = await claim(challenger, business.id);

    expect(result.contested).toBe(true);
    expect(result.conflict).toMatchObject({ opened: true, challenge: true });
    const conflict = await prisma.claimConflict.findUniqueOrThrow({
      where: { id: result.conflict!.conflictId },
      select: { incumbentId: true, submissionBId: true },
    });
    expect(conflict.incumbentId).toBe(business.owner!.id);
    expect(conflict.submissionBId).toBeNull();
    // The owner keeps operating; the stranger holds nothing on their business.
    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { claimStatus: true } })).claimStatus).toBe("claimed");
    const held = await seat(challenger.id);
    expect(held.businessId).toBeNull();
    expect(held.roles).not.toContain("seller_owner");
  });

  it("opens exactly one conflict when two claims arrive at once", async () => {
    const business = await listing("Together");
    const [a, b] = await Promise.all([person("Together A"), person("Together B")]);
    const results = await Promise.all([claim(a, business.id), claim(b, business.id)]);

    expect(results.filter((result) => result.contested)).toHaveLength(1);
    expect(await prisma.claimConflict.count({ where: { businessId: business.id } })).toBe(1);
    expect(await prisma.claimSubmission.count({ where: { businessId: business.id, conflictId: { not: null } } })).toBe(2);
  });

  it("tells every claimant it opened, and names nobody else (criterion 4)", async () => {
    const { business, a, b } = await race("Told");
    const delivered = await prisma.notificationDelivery.findMany({
      where: { event: "claim_conflict_opened", recipientUserId: { in: [a.id, b.id] } },
      select: { recipientUserId: true },
    });
    expect(new Set(delivered.map((row) => row.recipientUserId))).toEqual(new Set([a.id, b.id]));

    const bodies = [...sent, ...(await heldBodies([a.id, b.id]))].join("\n");
    expect(bodies).toContain(business.displayName);
    expect(bodies).not.toMatch(/Faisal|Ahmed|Siddiqui|Marzooqi/);
    expect(bodies).not.toMatch(/ADDED-\d+/);
  });
});

describe("criterion 1 and 3 — who may resolve, and the note", () => {
  it("refuses a moderator at the service, whatever the screen offers (403)", async () => {
    const { conflictId, aClaim } = await race("Mod");
    await expect(resolveConflict({ actor: moderator, conflictId, resolution: "award", claimId: aClaim, note: NOTE, partyReasons: {} })).rejects.toBeInstanceOf(
      PermissionError,
    );
    await expect(escalateConflict({ actor: moderator, conflictId, holderId: ops.id, note: NOTE })).rejects.toBeInstanceOf(PermissionError);
    await expect(requestConflictDocuments({ actor: moderator, conflictId, note: NOTE })).rejects.toBeInstanceOf(PermissionError);
  });

  it("refuses a resolution with no note (422)", async () => {
    const { conflictId, aClaim, bClaim } = await race("Note");
    await expect(
      resolveConflict({ actor: ops, conflictId, resolution: "award", claimId: aClaim, note: "  ", partyReasons: { [bClaim]: "not_source_licence" } }),
    ).rejects.toBeInstanceOf(AuditReasonError);
  });

  it("refuses an award that leaves a losing claim without its reason", async () => {
    const { conflictId, aClaim, bClaim } = await race("Reasonless");
    expect(await resolveConflict({ actor: ops, conflictId, resolution: "award", claimId: aClaim, note: NOTE, partyReasons: {} })).toEqual({
      ok: false,
      error: "reason_required",
      claimId: bClaim,
    });
  });

  it("lets a moderator hand a conflict to an ops lead, and only to one (B1)", async () => {
    const { conflictId } = await race("Assign");
    const ref = refFor("conflict", conflictId);
    expect(await assignRef({ actor: moderator, ref, assigneeId: moderator.id, reason: "Needs a phone call." })).toEqual({
      ok: false,
      error: "needs_ops_lead",
    });
    expect(await assignRef({ actor: moderator, ref, assigneeId: ops.id, reason: "Needs a phone call." })).toEqual({ ok: true });
  });
});

describe("award (criteria 2, 4, 7)", () => {
  it("gives the listing, its seat and its waiting enquiries to the winner only, and tells everybody", async () => {
    const { business, a, b, aClaim, bClaim, conflictId } = await race("Award", { enquiries: 2 });

    // B wins against the side that held a seat, so the seat moves are real.
    const result = await resolveConflict({
      actor: ops,
      conflictId,
      resolution: "award",
      claimId: bClaim,
      note: NOTE,
      partyReasons: { [aClaim]: "not_confirmed_by_phone" },
    });
    expect(result).toMatchObject({ ok: true, enquiriesReleased: 2 });

    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { claimStatus: true } })).claimStatus).toBe("claimed");
    expect(await seat(b.id)).toMatchObject({ businessId: business.id });
    expect((await seat(b.id)).roles).toContain("seller_owner");
    const loser = await seat(a.id);
    expect(loser.businessId).toBeNull();
    expect(loser.roles).not.toContain("seller_owner");

    const claims = await prisma.claimSubmission.findMany({
      where: { id: { in: [aClaim, bClaim] } },
      select: { id: true, outcome: true, partyReason: true, decisionReason: true },
    });
    const lost = claims.find((row) => row.id === aClaim)!;
    expect(lost).toMatchObject({ outcome: "rejected", partyReason: "not_confirmed_by_phone" });
    expect(lost.decisionReason).toBe(t("claim.party_reason.not_confirmed_by_phone"));
    // B4: the internal note reaches no claimant-facing field.
    expect(claims.every((row) => row.decisionReason !== NOTE)).toBe(true);

    const audit = await prisma.auditEvent.findMany({ where: { subject: `ClaimConflict:${conflictId}`, action: "claim_resolved" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.reason).toBe(NOTE);
    expect(audit[0]!.actorId).toBe(ops.id);
    expect(JSON.stringify(audit[0]!.before)).toContain(aClaim);
    expect(JSON.stringify(audit[0]!.before)).toContain(bClaim);

    const events = await prisma.notificationDelivery.findMany({
      where: { recipientUserId: { in: [a.id, b.id] }, event: { in: ["claim_awarded", "claim_not_awarded"] } },
      select: { event: true, recipientUserId: true },
    });
    expect(events.some((row) => row.event === "claim_awarded" && row.recipientUserId === b.id)).toBe(true);
    expect(events.some((row) => row.event === "claim_not_awarded" && row.recipientUserId === a.id)).toBe(true);
    expect(events.some((row) => row.event === "claim_awarded" && row.recipientUserId === a.id)).toBe(false);

    const bodies = [...sent, ...(await heldBodies([a.id, b.id]))].join("\n");
    expect(bodies).not.toContain(NOTE);
    expect(bodies).not.toMatch(/Faisal|Ahmed|Siddiqui|Marzooqi/);
  });

  it("cannot be decided twice", async () => {
    const { conflictId, aClaim, bClaim } = await race("Twice");
    const input = { actor: ops, conflictId, resolution: "award" as const, claimId: aClaim, note: NOTE, partyReasons: { [bClaim]: "not_source_licence" as const } };
    const [left, right] = await Promise.all([resolveConflict(input), resolveConflict({ ...input, actor: ops2 })]);
    expect([left.ok, right.ok].sort()).toEqual([false, true]);
    expect(await prisma.auditEvent.count({ where: { subject: `ClaimConflict:${conflictId}`, action: "claim_resolved" } })).toBe(1);
  });

  it("refuses an award against a challenge, and lets the owner keep it", async () => {
    const business = await listing("Keep", { owner: true });
    const challenger = await person("Keep Challenger");
    const opened = await claim(challenger, business.id);
    const conflictId = opened.conflict!.conflictId;

    expect(
      await resolveConflict({ actor: ops, conflictId, resolution: "award", claimId: opened.submissionId, note: NOTE, partyReasons: {} }),
    ).toEqual({ ok: false, error: "challenge_award_refused" });

    const kept = await resolveConflict({
      actor: ops,
      conflictId,
      resolution: "keep_owner",
      note: NOTE,
      partyReasons: { [opened.submissionId]: "not_source_licence" },
    });
    expect(kept.ok).toBe(true);
    expect(await seat(business.owner!.id)).toMatchObject({ businessId: business.id });
    expect((await seat(challenger.id)).businessId).toBeNull();
    expect(
      await prisma.notificationDelivery.count({ where: { recipientUserId: challenger.id, event: "claim_not_awarded" } }),
    ).toBeGreaterThan(0);
  });

  it("will not keep an owner a race does not have", async () => {
    const { conflictId, aClaim, bClaim } = await race("NoOwner");
    expect(
      await resolveConflict({ actor: ops, conflictId, resolution: "keep_owner", note: NOTE, partyReasons: { [aClaim]: "not_source_licence", [bClaim]: "not_source_licence" } }),
    ).toEqual({ ok: false, error: "not_a_challenge" });
  });
});

describe("split (criterion 8) and merge (criterion 9)", () => {
  it("builds B's listing from B's licence record and leaves reviews, history and slug on the original", async () => {
    const { business, b, aClaim, bClaim, conflictId } = await race("Split", { enquiries: 1 });
    const bLicence = (await prisma.claimSubmission.findUniqueOrThrow({ where: { id: bClaim }, select: { statedLicenceNumber: true } })).statedLicenceNumber!;
    const run = await prisma.licenceImportRun.findFirstOrThrow({ orderBy: { number: "asc" }, select: { id: true } });
    await prisma.stagedListing.create({
      data: {
        runId: run.id,
        rowNumber: 900_000 + seq,
        raw: {},
        tradeName: "C4C Breeze Air Conditioning Maintenance LLC",
        licenceNumber: bLicence,
        licenceAuthority: "ADDED",
        licenceExpiry: new Date(Date.now() + 200 * 86_400_000),
        emirate: area.emirate,
        areaName: area.name,
        disposition: "ready",
      },
    });

    const result = await resolveConflict({ actor: ops, conflictId, resolution: "split", claimId: aClaim, secondClaimId: bClaim, note: NOTE, partyReasons: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const original = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { slug: true, _count: { select: { recipients: true } } } });
    expect(original.slug).toBe(business.slug);
    expect(original._count.recipients).toBe(1);

    const created = await prisma.business.findUniqueOrThrow({
      where: { id: result.producedBusinessId! },
      select: { tradeName: true, licenceNumber: true, claimStatus: true, publishedAt: true, verificationTier: true, _count: { select: { recipients: true, reviews: true } } },
    });
    expect(created).toMatchObject({
      tradeName: "C4C Breeze Air Conditioning Maintenance LLC",
      licenceNumber: bLicence,
      claimStatus: "claimed",
      publishedAt: null,
      verificationTier: 0,
    });
    expect(created._count).toEqual({ recipients: 0, reviews: 0 });
    expect((await seat(b.id)).businessId).toBe(result.producedBusinessId);
    expect(await prisma.notificationDelivery.count({ where: { recipientUserId: b.id, event: "claim_new_listing_created" } })).toBeGreaterThan(0);
  });

  it("refuses to copy a licence that already has a listing", async () => {
    const { conflictId, aClaim, bClaim } = await race("Copy");
    const elsewhere = await listing("Elsewhere");
    await prisma.claimSubmission.update({ where: { id: bClaim }, data: { statedLicenceNumber: elsewhere.licenceNumber } });
    expect(
      await resolveConflict({ actor: ops, conflictId, resolution: "split", claimId: aClaim, secondClaimId: bClaim, note: NOTE, partyReasons: {} }),
    ).toEqual({ ok: false, error: "licence_has_a_listing", claimId: bClaim });
  });

  it("makes B's licence a held branch of the listing, keeping its own number, and gives B no seat", async () => {
    const { business, b, aClaim, bClaim, conflictId } = await race("Merge");
    const result = await resolveConflict({ actor: ops, conflictId, resolution: "merge_branch", claimId: aClaim, secondClaimId: bClaim, note: NOTE, partyReasons: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const branch = await prisma.location.findUniqueOrThrow({ where: { id: result.producedLocationId! }, select: { businessId: true, licenceNumber: true, published: true } });
    const bLicence = (await prisma.claimSubmission.findUniqueOrThrow({ where: { id: bClaim }, select: { statedLicenceNumber: true, outcome: true, partyReason: true } }));
    expect(branch).toEqual({ businessId: business.id, licenceNumber: bLicence.statedLicenceNumber, published: false });
    expect(bLicence).toMatchObject({ outcome: "rejected", partyReason: null });
    expect((await seat(b.id)).businessId).toBeNull();
  });
});

describe("the states between opening and deciding", () => {
  it("asks every side for tenancy documents with the clock running, and marks them received", async () => {
    const { business, a, b, conflictId } = await race("Docs");
    expect((await requestConflictDocuments({ actor: ops, conflictId, note: "Same building; the tenancy settles the unit." })).ok).toBe(true);
    expect(await prisma.notificationDelivery.count({ where: { recipientUserId: { in: [a.id, b.id] }, event: "claim_documents_requested" } })).toBeGreaterThanOrEqual(2);

    for (const who of [a, b]) {
      const document = await prisma.document.create({
        data: { kind: "tenancy_contract", businessId: business.id, storagePath: `${business.id}/tenancy/${who.id}.pdf`, filename: "tenancy.pdf" },
        select: { id: true },
      });
      await prisma.$transaction(async (tx) => {
        await lockListingClaims(tx, business.id);
        await attachTenancyDocument(tx, { businessId: business.id, claimantId: who.id, documentId: document.id }, new Date());
      });
    }
    const conflict = await prisma.claimConflict.findUniqueOrThrow({ where: { id: conflictId }, select: { docsReceivedAt: true } });
    expect(conflict.docsReceivedAt).not.toBeNull();
  });

  it("escalates only to somebody who can resolve, and the queue shows it escalated, not overdue", async () => {
    const { conflictId } = await race("Escalate");
    await prisma.claimConflict.update({ where: { id: conflictId }, data: { createdAt: new Date(Date.now() - 5 * 86_400_000) } });
    expect(await escalateConflict({ actor: ops, conflictId, holderId: moderator.id, note: "Legal question about the lease." })).toEqual({
      ok: false,
      error: "holder_cannot_resolve",
    });
    expect((await escalateConflict({ actor: ops, conflictId, holderId: ops2.id, note: "Legal question about the lease." })).ok).toBe(true);

    const view = await loadQueue({ kind: "conflict" });
    const entry = view.all.find((row) => row.ref === refFor("conflict", conflictId))!;
    expect(entry.escalated).not.toBeNull();
    expect(entry.late).toBe(false);
  });

  it("logs a call, and only a public-record call breaks a tie (B7)", async () => {
    const { conflictId, aClaim } = await race("Call");
    expect((await logConflictCall({ actor: ops, conflictId, claimId: aClaim, to: "public_record", confirmed: true, note: "Answered as the company." })).ok).toBe(true);
    const review = await conflictReviewFor(conflictId);
    expect(review!.log.some((entry) => entry.kind === "call")).toBe(true);
    expect(review!.claims.find((side) => side.id === aClaim)!.scored.confirmedOnPublicRecord).toBe(true);
  });

  it("dissolves a race when a withdrawal leaves one claim, which goes back to the queue keeping its age", async () => {
    const { business, a, b, aClaim, conflictId } = await race("Withdraw");
    const withdrawn = await withdrawClaim(actor(b.id, "buyer"), business.id, "Wrong listing.");
    expect(withdrawn).toEqual({ ok: true, dissolved: true });

    expect((await prisma.claimConflict.findUniqueOrThrow({ where: { id: conflictId }, select: { dissolvedAt: true } })).dissolvedAt).not.toBeNull();
    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { claimStatus: true } })).claimStatus).toBe("unclaimed");
    const pending = await loadPending();
    const plain = pending.find((raw) => raw.subject === "claim" && raw.id === aClaim);
    expect(plain).toBeDefined();
    expect(plain!.submittedAt.getTime()).toBe(
      (await prisma.claimSubmission.findUniqueOrThrow({ where: { id: aClaim }, select: { createdAt: true } })).createdAt.getTime(),
    );
    void a;
  });
});

describe("the read model (criteria 5, 6)", () => {
  it("states the source licence, who holds it, and tags from the computed signals", async () => {
    const { conflictId, aClaim, bClaim, business } = await race("Read");
    const review = await conflictReviewFor(conflictId);
    expect(review!.source.record.licenceNumber).toBe(business.licenceNumber);
    const a = review!.claims.find((side) => side.id === aClaim)!;
    const b = review!.claims.find((side) => side.id === bClaim)!;
    expect(a.scored.holdsSourceLicence).toBe(true);
    expect(b.scored.holdsSourceLicence).toBe(false);
    expect(review!.assessment.recommended).toBe(aClaim);
    expect(review!.assessment.strength.get(aClaim)).toBe("stronger");
  });
});

describe("build plan 4.3's owed CHECK — outcome paired with decided_at", () => {
  it("refuses a decided claim with no outcome, and an outcome on an undecided one", async () => {
    const business = await listing("Check");
    const who = await person("Check Claimant");
    await expect(
      prisma.claimSubmission.create({
        data: { businessId: business.id, claimantId: who.id, route: "phone_callback", phone: "+97125531190", decidedAt: new Date(), decisionReason: "Decided with no outcome." },
      }),
    ).rejects.toThrow(/claim_submission_outcome_with_decision/);
    await expect(
      prisma.claimSubmission.create({
        data: { businessId: business.id, claimantId: who.id, route: "phone_callback", phone: "+97125531190", outcome: "approved" },
      }),
    ).rejects.toThrow(/claim_submission_outcome_with_decision/);
  });
});
