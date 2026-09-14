import type { Prisma, PrismaClient } from "../lib/db/generated/client.js";
import { FIXTURE_FIRMS, type FixtureFirm } from "../lib/credentials/fta-fixture.js";

/**
 * Board 4c-s — one FTA credential per state the board lists.
 *
 * The queue could not hold one before: no register is connected, so every
 * agent number on the platform saved as a claim and nothing entered review.
 * These are built from `lib/credentials/fta-fixture.ts`, the stand-in register
 * the review screen reads with `FTA_REGISTER_URL=fixture`, so each firm's trade
 * name and licence differ from the register exactly where its state needs them
 * to — and a refetch on the screen returns the same answer the seed stored.
 *
 * **What the machine settled is not here.** A credential that matches on all
 * three and names the same licence is verified at submission and never reaches
 * a person, so the "as drawn" firm arrives the realistic way: its first read
 * timed out, and a reviewer who fetches again finds everything matches.
 *
 * **New listings, never published** — board 4b's reason: a published listing
 * moves directory counts a dozen e2e files pin, and a credential on an existing
 * firm changes a setup task another board's acceptance shard counts.
 *
 * **The wall clock, not the seed's day anchor.** A register read is only
 * decided against within the hour, and a read stamped at noon on a seed run at
 * two in the morning would be ten hours in the future.
 */

type Db = PrismaClient;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export async function seedCredentialReview(db: Db): Promise<void> {
  console.log("→ credential reviews against the FTA register, for board 4c-s");

  const now = new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);

  const [opsLead, moderator, category] = await Promise.all([
    db.user.findFirst({ where: { roles: { has: "staff_ops_lead" } }, orderBy: { id: "asc" }, select: { id: true } }),
    db.user.findFirst({ where: { roles: { has: "staff_moderator" } }, orderBy: { id: "asc" }, select: { id: true } }),
    db.category.findFirst({ where: { slug: "vat-and-tax" }, select: { id: true } }),
  ]);
  if (!opsLead || !moderator || !category) return;

  const read = (firm: FixtureFirm, at: Date, outcome?: "timeout") =>
    (outcome === "timeout"
      ? { v: 1, asked: firm.taan, fetchedAt: at.toISOString(), source: "FTA tax agent register", outcome: "unavailable", cause: "timeout" }
      : firm.record
        ? { v: 1, asked: firm.taan, fetchedAt: at.toISOString(), source: "FTA tax agent register", outcome: "found", record: firm.record }
        : { v: 1, asked: firm.taan, fetchedAt: at.toISOString(), source: "FTA tax agent register", outcome: "not_found" }) as Prisma.InputJsonValue;

  const firm = (state: FixtureFirm["state"]) => FIXTURE_FIRMS.find((row) => row.state === state)!;

  let serial = 0;
  async function listing(row: FixtureFirm, openedAgo: number) {
    serial += 1;
    return db.business.create({
      data: {
        tradeName: row.tradeName,
        displayName: row.tradeName.replace(/ LLC$/, ""),
        slug: `credential-review-${serial}-${row.tradeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        licenceNumber: row.licence,
        licenceAuthority: "DED",
        licenceExpiry: new Date(now.getTime() + 300 * DAY),
        licenceActivity: "Tax consultancy; accounting and bookkeeping",
        primaryCategoryId: category!.id,
        claimStatus: "claimed",
        source: "licence_import",
        verificationTier: 0,
        publishedAt: null,
        createdAt: ago(openedAgo + 30 * DAY),
      },
      select: { id: true },
    });
  }

  async function certificate(businessId: string, filename: string, at: Date) {
    return db.document.create({
      data: {
        businessId,
        kind: "certificate",
        storagePath: `${businessId}/certificate/${filename}`,
        filename,
        bytes: 1_240_000,
        mimeType: "application/pdf",
        createdAt: at,
      },
      select: { id: true },
    });
  }

  type Pending = { state: FixtureFirm["state"]; opened: number; readAgo: number; timeout?: boolean; expires?: string };
  const pending: Pending[] = [
    // As drawn, reached the real way: the read at submission timed out two hours ago.
    { state: "match", opened: 2 * HOUR, readAgo: 2 * HOUR, timeout: true, expires: "2027-12-31" },
    // The judgement case, and the oldest: over the credential SLA.
    { state: "near_match", opened: 3 * DAY, readAgo: 5 * MINUTE },
    { state: "different_entity", opened: 20 * HOUR, readAgo: 5 * MINUTE },
    { state: "lapsed", opened: 9 * HOUR, readAgo: 5 * MINUTE },
    { state: "not_found", opened: 6 * HOUR, readAgo: 5 * MINUTE },
    { state: "unreachable", opened: 40 * MINUTE, readAgo: 30 * MINUTE, timeout: true },
  ];

  const ids: Partial<Record<FixtureFirm["state"], string>> = {};
  for (const item of pending) {
    const row = firm(item.state);
    const business = await listing(row, item.opened);
    const document = await certificate(business.id, "fta-agent-cert.pdf", ago(item.opened));
    const credential = await db.credential.create({
      data: {
        businessId: business.id,
        kind: "fta_tax_agent",
        identifier: row.taan,
        issuer: "Federal Tax Authority",
        expiresOn: item.expires ? new Date(`${item.expires}T00:00:00.000Z`) : null,
        documentId: document.id,
        trust: "seller_claim",
        review: "pending",
        reviewOpenedAt: ago(item.opened),
        registerFetch: read(row, ago(item.readAgo), item.timeout ? "timeout" : undefined),
        registerFetchedAt: ago(item.readAgo),
        createdAt: ago(item.opened),
      },
      select: { id: true },
    });
    ids[item.state] = credential.id;
  }

  // Asked for a clearer document yesterday: the certificate's expiry and the register disagree.
  const summit = firm("more_info");
  const summitBusiness = await listing(summit, 2 * DAY);
  const summitDocument = await certificate(summitBusiness.id, "summit-fta-certificate.pdf", ago(2 * DAY));
  const summitNote = "The certificate's expiry reads 31 Dec 2027 and the register says 31 Jan 2028. Upload the current certificate.";
  const summitCredential = await db.credential.create({
    data: {
      businessId: summitBusiness.id,
      kind: "fta_tax_agent",
      identifier: summit.taan,
      issuer: "Federal Tax Authority",
      expiresOn: new Date("2027-12-31T00:00:00.000Z"),
      documentId: summitDocument.id,
      trust: "seller_claim",
      review: "more_info",
      reviewOpenedAt: ago(2 * DAY),
      reviewedAt: ago(DAY),
      reviewedById: moderator.id,
      reviewNote: summitNote,
      registerFetch: read(summit, ago(DAY)),
      registerFetchedAt: ago(DAY),
      createdAt: ago(2 * DAY),
    },
    select: { id: true },
  });

  // Verified by a person two days ago, after a refetch found everything matched.
  const pinnacle = firm("verified");
  const pinnacleBusiness = await listing(pinnacle, 3 * DAY);
  const pinnacleNote = "Register answered on the refetch; number, name and status match and the licence is theirs.";
  const pinnacleCredential = await db.credential.create({
    data: {
      businessId: pinnacleBusiness.id,
      kind: "fta_tax_agent",
      identifier: pinnacle.taan,
      issuer: "Federal Tax Authority",
      trust: "register_verified",
      verifiedOn: ago(2 * DAY),
      verifiedBy: "FTA tax agent register",
      review: "verified",
      reviewOpenedAt: ago(3 * DAY),
      reviewedAt: ago(2 * DAY),
      reviewedById: opsLead.id,
      reviewNote: pinnacleNote,
      registerFetch: read(pinnacle, ago(2 * DAY + 10 * MINUTE)),
      registerFetchedAt: ago(2 * DAY + 10 * MINUTE),
      createdAt: ago(3 * DAY),
    },
    select: { id: true, registerFetch: true },
  });

  // The two decisions a person made, in the log they would have written.
  await db.auditEvent.createMany({
    data: [
      {
        actorId: moderator.id,
        action: "queue_docs_requested",
        subject: `Credential:${summitCredential.id}`,
        reason: summitNote,
        before: { review: "pending", trust: "seller_claim", rejectReason: null },
        after: { review: "more_info", registerFetch: read(summit, ago(DAY)) },
        createdAt: ago(DAY),
      },
      {
        actorId: opsLead.id,
        action: "queue_decided",
        subject: `Credential:${pinnacleCredential.id}`,
        reason: pinnacleNote,
        before: { review: "pending", trust: "seller_claim", rejectReason: null },
        after: { review: "verified", trust: "register_verified", registerFetch: pinnacleCredential.registerFetch as Prisma.InputJsonValue },
        createdAt: ago(2 * DAY),
      },
    ],
  });

  // The judgement case is the moderator's, so `Assigned to me` has one.
  const nearMatch = await db.credential.findUniqueOrThrow({ where: { id: ids.near_match! }, select: { businessId: true } });
  await db.queueItem.create({
    data: {
      subjectType: "register_credential",
      subjectId: ids.near_match!,
      businessId: nearMatch.businessId,
      assigneeId: moderator.id,
      assignedAt: ago(2 * DAY),
      assignedById: opsLead.id,
    },
  });
  await db.auditEvent.create({
    data: {
      actorId: opsLead.id,
      action: "queue_reassigned",
      subject: `Credential:${ids.near_match!}`,
      reason: "A near-match on the name: yours to judge against the register this week.",
      before: { assigneeId: null },
      after: { assigneeId: moderator.id },
      createdAt: ago(2 * DAY),
    },
  });

  console.log(`   ${pending.length + 1} credentials waiting on the register or a person, 1 verified by a person`);
}
