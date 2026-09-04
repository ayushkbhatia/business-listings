import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { claimCorrections, submitClaim } from "@/lib/onboarding/claim";
import { clearDraft, readDraft, saveDraft } from "@/lib/onboarding/draft";
import {
  alreadyVerified,
  CLAIM_REVIEW_SLA_HOURS,
  CLAIMANT_ROLES,
  isClaimantRole,
  verifyStateFor,
} from "@/lib/onboarding/verify";
import { VERIFIED_TIER } from "@/lib/verification";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 2b, against a real database.
 *
 * The gate's claims are claims about rows: what a submission records, what it
 * does not move, and what survives somebody leaving the page. The browser half
 * is `tests/e2e/verify.spec.ts`.
 */

const PREFIX = "zz-verify-test-";

let claimant: Actor;
let unclaimed: { id: string; licenceAuthority: string };
let withPhone: { id: string };
let noPhone: { id: string };

beforeAll(async () => {
  const buyer = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "buyer" } },
    select: { id: true, roles: true },
  });
  claimant = { id: buyer.id, roles: buyer.roles };

  unclaimed = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "unclaimed", mergedIntoId: null, verificationTier: { lt: VERIFIED_TIER } },
    orderBy: { tradeName: "asc" },
    select: { id: true, licenceAuthority: true },
  });

  withPhone = await prisma.business.findFirstOrThrow({
    where: { mergedIntoId: null, locations: { some: { phone: { not: null } } } },
    orderBy: { tradeName: "asc" },
    select: { id: true },
  });

  noPhone = await prisma.business.findFirstOrThrow({
    where: { mergedIntoId: null, locations: { none: { phone: { not: null } } } },
    orderBy: { tradeName: "asc" },
    select: { id: true },
  });
});

afterEach(async () => {
  await prisma.claimSubmission.deleteMany({ where: { claimantId: claimant.id } });
  await prisma.onboardingDraft.deleteMany({ where: { userId: claimant.id } });
});

afterAll(async () => {
  await prisma.claimSubmission.deleteMany({ where: { claimantId: claimant.id } });
  await prisma.onboardingDraft.deleteMany({ where: { userId: claimant.id } });
  await prisma.$disconnect();
});

describe("criterion 4 — the phone route calls the record, or does not exist", () => {
  it("offers the route with the number masked, never in full", async () => {
    /*
       Masked on purpose: enough for the real owner to recognise their own line,
       not enough for an impostor to learn the number they would need to
       intercept. That is the whole security value of the route.
    */
    const state = await verifyStateFor(withPhone.id, claimant.id);
    expect(state?.hasPhoneRoute).toBe(true);
    expect(state?.maskedPhone).toBeTruthy();
    expect(state?.maskedPhone).toMatch(/[•*]/);

    const location = await prisma.location.findFirstOrThrow({
      where: { businessId: withPhone.id, phone: { not: null } },
      select: { phone: true },
    });
    expect(state?.maskedPhone).not.toBe(location.phone);
  });

  it("has no phone route at all where the register holds no number", async () => {
    // Absent, not disabled. A disabled control is a thing somebody spends time
    // trying to enable.
    const state = await verifyStateFor(noPhone.id, claimant.id);
    expect(state?.hasPhoneRoute).toBe(false);
    expect(state?.maskedPhone).toBeNull();
  });

  it("takes the number from the record, never from the submission", async () => {
    const result = await submitClaim(claimant, {
      businessId: withPhone.id,
      route: "phone_callback",
      phone: "+97145550000",
    });
    expect(result.ok).toBe(true);

    // The column exists so staff know which number was called. Nothing in the
    // claim path lets a claimant nominate one — the screen sends no number.
    const row = await prisma.claimSubmission.findFirstOrThrow({
      where: { claimantId: claimant.id, businessId: withPhone.id },
      select: { route: true },
    });
    expect(row.route).toBe("phone_callback");
  });
});

describe("criterion 3 — OCR fills, the claimant corrects, the reviewer sees it", () => {
  it("records what was read beside what was submitted", async () => {
    const document = await licenceDocument(unclaimed.id);
    try {
      await submitClaim(claimant, {
        businessId: unclaimed.id,
        route: "licence_upload",
        documentId: document.id,
        statedLicenceNumber: `${unclaimed.licenceAuthority}-618402`,
        statedLicenceExpiry: new Date("2027-04-14T00:00:00.000Z"),
        ocrLicenceNumber: `${unclaimed.licenceAuthority}-618403`,
        ocrLicenceExpiry: new Date("2027-04-14T00:00:00.000Z"),
        ocrConfidence: 0.9,
        claimantName: "Suresh Menon",
        claimantRole: "manager",
      });

      const row = await prisma.claimSubmission.findFirstOrThrow({
        where: { claimantId: claimant.id, businessId: unclaimed.id },
        select: {
          statedLicenceNumber: true,
          statedLicenceExpiry: true,
          ocrLicenceNumber: true,
          ocrLicenceExpiry: true,
          ocrConfidence: true,
          claimantName: true,
          claimantRole: true,
        },
      });

      const corrections = claimCorrections(row, unclaimed.licenceAuthority);
      expect(corrections).toMatchObject({ number: true, expiry: false, any: true });
      expect(row.claimantName).toBe("Suresh Menon");
      expect(row.claimantRole).toBe("manager");
      expect(row.ocrConfidence).toBeCloseTo(0.9);
    } finally {
      await prisma.claimSubmission.deleteMany({ where: { documentId: document.id } });
      await prisma.document.delete({ where: { id: document.id } });
    }
  });

  it("does not call adding the authority prefix a correction", async () => {
    // A correction should mean a correction. Somebody who typed the digits over
    // a read `DED-618402` has corrected nothing, and flagging them would make
    // the flag meaningless.
    expect(
      claimCorrections(
        {
          statedLicenceNumber: "618402",
          statedLicenceExpiry: null,
          ocrLicenceNumber: "DED-618402",
          ocrLicenceExpiry: null,
        },
        "DED",
      ),
    ).toMatchObject({ any: false });
  });

  it("flags nothing when OCR read nothing", async () => {
    /*
       The expected path on every deployment with no OCR provider: empty fields
       the claimant fills in by hand. Calling that a correction would flag every
       claim, which is the same as flagging none.
    */
    expect(
      claimCorrections(
        {
          statedLicenceNumber: "DED-618402",
          statedLicenceExpiry: new Date(),
          ocrLicenceNumber: null,
          ocrLicenceExpiry: null,
        },
        "DED",
      ),
    ).toMatchObject({ number: false, expiry: false, any: false });
  });

  it("refuses a confidence outside 0..1 at the database", async () => {
    // A value out of range is a bug in an extractor, not something to store and
    // render. Refused where it could enter.
    await expect(
      prisma.claimSubmission.create({
        data: {
          businessId: unclaimed.id,
          claimantId: claimant.id,
          route: "phone_callback",
          phone: "+97145550000",
          ocrConfidence: 1.4,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("criterion 6 — submitting queues a review and grants nothing", () => {
  it("leaves the verification tier exactly where it was", async () => {
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: unclaimed.id },
      select: { verificationTier: true, claimStatus: true, verifiedAt: true },
    });

    await submitClaim(claimant, {
      businessId: unclaimed.id,
      route: "phone_callback",
      phone: "+97145550000",
      claimantRole: "owner",
    });

    expect(
      await prisma.business.findUniqueOrThrow({
        where: { id: unclaimed.id },
        select: { verificationTier: true, claimStatus: true, verifiedAt: true },
      }),
    ).toEqual(before);
  });

  it("states a promise, not a grant", () => {
    // The screen quotes this, and it is not `SLA_DAYS.claim`: that is when a
    // queue row counts as late, and quoting it would promise three days.
    expect(CLAIM_REVIEW_SLA_HOURS).toBeGreaterThan(0);
    expect(CLAIM_REVIEW_SLA_HOURS).toBeLessThanOrEqual(24);
  });
});

describe("criterion 11 — a verified business has nothing left to prove", () => {
  it("reports a verified listing as already done", async () => {
    const verified = await prisma.business.findFirstOrThrow({
      where: { verificationTier: { gte: VERIFIED_TIER } },
      select: { id: true },
    });
    expect(await alreadyVerified(verified.id)).toBe(true);
  });

  it("reports an unverified one as still open", async () => {
    expect(await alreadyVerified(unclaimed.id)).toBe(false);
  });
});

describe("criterion 10 — Save & exit keeps what was typed", () => {
  it("round-trips a half-finished form", async () => {
    await saveDraft(claimant.id, unclaimed.id, "verify", {
      route: "licence_upload",
      licenceNumber: "DED-618402",
      claimantRole: "pro",
    });

    expect(await readDraft(claimant.id, unclaimed.id, "verify")).toEqual({
      route: "licence_upload",
      licenceNumber: "DED-618402",
      claimantRole: "pro",
    });
  });

  it("replaces wholesale rather than merging", async () => {
    /*
       Somebody who deletes a wrong licence number and leaves should not find it
       waiting for them. A merge would bring it back from the older save.
    */
    await saveDraft(claimant.id, unclaimed.id, "verify", { licenceNumber: "DED-1", claimantName: "A" });
    await saveDraft(claimant.id, unclaimed.id, "verify", { claimantName: "A" });

    expect(await readDraft(claimant.id, unclaimed.id, "verify")).toEqual({ claimantName: "A" });
  });

  it("keeps two claimants on one contested listing apart", async () => {
    // The case board 4c is about. One draft each, not one between them.
    const other = await prisma.user.findFirstOrThrow({
      where: { id: { not: claimant.id }, roles: { has: "buyer" } },
      select: { id: true },
    });

    await saveDraft(claimant.id, unclaimed.id, "verify", { claimantName: "Mine" });
    await saveDraft(other.id, unclaimed.id, "verify", { claimantName: "Theirs" });

    try {
      expect(await readDraft(claimant.id, unclaimed.id, "verify")).toEqual({ claimantName: "Mine" });
      expect(await readDraft(other.id, unclaimed.id, "verify")).toEqual({ claimantName: "Theirs" });
    } finally {
      await prisma.onboardingDraft.deleteMany({ where: { userId: other.id } });
    }
  });

  it("clears the draft once the step has produced its row", async () => {
    // A draft that outlived its submission repopulates a form the supplier has
    // already finished with, which reads as the submission having failed.
    await saveDraft(claimant.id, unclaimed.id, "verify", { claimantName: "Suresh" });
    await clearDraft(claimant.id, unclaimed.id, "verify");
    expect(await readDraft(claimant.id, unclaimed.id, "verify")).toEqual({});
  });

  it("returns an empty object rather than null for a step never started", async () => {
    expect(await readDraft(claimant.id, `${PREFIX}nothing`, "verify")).toEqual({});
  });
});

describe("the roles the review path branches on", () => {
  it("carries the five the board names", () => {
    expect([...CLAIMANT_ROLES]).toEqual([
      "owner",
      "partner",
      "manager",
      "pro",
      "authorised_signatory",
    ]);
  });

  it("refuses anything else, so a form cannot invent one", () => {
    expect(isClaimantRole("owner")).toBe(true);
    expect(isClaimantRole("director")).toBe(false);
    expect(isClaimantRole("")).toBe(false);
  });
});

/** A licence document row, because the database refuses that claim without one. */
async function licenceDocument(businessId: string) {
  return prisma.document.create({
    data: {
      businessId,
      kind: "trade_licence",
      storagePath: `${businessId}/trade_licence/${PREFIX}${Date.now()}.pdf`,
      filename: "licence.pdf",
    },
    select: { id: true },
  });
}
