import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  addCredential,
  credentialsStateFor,
  publicCredentialsFor,
  removeCredential,
  suggestionRates,
} from "@/lib/credentials/service";
import { CREDENTIAL_TARGET, SUGGESTION_FLOOR } from "@/lib/credentials/kinds";
import { setupHubState } from "@/lib/setup/service";
import { readEnquiryLift } from "@/lib/metrics/enquiry-lift";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board `8b-s` — credentials, against a database.
 *
 * What a unit test cannot reach: that the CHECK constraint actually refuses an
 * invented verification, that the suggestion rate is computed over verified
 * suppliers and nobody else, that a save with every field blank succeeds, that
 * the public shape cannot carry a document, and that the hub's credentials task
 * now counts `Credential` rows rather than uploaded files.
 */

const PREFIX = "cred-8bs-";

let categoryId: string;
let otherCategoryId: string;
const made: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

/** The uncached lift. `unstable_cache` needs a request and throws without one. */
const hubFor = (businessId: string) => setupHubState(businessId, readEnquiryLift);
const owner = () => actor("cred-owner", "seller_owner");

async function makeSeller(fields?: {
  verified?: boolean;
  published?: boolean;
  category?: string;
}): Promise<string> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-C${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: fields?.category ?? categoryId,
      claimStatus: "claimed",
      sellsKind: "services",
      publishedAt: fields?.published === false ? null : new Date(),
      ...(fields?.verified === false ? {} : { verifiedAt: new Date(), verificationTier: 2 }),
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

beforeAll(async () => {
  const [first, second] = await prisma.category.findMany({
    take: 2,
    orderBy: { id: "asc" },
    select: { id: true },
  });
  categoryId = first!.id;
  otherCategoryId = second?.id ?? first!.id;
});

afterAll(async () => {
  await prisma.credential.deleteMany({ where: { businessId: { in: made } } });
  await prisma.document.deleteMany({ where: { businessId: { in: made } } });
  await prisma.business.deleteMany({ where: { id: { in: made } } });
});

describe("nothing on this screen is required — B1, AC1", () => {
  it("saves a credential with no number, no issuer, no expiry and no file", async () => {
    const id = await makeSeller();
    const saved = await addCredential(owner(), id, { kind: "indemnity_insurance" });

    expect(saved.ok).toBe(true);
    const state = await credentialsStateFor(id);
    expect(state!.held).toHaveLength(1);
    expect(state!.held[0]!.identifier).toBeNull();
    expect(state!.held[0]!.issuer).toBeNull();
    expect(state!.held[0]!.expiresOn).toBeNull();
    expect(state!.held[0]!.document).toBeNull();
  });

  it("refuses only a kind that is not a kind", async () => {
    const id = await makeSeller();
    const saved = await addCredential(owner(), id, { kind: "trade_licence" });
    expect(saved).toEqual({ ok: false, reason: "unknown_kind" });
  });
});

describe("the tier is the system's — B3, AC3", () => {
  it("saves an FTA number as a claim and says why, rather than blocking — Q2, AC10", async () => {
    const id = await makeSeller();
    const saved = await addCredential(owner(), id, {
      kind: "fta_tax_agent",
      identifier: "20034512",
    });

    expect(saved.ok).toBe(true);
    expect(saved.ok && saved.trust).toBe("seller_claim");
    // No register is configured on this platform, so this is the honest answer
    // and it is the one the screen prints inline.
    expect(saved.ok && saved.registerNote).toBe("register_unavailable");
  });

  it("has no input that could carry a tier, and the database refuses one anyway", async () => {
    const id = await makeSeller();
    /*
       `CredentialInput` has no `trust` field, so the only way to reach this
       state is a direct write — and the CHECK stops that too. A verified row
       with nothing recording who verified it is the shape a forged badge takes.
    */
    await expect(
      prisma.credential.create({
        data: { businessId: id, kind: "other", trust: "register_verified" },
      }),
    ).rejects.toThrow(/credential_verified_has_a_register/);
  });

  it("refuses a claim that carries a verification date", async () => {
    const id = await makeSeller();
    await expect(
      prisma.credential.create({
        data: {
          businessId: id,
          kind: "other",
          trust: "seller_claim",
          verifiedOn: new Date(),
          verifiedBy: "nobody",
        },
      }),
    ).rejects.toThrow(/credential_verified_has_a_register/);
  });
});

describe("the trade licence is read, never re-asked — B4, AC4", () => {
  it("returns the licence from the business row and not as a credential", async () => {
    const id = await makeSeller();
    const state = await credentialsStateFor(id);

    expect(state!.licence.number).toMatch(/^DED-C/);
    expect(state!.licence.authority).toBe("DED");
    expect(state!.licence.verifiedOn).not.toBeNull();
    expect(state!.held).toHaveLength(0);
  });

  it("says the licence is unchecked when no ops lead has looked at it", async () => {
    const id = await makeSeller({ verified: false });
    const state = await credentialsStateFor(id);
    expect(state!.licence.verifiedOn).toBeNull();
  });
});

describe("suggestions are evidenced — B6, AC6", () => {
  it("counts verified suppliers in the subcategory and nobody else", async () => {
    const category = otherCategoryId;
    const holders = await Promise.all([
      makeSeller({ category }),
      makeSeller({ category }),
      makeSeller({ category }),
    ]);
    for (const id of holders) {
      await addCredential(owner(), id, { kind: "mof_audit_approval" });
    }
    // A fourth verified supplier that holds nothing, so the rate is 3 in 4.
    await makeSeller({ category });
    /*
       And two who must not reach the denominator: an unclaimed import holds no
       credentials and never will, so counting it would drag every rate toward
       zero and suppress every row — a number wrong in the direction of saying
       nothing at all.
    */
    await makeSeller({ category, verified: false });
    await makeSeller({ category, published: false });

    const rates = await suggestionRates(category);
    const mof = rates.find((row) => row.kind === "mof_audit_approval")!;

    expect(mof.peers).toBe(4);
    expect(mof.holders).toBe(3);
    expect(mof.rate).toBeCloseTo(0.75, 5);
  });

  it("counts a supplier once however many rows of one kind they hold", async () => {
    const category = otherCategoryId;
    const before = (await suggestionRates(category)).find(
      (row) => row.kind === "professional_body",
    )!;

    const id = await makeSeller({ category });
    await addCredential(owner(), id, { kind: "professional_body", issuer: "ACCA" });
    await addCredential(owner(), id, { kind: "professional_body", issuer: "ICAEW" });

    const after = (await suggestionRates(category)).find(
      (row) => row.kind === "professional_body",
    )!;

    expect(after.peers).toBe(before.peers + 1);
    expect(after.holders).toBe(before.holders + 1);
  });

  it("suppresses a kind the seller already holds, and one below the floor", async () => {
    const id = await makeSeller();
    await addCredential(owner(), id, { kind: "mof_audit_approval" });

    const state = await credentialsStateFor(id);
    expect(state!.suggestions.map((row) => row.kind)).not.toContain("mof_audit_approval");
    for (const row of state!.suggestions) {
      expect(row.rate).toBeGreaterThanOrEqual(SUGGESTION_FLOOR);
    }
  });
});

describe("documents are private — B10, AC9", () => {
  it("never selects the document on the buyer's shape", async () => {
    const id = await makeSeller();
    const document = await prisma.document.create({
      data: {
        businessId: id,
        kind: "certificate",
        storagePath: `${id}/certificate/secret.pdf`,
        filename: "secret.pdf",
      },
      select: { id: true },
    });
    await addCredential(owner(), id, {
      kind: "professional_body",
      issuer: "ACCA",
      documentId: document.id,
    });

    const [row] = await publicCredentialsFor(id);
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain("secret.pdf");
    expect(JSON.stringify(row)).not.toContain(document.id);
    expect(Object.keys(row!)).not.toContain("documentId");
  });

  it("drops a document id belonging to somebody else rather than linking it", async () => {
    const [mine, theirs] = await Promise.all([makeSeller(), makeSeller()]);
    const document = await prisma.document.create({
      data: {
        businessId: theirs,
        kind: "certificate",
        storagePath: `${theirs}/certificate/theirs.pdf`,
        filename: "theirs.pdf",
      },
      select: { id: true },
    });

    const saved = await addCredential(owner(), mine, {
      kind: "other",
      documentId: document.id,
    });
    expect(saved.ok).toBe(true);

    const state = await credentialsStateFor(mine);
    expect(state!.held[0]!.document).toBeNull();
  });
});

describe("the hub counts credentials — `8a-s` task 1", () => {
  it("ticks task 1 on two rows, and an uploaded certificate alone does not", async () => {
    const id = await makeSeller();

    // The old counter was `Document(kind: certificate)`. Two files and no
    // credentials must now leave the task open.
    await prisma.document.createMany({
      data: [0, 1].map((n) => ({
        businessId: id,
        kind: "certificate" as const,
        storagePath: `${id}/certificate/file-${n}.pdf`,
        filename: `file-${n}.pdf`,
      })),
    });

    const before = await hubFor(id);
    expect(before!.tasks.find((task) => task.id === "credentials")!.done).toBe(false);

    await addCredential(owner(), id, { kind: "mof_audit_approval" });
    await addCredential(owner(), id, { kind: "indemnity_insurance" });

    const after = await hubFor(id);
    const task = after!.tasks.find((row) => row.id === "credentials")!;
    expect(task.done).toBe(true);
    expect(task.progress).toEqual({ got: CREDENTIAL_TARGET, target: CREDENTIAL_TARGET });
    // And the card is the one the sidebar reads its 32 from.
    expect(task.lever).toBe("credentials");
  });

  it("keeps counting a credential that has expired — B5, AC5", async () => {
    const id = await makeSeller();
    await addCredential(owner(), id, {
      kind: "mof_audit_approval",
      expiresOn: "2020-01-01",
    });
    await addCredential(owner(), id, { kind: "other" });

    const hub = await hubFor(id);
    expect(hub!.tasks.find((task) => task.id === "credentials")!.done).toBe(true);
  });
});

describe("removing", () => {
  it("removes the seller's own row and refuses one that is not theirs", async () => {
    const [mine, theirs] = await Promise.all([makeSeller(), makeSeller()]);
    const saved = await addCredential(owner(), mine, { kind: "other" });
    expect(saved.ok).toBe(true);

    const wrongOwner = await removeCredential(owner(), theirs, saved.ok ? saved.id : "");
    expect(wrongOwner.ok).toBe(false);

    const gone = await removeCredential(owner(), mine, saved.ok ? saved.id : "");
    expect(gone.ok).toBe(true);
    expect((await credentialsStateFor(mine))!.held).toHaveLength(0);
  });
});
