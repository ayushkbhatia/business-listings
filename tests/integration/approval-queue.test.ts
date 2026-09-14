import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import {
  approveRef,
  assignRef,
  bulkApprove,
  bulkRequestDocuments,
  rejectRef,
  requestDocumentsRef,
} from "@/lib/moderation/decide";
import { loadQueue, queueHealth, refFor, SLA_MS, type QueueEntry } from "@/lib/moderation/queue";
import { DEFAULT_RULES, RULES_SETTING_KEY, type CheckRules } from "@/lib/moderation/rules";
import { applyRules, previewRules } from "@/lib/moderation/tuning";

/**
 * Board 4b, against a real database.
 *
 * Every acceptance criterion that a unit test cannot reach: the queue reads
 * five tables and agrees with itself (4, 5), bulk approve re-checks every row
 * on the server (1), a rule change re-derives eligibility with nothing stored
 * (2), claims finally have a decider (8, 9), and a branch outside its licence
 * reaches a person.
 *
 * The database is shared with the seed and with sibling suites, so every
 * assertion is about this file's own rows, found by reference.
 */

const SLUG = "aq4b-";
const PERSON = "AQ4B Person";
const DAY = 86_400_000;

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let ops: Actor;
let moderator: Actor;
let previousRules: unknown;
let seq = 0;

async function removeFixtures() {
  const businesses = await prisma.business.findMany({ where: { slug: { startsWith: SLUG } }, select: { id: true } });
  const ids = businesses.map((row) => row.id);
  if (ids.length > 0) {
    const [claims, requests, documents, locations, conflicts] = await Promise.all([
      prisma.claimSubmission.findMany({ where: { businessId: { in: ids } }, select: { id: true } }),
      prisma.listingChangeRequest.findMany({ where: { businessId: { in: ids } }, select: { id: true } }),
      prisma.document.findMany({ where: { businessId: { in: ids } }, select: { id: true } }),
      prisma.location.findMany({ where: { businessId: { in: ids } }, select: { id: true } }),
      prisma.claimConflict.findMany({ where: { businessId: { in: ids } }, select: { id: true } }),
    ]);
    await prisma.auditEvent.deleteMany({
      where: {
        subject: {
          in: [
            ...claims.map((row) => `ClaimSubmission:${row.id}`),
            ...requests.map((row) => `ListingChangeRequest:${row.id}`),
            ...documents.map((row) => `Document:${row.id}`),
            ...locations.map((row) => `Location:${row.id}`),
          ],
        },
      },
    });
    await prisma.claimConflict.deleteMany({ where: { id: { in: conflicts.map((row) => row.id) } } });
    await prisma.claimSubmission.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.listingChangeRequest.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { fullName: { startsWith: PERSON } } });
}

beforeAll(async () => {
  const staff = await prisma.user.findMany({
    where: { roles: { hasSome: ["staff_ops_lead", "staff_moderator"] } },
    orderBy: { id: "asc" },
    select: { id: true, roles: true },
  });
  ops = actor(staff.find((u) => u.roles.includes("staff_ops_lead"))!.id, "staff_ops_lead");
  moderator = actor(staff.find((u) => u.roles.includes("staff_moderator"))!.id, "staff_moderator");
  previousRules = (await prisma.platformSetting.findUnique({ where: { key: RULES_SETTING_KEY }, select: { value: true } }))?.value;
  await prisma.platformSetting.deleteMany({ where: { key: RULES_SETTING_KEY } });
  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
  await prisma.auditEvent.deleteMany({ where: { subject: `PlatformSetting:${RULES_SETTING_KEY}`, reason: { startsWith: "AQ4B" } } });
  if (previousRules === undefined) await prisma.platformSetting.deleteMany({ where: { key: RULES_SETTING_KEY } });
  else
    await prisma.platformSetting.update({
      where: { key: RULES_SETTING_KEY },
      data: { value: previousRules as never },
    });
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

async function business(over: { authority?: "DED" | "DMCC"; expiresInDays?: number; claimStatus?: "unclaimed" | "claimed"; activity?: string | null } = {}) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(3, "0")}`;
  const area = await prisma.area.findFirstOrThrow({ where: { emirate: "dubai" }, orderBy: { id: "asc" }, select: { id: true } });
  const category = await prisma.category.findFirstOrThrow({ where: { parentId: null }, orderBy: { id: "asc" }, select: { id: true } });
  const authority = over.authority ?? "DED";
  return prisma.business.create({
    data: {
      tradeName: `AQ4B Zayed Facilities ${stamp} LLC`,
      displayName: `AQ4B Zayed Facilities ${stamp}`,
      slug: `${SLUG}${stamp}`,
      licenceNumber: `${authority}-${stamp.slice(-7)}`,
      licenceAuthority: authority,
      licenceExpiry: new Date(Date.now() + (over.expiresInDays ?? 300) * DAY),
      licenceActivity: over.activity === undefined ? null : over.activity,
      primaryCategoryId: category.id,
      claimStatus: over.claimStatus ?? "unclaimed",
      publishedAt: new Date(),
      locations: {
        create: { type: "head_office", emirate: "dubai", areaId: area.id, addressLine: "Unit 1", phone: "043472290", published: true },
      },
    },
    select: { id: true, slug: true, tradeName: true, licenceNumber: true, licenceExpiry: true },
  });
}

async function person(roles: Role[] = ["buyer"], businessId: string | null = null) {
  seq += 1;
  return prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      phone: `+9715${String(Date.now()).slice(-7)}${String(seq).padStart(2, "0")}`,
      fullName: `${PERSON} ${seq}`,
      roles,
      businessId,
    },
    select: { id: true },
  });
}

async function licenceClaim(biz: Awaited<ReturnType<typeof business>>, detectedKind: string | null, createdAt = new Date()) {
  const claimant = await person(["buyer", "seller_owner"], biz.id);
  const document = await prisma.document.create({
    data: {
      kind: "trade_licence",
      businessId: biz.id,
      storagePath: `documents/${biz.id}/aq4b-${seq}.pdf`,
      filename: "licence.pdf",
      ...(detectedKind ? { detectedKind, scannedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  const claim = await prisma.claimSubmission.create({
    data: {
      businessId: biz.id,
      claimantId: claimant.id,
      route: "licence_upload",
      documentId: document.id,
      statedLicenceNumber: biz.licenceNumber,
      createdAt,
    },
    select: { id: true },
  });
  return { claim, claimant, ref: refFor("claim", claim.id) };
}

function entry(entries: readonly QueueEntry[], ref: string): QueueEntry {
  const found = entries.find((row) => row.ref === ref);
  if (!found) throw new Error(`${ref} not in the queue`);
  return found;
}

/* ── The queue agrees with itself ─────────────────────────────────────────── */

describe("the queue", () => {
  it("reads every kind, and its chips sum to its rows (criteria 4 and 5)", async () => {
    const clean = await business();
    await licenceClaim(clean, "trade_licence");
    const dmcc = await business({ authority: "DMCC" });
    const rak = await prisma.area.findFirstOrThrow({ where: { emirate: "ras_al_khaimah" }, select: { id: true } }).catch(() => null);
    if (rak) {
      await prisma.location.create({
        data: { businessId: dmcc.id, type: "warehouse", emirate: "ras_al_khaimah", areaId: rak.id, addressLine: "Plot 4", published: true },
      });
    }

    const view = await loadQueue({}, new Date());
    const sum = Object.values(view.counts).reduce((total, count) => total + count, 0);
    expect(sum).toBe(view.total);
    expect(view.rows).toHaveLength(view.total);
    expect(view.all.some((row) => row.kind === "claim" && row.businessId === clean.id)).toBe(true);
    if (rak) {
      const branch = view.all.find((row) => row.kind === "locations" && row.businessId === dmcc.id)!;
      expect(branch.checks[0]!.outcome).toBe("fail");
      expect(branch.action).toBe("review");
    }

    const claims = await loadQueue({ kind: "claim" }, new Date());
    expect(claims.rows.every((row) => row.kind === "claim")).toBe(true);
    expect(claims.rows).toHaveLength(view.counts.claim);
  });

  it("sorts over SLA first, then oldest, and measures lateness per kind (criterion 7)", async () => {
    const old = await business();
    const late = await licenceClaim(old, "trade_licence", new Date(Date.now() - SLA_MS.claim - DAY));
    const view = await loadQueue({}, new Date());
    const row = entry(view.all, late.ref);
    expect(row.late).toBe(true);
    expect(view.overSla).toBeGreaterThanOrEqual(1);
    const firstOnTime = view.all.findIndex((candidate) => !candidate.late);
    expect(firstOnTime === -1 || view.all.indexOf(row) < firstOnTime).toBe(true);
    expect(SLA_MS.conflict).not.toBe(SLA_MS.profile_edit);
  });

  it("excludes a claim that is part of an open conflict — the conflict is the row", async () => {
    const contested = await business({ claimStatus: "claimed" });
    const a = await licenceClaim(contested, "trade_licence");
    const b = await licenceClaim(contested, "trade_licence");
    const conflict = await prisma.claimConflict.create({
      data: { businessId: contested.id, submissionAId: a.claim.id, submissionBId: b.claim.id },
      select: { id: true },
    });
    const view = await loadQueue({}, new Date());
    expect(view.all.some((row) => row.ref === a.ref || row.ref === b.ref)).toBe(false);
    const row = entry(view.all, refFor("conflict", conflict.id));
    expect(row.allPassed).toBe(false);
    expect(row.action).toBe("review");
    expect(await approveRef({ actor: ops, ref: row.ref, reason: "AQ4B approving a conflict" })).toEqual({ ok: false, error: "conflict_screen" });
  });
});

/* ── B1 ───────────────────────────────────────────────────────────────────── */

describe("bulk approve", () => {
  it("acts only on rows where every check passed, checked on the server (criterion 1)", async () => {
    const good = await licenceClaim(await business(), "trade_licence");
    const wrongDocument = await licenceClaim(await business(), "health_authority");
    const expiring = await licenceClaim(await business({ expiresInDays: 21 }), "trade_licence");

    const view = await loadQueue({}, new Date());
    expect(entry(view.all, good.ref).action).toBe("approve");
    expect(entry(view.all, wrongDocument.ref).action).toBe("request_doc");
    expect(entry(view.all, expiring.ref).action).toBe("review");

    // The client sends all three; the server approves one.
    const outcome = await bulkApprove({
      actor: moderator,
      refs: [good.ref, wrongDocument.ref, expiring.ref, "claim:nonexistent"],
      reason: "AQ4B bulk approving the clean claims after spot checks.",
    });
    expect(outcome.done).toEqual([good.ref]);
    expect(outcome.skipped).toEqual(
      expect.arrayContaining([
        { ref: wrongDocument.ref, error: "not_eligible" },
        { ref: expiring.ref, error: "not_eligible" },
        { ref: "claim:nonexistent", error: "not_pending" },
      ]),
    );

    const decided = await prisma.claimSubmission.findUniqueOrThrow({ where: { id: good.claim.id }, select: { outcome: true, decidedById: true } });
    expect(decided).toEqual({ outcome: "approved", decidedById: moderator.id });
    const untouched = await prisma.claimSubmission.findUniqueOrThrow({ where: { id: wrongDocument.claim.id }, select: { decidedAt: true } });
    expect(untouched.decidedAt).toBeNull();
  });
});

/* ── B2 ───────────────────────────────────────────────────────────────────── */

describe("tuning the rules", () => {
  it("previews and applies, and eligibility is re-derived with nothing stored (criterion 2)", async () => {
    const unread = await licenceClaim(await business(), null);
    let view = await loadQueue({}, new Date());
    expect(entry(view.all, unread.ref).allPassed).toBe(false);

    const proposed: CheckRules = { ...DEFAULT_RULES, disabled: ["document_type", "scan_agrees", "scan_confidence"] };
    await expect(previewRules({ actor: moderator, rules: proposed })).rejects.toBeInstanceOf(PermissionError);
    const preview = await previewRules({ actor: ops, rules: proposed });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.after.passing).toBeGreaterThan(preview.now.passing);
    expect(preview.becomeEligible).toBeGreaterThanOrEqual(1);

    expect(await applyRules({ actor: ops, rules: { ...DEFAULT_RULES, disabled: ["business_closing"] }, reason: "AQ4B never" })).toEqual({
      ok: false,
      problem: "rule_not_switchable",
    });
    const applied = await applyRules({ actor: ops, rules: proposed, reason: "AQ4B trusting unread scans for the week." });
    expect(applied.ok).toBe(true);

    view = await loadQueue({}, new Date());
    expect(entry(view.all, unread.ref).allPassed).toBe(true);
    expect(await prisma.auditEvent.count({ where: { action: "queue_rules_tuned", subject: `PlatformSetting:${RULES_SETTING_KEY}` } })).toBeGreaterThan(0);

    await prisma.platformSetting.deleteMany({ where: { key: RULES_SETTING_KEY } });
    view = await loadQueue({}, new Date());
    expect(entry(view.all, unread.ref).allPassed).toBe(false);
  });
});

/* ── Claims finally have a decider ────────────────────────────────────────── */

describe("deciding a claim", () => {
  it("approving claims the listing, logs the reason and the expiry it was approved against (criteria 8, 9)", async () => {
    const biz = await business({ expiresInDays: 21 });
    const { claim, claimant, ref } = await licenceClaim(biz, "trade_licence");
    const result = await approveRef({ actor: moderator, ref, reason: "AQ4B licence checked against the DED portal." });
    expect(result).toEqual({ ok: true });

    const after = await prisma.business.findUniqueOrThrow({ where: { id: biz.id }, select: { claimStatus: true, licenceExpiry: true, verificationTier: true } });
    expect(after.claimStatus).toBe("claimed");
    // B10: approval does not approve the licence forever, and moves no tier.
    expect(after.licenceExpiry.getTime()).toBe(biz.licenceExpiry.getTime());
    expect(after.verificationTier).toBe(0);

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { subject: `ClaimSubmission:${claim.id}`, action: "queue_decided" } });
    expect(audit.actorId).toBe(moderator.id);
    expect(audit.reason).toBe("AQ4B licence checked against the DED portal.");
    expect((audit.after as { licenceExpiry: string }).licenceExpiry).toBe(biz.licenceExpiry.toISOString());

    const seat = await prisma.user.findUniqueOrThrow({ where: { id: claimant.id }, select: { businessId: true, roles: true } });
    expect(seat.businessId).toBe(biz.id);
    expect(seat.roles).toContain("seller_owner");
    expect(await approveRef({ actor: moderator, ref, reason: "AQ4B again" })).toEqual({ ok: false, error: "not_pending" });
  });

  it("rejecting takes back the owner seat the claim attached", async () => {
    const biz = await business();
    const { claimant, ref, claim } = await licenceClaim(biz, "health_authority");
    await expect(rejectRef({ actor: moderator, ref, reason: "x" })).rejects.toThrow();
    expect(await rejectRef({ actor: moderator, ref, reason: "AQ4B the upload is a DHA licence; send the trade licence." })).toEqual({ ok: true });

    const seat = await prisma.user.findUniqueOrThrow({ where: { id: claimant.id }, select: { businessId: true, roles: true } });
    expect(seat.businessId).toBeNull();
    expect(seat.roles).toEqual(["buyer"]);
    const decided = await prisma.claimSubmission.findUniqueOrThrow({ where: { id: claim.id }, select: { outcome: true, decisionReason: true } });
    expect(decided.outcome).toBe("rejected");
    expect((await prisma.business.findUniqueOrThrow({ where: { id: biz.id }, select: { claimStatus: true } })).claimStatus).toBe("unclaimed");
  });
});

/* ── Additive actions ─────────────────────────────────────────────────────── */

describe("request documents and reassign", () => {
  it("asks the seller, keeps the row, and takes it off the SLA clock", async () => {
    const late = await licenceClaim(await business(), "health_authority", new Date(Date.now() - SLA_MS.claim - DAY));
    const outcome = await bulkRequestDocuments({
      actor: moderator,
      refs: [late.ref],
      reason: "AQ4B please upload the trade licence, not the DHA licence.",
    });
    expect(outcome.done).toEqual([late.ref]);

    const row = entry((await loadQueue({}, new Date())).all, late.ref);
    expect(row.docsRequested?.reason).toBe("AQ4B please upload the trade licence, not the DHA licence.");
    expect(row.late).toBe(false);
    expect(await prisma.auditEvent.count({ where: { subject: `ClaimSubmission:${late.claim.id}`, action: "queue_docs_requested" } })).toBe(1);
  });

  it("refuses to request a document where there is none to ask for", async () => {
    const dmcc = await business({ authority: "DMCC" });
    const rak = await prisma.area.findFirst({ where: { emirate: "ras_al_khaimah" }, select: { id: true } });
    if (!rak) return;
    const branch = await prisma.location.create({
      data: { businessId: dmcc.id, type: "depot", emirate: "ras_al_khaimah", areaId: rak.id, addressLine: "Plot 9", published: true },
      select: { id: true },
    });
    expect(await requestDocumentsRef({ actor: moderator, ref: refFor("location", branch.id), reason: "AQ4B send a branch licence" })).toEqual({
      ok: false,
      error: "not_requestable",
    });
  });

  it("assigns, and Assigned to me narrows the chips with the rows", async () => {
    const { ref } = await licenceClaim(await business(), "trade_licence");
    expect(await assignRef({ actor: ops, ref, assigneeId: moderator.id, reason: "AQ4B handing this to the moderator on shift." })).toEqual({ ok: true });
    const buyer = await person();
    expect(await assignRef({ actor: ops, ref, assigneeId: buyer.id, reason: "AQ4B to a buyer" })).toEqual({ ok: false, error: "not_staff" });

    const mine = await loadQueue({ assigneeId: moderator.id }, new Date());
    expect(mine.rows.some((row) => row.ref === ref)).toBe(true);
    expect(mine.rows.every((row) => row.assignee?.id === moderator.id)).toBe(true);
    expect(Object.values(mine.counts).reduce((a, b) => a + b, 0)).toBe(mine.total);
  });
});

/* ── Branches outside the licence ─────────────────────────────────────────── */

describe("a branch outside the licensed emirate", () => {
  it("rejecting unpublishes it; approving clears it until it moves again", async () => {
    const rak = await prisma.area.findFirst({ where: { emirate: "ras_al_khaimah" }, select: { id: true } });
    const sharjah = await prisma.area.findFirst({ where: { emirate: "sharjah" }, select: { id: true } });
    if (!rak || !sharjah) return;
    const dmcc = await business({ authority: "DMCC" });
    const rejected = await prisma.location.create({
      data: { businessId: dmcc.id, type: "warehouse", emirate: "ras_al_khaimah", areaId: rak.id, addressLine: "Plot 1", published: true },
      select: { id: true },
    });
    const approved = await prisma.location.create({
      data: { businessId: dmcc.id, type: "depot", emirate: "ras_al_khaimah", areaId: rak.id, addressLine: "Plot 2", published: true },
      select: { id: true },
    });

    expect(await rejectRef({ actor: moderator, ref: refFor("location", rejected.id), reason: "AQ4B a DMCC licence does not cover a RAK warehouse." })).toEqual({ ok: true });
    expect((await prisma.location.findUniqueOrThrow({ where: { id: rejected.id }, select: { published: true } })).published).toBe(false);
    // Published again by the seller, it is back in front of a person.
    await prisma.location.update({ where: { id: rejected.id }, data: { published: true } });
    expect((await loadQueue({}, new Date())).all.some((row) => row.ref === refFor("location", rejected.id))).toBe(true);

    expect(await approveRef({ actor: moderator, ref: refFor("location", approved.id), reason: "AQ4B branch licence seen on file." })).toEqual({ ok: true });
    let view = await loadQueue({}, new Date());
    expect(view.all.some((row) => row.ref === refFor("location", approved.id))).toBe(false);

    await prisma.location.update({ where: { id: approved.id }, data: { emirate: "sharjah", areaId: sharjah.id } });
    view = await loadQueue({}, new Date());
    expect(view.all.some((row) => row.ref === refFor("location", approved.id))).toBe(true);
  });
});

/* ── The queue's health ───────────────────────────────────────────────────── */

describe("median decision time", () => {
  it("is measured from decisions, never claimed", async () => {
    const { ref } = await licenceClaim(await business(), "trade_licence", new Date(Date.now() - 3 * 3_600_000));
    await approveRef({ actor: moderator, ref, reason: "AQ4B decided three hours in." });
    const health = await queueHealth(new Date());
    expect(health.decided).toBeGreaterThan(0);
    expect(health.medianMs).not.toBeNull();
    expect(health.lastDecidedAt).not.toBeNull();
  });
});

/* ── The seller's side ────────────────────────────────────────────────────── */

describe("what the seller reads", () => {
  it("a request reaches the claimant, and withdrawing takes the claim out with a reason", async () => {
    const { withdrawClaim } = await import("@/lib/onboarding/claim");
    const { claimStandingFor } = await import("@/lib/moderation/seller");
    const biz = await business();
    const { claim, claimant, ref } = await licenceClaim(biz, "vat_certificate");
    await requestDocumentsRef({ actor: moderator, ref, reason: "AQ4B send the trade licence, not the VAT certificate." });

    const standing = await claimStandingFor(biz.id, claimant.id);
    expect(standing.request?.reason).toBe("AQ4B send the trade licence, not the VAT certificate.");

    const claimantActor = { ...actor(claimant.id, "buyer", "seller_owner"), businessId: biz.id } satisfies Actor;
    expect(await withdrawClaim(claimantActor, biz.id, "AQ4B withdrawn to send the licence.")).toEqual({ ok: true });
    const row = await prisma.claimSubmission.findUniqueOrThrow({ where: { id: claim.id }, select: { outcome: true, decisionReason: true } });
    expect(row).toEqual({ outcome: "withdrawn", decisionReason: "AQ4B withdrawn to send the licence." });
    expect((await loadQueue({}, new Date())).all.some((entryRow) => entryRow.ref === ref)).toBe(false);
    expect((await claimStandingFor(biz.id, claimant.id)).lastDecision?.outcome).toBe("withdrawn");
  });

  it("an upload answers the requests on a business's pending credentials", async () => {
    const { documentRequestsFor, markDocumentsReceived } = await import("@/lib/moderation/seller");
    const biz = await business();
    const credential = await prisma.document.create({
      data: {
        kind: "certificate",
        businessId: biz.id,
        storagePath: `documents/${biz.id}/aq4b-iso.pdf`,
        filename: "iso.pdf",
        displayName: "ISO 9001:2015",
        isPublic: true,
      },
      select: { id: true },
    });
    const ref = refFor("credential", credential.id);
    expect(await requestDocumentsRef({ actor: moderator, ref, reason: "AQ4B the scan is cut off; send all pages." })).toEqual({ ok: true });
    expect((await documentRequestsFor(biz.id)).map((request) => request.reason)).toEqual(["AQ4B the scan is cut off; send all pages."]);

    expect(await markDocumentsReceived(biz.id)).toBe(1);
    expect(await documentRequestsFor(biz.id)).toEqual([]);
    expect(entry((await loadQueue({}, new Date())).all, ref).docsRequested).toBeNull();
  });
});
