import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board 4c — the conflict the board draws, on a fresh database.
 *
 * Two claims on one listing in an Abu Dhabi industrial area: claim A holds the
 * licence the listing was minted from and answered on the public-record
 * number; claim B states a different licence, writes from free mail and was
 * reached on a number B supplied. Opened three days and six hours ago — past
 * the 48-hour promise by a day and six hours — and assigned to the ops lead,
 * so it sits under *All*, *Conflicts* and *Assigned to me*.
 *
 * **Its own names and its own listing.** The board draws "Cool Breeze", and
 * "Cool" already belongs to three seeded businesses — a locator for one would
 * match the other (`seed-states-are-shared`). *Zephyr* belongs to nobody.
 * **Unpublished**, like board 4b's queue rows: a published listing moves
 * directory counts a dozen e2e files pin, and an unpublished one is in no
 * search and no count while still being somebody's company to claim.
 *
 * B's licence is deliberately absent from our register, so B's rows read *not
 * in our register* rather than the board's two partials: a register row for it
 * would belong to a run, and every run's figures are pinned by board 12a's
 * suite. The gallery draws the board's own numbers; this exercises the live
 * path.
 *
 * Its own uuid prefix, so no other block of seeded ids can collide with it.
 * Deterministic and PRNG-free.
 */

type Db = PrismaClient;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const id = (n: number) => `000004c0-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export async function seedClaimConflict(db: Db, now: Date): Promise<void> {
  console.log("→ a conflicting claim, for board 4c");

  const ago = (ms: number) => new Date(now.getTime() - ms);
  const [opsLead, area, category] = await Promise.all([
    db.user.findFirst({ where: { roles: { has: "staff_ops_lead" } }, orderBy: { id: "asc" }, select: { id: true } }),
    db.area.findFirst({ where: { emirate: "abu_dhabi", name: { startsWith: "Mussafah" } }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true } }),
    db.category.findFirst({ where: { slug: "hvac-and-ventilation" }, select: { id: true, parentId: true } }),
  ]);
  if (!opsLead || !area || !category) return;

  const business = await db.business.create({
    data: {
      tradeName: "Zephyr Cooling Technical Services LLC",
      displayName: "Zephyr Cooling Technical Services",
      slug: "zephyr-cooling-technical-services",
      licenceNumber: "ADDED-771204",
      licenceAuthority: "ADDED",
      licenceExpiry: new Date(now.getTime() + 240 * DAY),
      primaryCategoryId: category.id,
      sectorId: category.parentId ?? category.id,
      // A race: two claims and no decision. Public surfaces render it unclaimed (B10).
      claimStatus: "disputed",
      source: "licence_import",
      publishedAt: null,
      locations: {
        create: {
          type: "head_office",
          emirate: "abu_dhabi",
          areaId: area.id,
          addressLine: "Plot 22, Street 9",
          phone: "02 553 1190",
          published: true,
        },
      },
    },
    select: { id: true },
  });

  const [faisal, ahmed] = await Promise.all([
    db.user.create({
      data: {
        id: id(1),
        phone: "+971504412290",
        email: "faisal@zephyrcooling.example",
        fullName: "Faisal Al Marzooqi",
        // The seat the onboarding action attached: A's claim was uncontested when it was sent.
        roles: ["buyer", "seller_owner"],
        businessId: business.id,
      },
      select: { id: true },
    }),
    db.user.create({
      data: { id: id(2), phone: "+971508830116", email: "ahmed.siddiqui.ac@gmail.com", fullName: "Ahmed Siddiqui", roles: ["buyer"] },
      select: { id: true },
    }),
  ]);

  const document = (who: string, at: Date) =>
    db.document.create({
      data: {
        kind: "trade_licence",
        businessId: business.id,
        storagePath: `${business.id}/trade_licence/${who}-licence.pdf`,
        filename: `${who}-licence.pdf`,
        bytes: 402_118,
        mimeType: "application/pdf",
        detectedKind: "trade_licence",
        scannedAt: at,
        createdAt: at,
      },
      select: { id: true },
    });

  const aAt = ago(4 * DAY + 2 * HOUR);
  const bAt = ago(3 * DAY + 6 * HOUR);
  const [aDoc, bDoc] = await Promise.all([document("claim-a", aAt), document("claim-b", bAt)]);

  const a = await db.claimSubmission.create({
    data: {
      businessId: business.id,
      claimantId: faisal.id,
      route: "licence_upload",
      documentId: aDoc.id,
      contested: true,
      claimantName: "Faisal Al Marzooqi",
      claimantRole: "owner",
      statedLicenceNumber: "ADDED-771204",
      statedLicenceExpiry: new Date(now.getTime() + 240 * DAY),
      ocrLicenceNumber: "ADDED-771204",
      ocrConfidence: 0.93,
      createdAt: aAt,
    },
    select: { id: true },
  });
  const b = await db.claimSubmission.create({
    data: {
      businessId: business.id,
      claimantId: ahmed.id,
      route: "licence_upload",
      documentId: bDoc.id,
      contested: true,
      claimantName: "Ahmed Siddiqui",
      claimantRole: "manager",
      statedLicenceNumber: "ADDED-802116",
      statedLicenceExpiry: new Date(now.getTime() + 150 * DAY),
      createdAt: bAt,
    },
    select: { id: true },
  });

  // Opened when the second claim landed: the 48 hours both were promised start here (B8).
  const conflict = await db.claimConflict.create({
    data: { businessId: business.id, submissionAId: a.id, submissionBId: b.id, createdAt: bAt },
    select: { id: true },
  });
  await db.claimSubmission.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { conflictId: conflict.id } });

  await db.queueItem.create({
    data: {
      subjectType: "conflict",
      subjectId: conflict.id,
      businessId: business.id,
      assigneeId: opsLead.id,
      assignedById: opsLead.id,
      assignedAt: ago(3 * DAY),
    },
  });

  // The two calls the decision log reads back, from the audit rows that recorded them (B7, B14).
  await db.auditEvent.createMany({
    data: [
      {
        actorId: opsLead.id,
        action: "claim_call_logged",
        subject: `ClaimConflict:${conflict.id}`,
        reason: "Called the number on the ADDED record. Answered as the company; the owner confirmed the claim.",
        after: { claim: a.id, to: "public_record", confirmed: true },
        createdAt: ago(2 * DAY + 4 * HOUR),
      },
      {
        actorId: opsLead.id,
        action: "claim_call_logged",
        subject: `ClaimConflict:${conflict.id}`,
        reason: "Called the number the claimant gave. A former service partner trading under a similar name.",
        after: { claim: b.id, to: "claimant_supplied", confirmed: true },
        createdAt: ago(2 * DAY + 3 * HOUR),
      },
    ],
  });
}
