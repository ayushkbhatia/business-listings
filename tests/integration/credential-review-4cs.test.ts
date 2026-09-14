import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { FIXTURE_FIRMS, type FixtureFirm } from "@/lib/credentials/fta-fixture";
import { REGISTER_FRESH_MS } from "@/lib/credentials/register-fetch";
import {
  refetchRegister,
  rejectCredential,
  requestClearerDocument,
  resubmitCredential,
  retryRegisterReads,
  verifyCredential,
} from "@/lib/credentials/review";
import { addCredential, credentialsStateFor, publicCredentialsFor } from "@/lib/credentials/service";
import { approveRef, bulkApprove, bulkReject, bulkRequestDocuments } from "@/lib/moderation/decide";
import { loadQueue, queueHealth, refFor } from "@/lib/moderation/queue";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board `4c-s` — a credential reviewed against the register, on a real database.
 *
 * The register is the fixture one (`FTA_REGISTER_URL=fixture`, honoured because
 * this database is loopback), so every state the board lists is reached the way
 * production would reach it: a seller saves an agent number, the read runs, and
 * the machine settles it or a person does.
 */

const PREFIX = "cr4cs-";
const DAY = 86_400_000;
const REASON = "CR4CS checked against the register";

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
const owner = actor("cr4cs-owner", "seller_owner");

let ops: Actor;
let moderator: Actor;
let categoryId: string;
let seq = 0;
const previousRegister = process.env.FTA_REGISTER_URL;

function firm(state: FixtureFirm["state"]): FixtureFirm {
  return FIXTURE_FIRMS.find((row) => row.state === state)!;
}

async function sellerFor(row: FixtureFirm, over: { published?: boolean } = {}): Promise<string> {
  seq += 1;
  const created = await prisma.business.create({
    data: {
      tradeName: row.tradeName,
      displayName: `${row.tradeName.replace(/ LLC$/, "")} ${seq}`,
      slug: `${PREFIX}${Date.now().toString(36)}${seq}`,
      licenceNumber: row.licence,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * DAY),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      sellsKind: "services",
      publishedAt: over.published === false ? null : new Date(),
    },
    select: { id: true },
  });
  return created.id;
}

async function save(row: FixtureFirm, expires?: string, withDocument = true) {
  const businessId = await sellerFor(row);
  const document = withDocument
    ? await prisma.document.create({
        data: { businessId, kind: "certificate", storagePath: `${businessId}/certificate/fta.pdf`, filename: "fta.pdf" },
        select: { id: true },
      })
    : null;
  const saved = await addCredential(owner, businessId, {
    kind: "fta_tax_agent",
    identifier: row.taan,
    issuer: "Federal Tax Authority",
    expiresOn: expires ?? "",
    documentId: document?.id ?? null,
  });
  if (!saved.ok) throw new Error("save refused");
  return { businessId, credentialId: saved.id, saved };
}

async function credential(id: string) {
  return prisma.credential.findUniqueOrThrow({ where: { id } });
}

async function removeFixtures() {
  const businesses = await prisma.business.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  const ids = businesses.map((row) => row.id);
  if (ids.length === 0) return;
  const credentials = await prisma.credential.findMany({ where: { businessId: { in: ids } }, select: { id: true } });
  await purgeAuditRows({ subject: { in: credentials.map((row) => `Credential:${row.id}`) } });
  await prisma.queueItem.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  process.env.FTA_REGISTER_URL = "fixture";
  const staff = await prisma.user.findMany({
    where: { roles: { hasSome: ["staff_ops_lead", "staff_moderator"] } },
    orderBy: { id: "asc" },
    select: { id: true, roles: true },
  });
  ops = actor(staff.find((u) => u.roles.includes("staff_ops_lead"))!.id, "staff_ops_lead");
  moderator = actor(staff.find((u) => u.roles.includes("staff_moderator"))!.id, "staff_moderator");
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: "vat-and-tax" }, select: { id: true } })).id;
  await removeFixtures();
});

afterEach(() => {
  process.env.FTA_REGISTER_URL = "fixture";
});

afterAll(async () => {
  await removeFixtures();
  if (previousRegister === undefined) delete process.env.FTA_REGISTER_URL;
  else process.env.FTA_REGISTER_URL = previousRegister;
});

describe("the machine settles what it can", () => {
  it("verifies at submission where all three match and the licence is the same entity — no person, no queue", async () => {
    const { credentialId, saved } = await save(firm("match"), "2027-12-31");
    expect(saved.ok && saved.trust).toBe("register_verified");
    expect(saved.ok && saved.registerNote).toBeNull();

    const row = await credential(credentialId);
    expect(row.review).toBe("auto_verified");
    expect(row.reviewedById).toBeNull();
    expect(row.verifiedBy).toBe("FTA tax agent register");
    expect((row.registerFetch as { outcome: string }).outcome).toBe("found");

    const queue = await loadQueue({ kind: "credential" });
    expect(queue.rows.some((entry) => entry.id === credentialId)).toBe(false);
  });

  it("queues what did not match, with the note the seller reads (8b-s AC10 kept)", async () => {
    const near = await save(firm("near_match"));
    expect(near.saved.ok && near.saved.registerNote).toBe("mismatch");
    const missing = await save(firm("not_found"));
    expect(missing.saved.ok && missing.saved.registerNote).toBe("not_found");
    const down = await save(firm("unreachable"));
    expect(down.saved.ok && down.saved.registerNote).toBe("register_retry");

    const queue = await loadQueue({ kind: "credential" });
    for (const id of [near.credentialId, missing.credentialId, down.credentialId]) {
      const entry = queue.rows.find((row) => row.id === id);
      expect(entry?.subject).toBe("register_credential");
      expect(entry?.href).toBe(`/admin/queue/credential/${id}`);
      expect(entry?.allPassed).toBe(false);
    }
    // One chip: the credential count is every row under it, documents and register checks together.
    expect(queue.counts.credential).toBe(queue.rows.length);
  });

  it("with no register connected nothing enters review, and the seller is told it is a claim", async () => {
    delete process.env.FTA_REGISTER_URL;
    const { credentialId, saved } = await save(firm("near_match"));
    expect(saved.ok && saved.registerNote).toBe("register_unavailable");
    expect((await credential(credentialId)).review).toBeNull();
  });

  it("the sweep retries a read the register did not answer, and verifies where it now matches", async () => {
    const { credentialId } = await save(firm("match"), "2027-12-31");
    // As if the first read had timed out an hour ago.
    await prisma.credential.update({
      where: { id: credentialId },
      data: {
        trust: "seller_claim",
        verifiedOn: null,
        verifiedBy: null,
        review: "pending",
        registerFetch: {
          v: 1,
          asked: "20034512",
          fetchedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
          source: "FTA tax agent register",
          outcome: "unavailable",
          cause: "timeout",
        },
        registerFetchedAt: new Date(Date.now() - 2 * 3_600_000),
      },
    });
    const outcome = await retryRegisterReads(new Date(), 500);
    expect(outcome.verified).toBeGreaterThanOrEqual(1);
    const row = await credential(credentialId);
    expect(row.review).toBe("auto_verified");
    expect(row.trust).toBe("register_verified");
  });
});

describe("a person decides the review, never the tier", () => {
  it("B3: verify is refused against a disagreement and against a stale read", async () => {
    const near = await save(firm("near_match"));
    expect(await verifyCredential({ actor: moderator, credentialId: near.credentialId, reason: REASON })).toEqual({
      ok: false,
      error: "register_disagrees",
    });

    const { credentialId } = await save(firm("match"), "2027-12-31");
    // A match that a person must decide: the read is old.
    await prisma.credential.update({
      where: { id: credentialId },
      data: {
        trust: "seller_claim",
        verifiedOn: null,
        verifiedBy: null,
        review: "pending",
        registerFetchedAt: new Date(Date.now() - REGISTER_FRESH_MS - 60_000),
        registerFetch: {
          v: 1,
          asked: "20034512",
          fetchedAt: new Date(Date.now() - REGISTER_FRESH_MS - 60_000).toISOString(),
          source: "FTA tax agent register",
          outcome: "found",
          record: firm("match").record!,
        },
      },
    });
    expect(await verifyCredential({ actor: ops, credentialId, reason: REASON })).toEqual({ ok: false, error: "register_unread" });

    // The refetch is evidence only: it verifies nothing and writes no audit row.
    expect(await refetchRegister({ actor: ops, credentialId })).toEqual({ ok: true });
    const refetched = await credential(credentialId);
    expect(refetched.review).toBe("pending");
    expect(refetched.trust).toBe("seller_claim");
    expect(await prisma.auditEvent.count({ where: { subject: `Credential:${credentialId}` } })).toBe(0);

    expect(await verifyCredential({ actor: ops, credentialId, reason: REASON })).toEqual({ ok: true });
    const verified = await credential(credentialId);
    expect(verified.review).toBe("verified");
    expect(verified.trust).toBe("register_verified");
    expect(verified.reviewedById).toBe(ops.id);

    // B11: the audit row carries the reviewer's words and the register's answer.
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { subject: `Credential:${credentialId}` } });
    expect(audit.action).toBe("queue_decided");
    expect(audit.reason).toBe(REASON);
    expect((audit.after as { registerFetch: { outcome: string } }).registerFetch.outcome).toBe("found");
  });

  it("B5: a rejection carries one of the four reasons, and only one the read supports", async () => {
    const lapsed = await save(firm("lapsed"));
    expect(
      await rejectCredential({ actor: moderator, credentialId: lapsed.credentialId, reason: REASON, rejectReason: "not_on_register" }),
    ).toEqual({ ok: false, error: "reason_unsupported" });
    expect(
      await rejectCredential({ actor: moderator, credentialId: lapsed.credentialId, reason: REASON, rejectReason: "lapsed" }),
    ).toEqual({ ok: true });
    const row = await credential(lapsed.credentialId);
    expect(row.review).toBe("rejected");
    expect(row.rejectReason).toBe("lapsed");
    expect(row.trust).toBe("seller_claim");

    // Off the storefront and out of the counts; still on the seller's own screen, with the reason.
    expect((await publicCredentialsFor(lapsed.businessId)).length).toBe(0);
    const state = await credentialsStateFor(lapsed.businessId);
    expect(state?.held[0]?.rejectReason).toBe("lapsed");

    const unreadable = await save(firm("different_entity"), undefined, false);
    expect(
      await rejectCredential({ actor: moderator, credentialId: unreadable.credentialId, reason: REASON, rejectReason: "unreadable" }),
    ).toEqual({ ok: false, error: "reason_unsupported" });
  });

  it("the database refuses a review state on a kind no register answers for (B1)", async () => {
    const businessId = await sellerFor(firm("match"));
    await expect(
      prisma.credential.create({
        data: { businessId, kind: "indemnity_insurance", review: "pending", reviewOpenedAt: new Date() },
      }),
    ).rejects.toThrow(/credential_review_only_checkable/);
    await expect(
      prisma.credential.create({
        data: { businessId, kind: "fta_tax_agent", review: "rejected", reviewOpenedAt: new Date(), reviewedAt: new Date(), reviewNote: "x x x x" },
      }),
    ).rejects.toThrow(/credential_rejection_says_why/);
  });

  it("B6: a request for a clearer document is a state, the clock keeps running, and the seller's answer is read again", async () => {
    const summit = await save(firm("more_info"), "2027-12-31");
    const opened = (await credential(summit.credentialId)).reviewOpenedAt!;
    expect(await requestClearerDocument({ actor: moderator, credentialId: summit.credentialId, reason: "Upload the current certificate" })).toEqual({ ok: true });

    const queue = await loadQueue({ kind: "credential" });
    const entry = queue.rows.find((row) => row.id === summit.credentialId)!;
    expect(entry.docsRequested?.reason).toBe("Upload the current certificate");
    expect(entry.late).toBe(false);

    const standing = await credentialsStateFor(summit.businessId);
    expect(standing?.held[0]?.review).toBe("more_info");

    const answered = await resubmitCredential(owner, summit.businessId, summit.credentialId, {
      identifier: "20040619",
      expiresOn: "2028-01-31",
      documentId: null,
    });
    expect(answered).toMatchObject({ ok: true, review: "auto_verified" });
    const row = await credential(summit.credentialId);
    expect(row.reviewOpenedAt!.getTime()).toBe(opened.getTime());
    expect(row.trust).toBe("register_verified");
  });

  it("a resubmission after a rejection is new work, and starts its own clock", async () => {
    const missing = await save(firm("not_found"));
    await rejectCredential({ actor: moderator, credentialId: missing.credentialId, reason: REASON, rejectReason: "not_on_register" });
    const before = (await credential(missing.credentialId)).reviewOpenedAt!;
    const again = await resubmitCredential(owner, missing.businessId, missing.credentialId, {
      identifier: "20099882",
      expiresOn: "",
      documentId: null,
    });
    expect(again).toMatchObject({ ok: true, review: "pending" });
    const row = await credential(missing.credentialId);
    expect(row.rejectReason).toBeNull();
    expect(row.reviewOpenedAt!.getTime()).toBeGreaterThan(before.getTime());

    // Only an open request or a rejection can be answered.
    expect(await resubmitCredential(owner, missing.businessId, missing.credentialId, { identifier: "1", expiresOn: "", documentId: null })).toEqual({
      ok: false,
      reason: "not_open",
    });
  });

  it("only a seat that works the queue decides", async () => {
    const near = await save(firm("near_match"));
    await expect(
      verifyCredential({ actor: actor("cr4cs-seller", "seller_owner"), credentialId: near.credentialId, reason: REASON }),
    ).rejects.toThrow(PermissionError);
  });
});

describe("through the queue", () => {
  it("bulk approve skips a disagreement, bulk reject needs a reason code, bulk request works", async () => {
    const near = await save(firm("near_match"));
    const ref = refFor("register_credential", near.credentialId);

    expect((await bulkApprove({ actor: ops, refs: [ref], reason: REASON })).skipped).toEqual([{ ref, error: "not_eligible" }]);
    expect((await bulkReject({ actor: ops, refs: [ref], reason: REASON })).skipped).toEqual([{ ref, error: "reason_code_required" }]);
    expect(await approveRef({ actor: ops, ref, reason: REASON })).toEqual({ ok: false, error: "register_disagrees" });

    const requested = await bulkRequestDocuments({ actor: ops, refs: [ref], reason: "Send the certificate naming the firm" });
    expect(requested.done).toEqual([ref]);
    expect((await credential(near.credentialId)).review).toBe("more_info");
  });

  it("a person's decision counts toward the median; the machine's does not", async () => {
    const before = await queueHealth();
    const lapsed = await save(firm("lapsed"));
    await rejectCredential({ actor: moderator, credentialId: lapsed.credentialId, reason: REASON, rejectReason: "lapsed" });
    await save(firm("match"), "2027-12-31");
    const after = await queueHealth();
    expect(after.decided).toBe(before.decided + 1);
  });
});
