import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board 4b — the approval queue's own rows, on a fresh database.
 *
 * The seed already queues three change requests, two claims, a conflict and
 * the credentials sellers asked to publish. What it did not have is a row for
 * each thing the board argues: a claim every check passes (bulk approve's
 * set), a claim whose upload is a DHA licence (request a document), one whose
 * licence lapses in 21 days (approvable, and flagged), a category the licence
 * activity does not cover (reject), a branch outside its free-zone licence
 * (review), and a category that fits (approve). Two are assigned, so
 * `Assigned to me` has something to narrow to.
 *
 * **New listings, never published.** A claim on an existing listing would make
 * it contested for every other suite that claims it, and a published listing
 * moves directory counts a dozen e2e files pin. An unpublished listing is in
 * no search and no count, and is still somebody's company to claim.
 *
 * Deterministic and PRNG-free.
 */

type Db = PrismaClient;

const DAY = 86_400_000;
const HOUR = 3_600_000;

export async function seedQueue(db: Db, now: Date): Promise<void> {
  console.log("→ approval queue rows, for board 4b");

  const ago = (ms: number) => new Date(now.getTime() - ms);
  const inDays = (days: number) => new Date(now.getTime() + days * DAY);

  const [opsLead, moderator, areas, categories] = await Promise.all([
    db.user.findFirst({ where: { roles: { has: "staff_ops_lead" } }, orderBy: { id: "asc" }, select: { id: true } }),
    db.user.findFirst({ where: { roles: { has: "staff_moderator" } }, orderBy: { id: "asc" }, select: { id: true } }),
    db.area.findMany({
      where: { emirate: { in: ["dubai", "ajman", "ras_al_khaimah"] } },
      orderBy: [{ emirate: "asc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, emirate: true },
    }),
    db.category.findMany({
      where: { slug: { in: ["facilities-management-and-cleaning", "pipes-and-tubing", "first-aid", "logistics-and-freight", "valve-spares"] } },
      select: { id: true, slug: true },
    }),
  ]);
  if (!opsLead || !moderator) return;
  const area = (emirate: string) => areas.find((row) => row.emirate === emirate)?.id;
  const category = (slug: string) => categories.find((row) => row.slug === slug)?.id;
  const dubai = area("dubai");
  const ajman = area("ajman") ?? dubai;
  const rak = area("ras_al_khaimah");
  const facilities = category("facilities-management-and-cleaning");
  const pipes = category("pipes-and-tubing");
  const firstAid = category("first-aid");
  const logistics = category("logistics-and-freight") ?? facilities;
  const valves = category("valve-spares") ?? pipes;
  if (!dubai || !ajman || !facilities || !pipes || !firstAid || !logistics || !valves) return;

  let serial = 0;
  async function listing(input: {
    name: string;
    authority: "DED" | "AJM" | "DMCC";
    licenceNumber: string;
    expiresInDays: number;
    categoryId: string;
    activity: string;
    emirate: "dubai" | "ajman";
    areaId: string;
    phone: string;
  }) {
    serial += 1;
    return db.business.create({
      data: {
        tradeName: input.name,
        displayName: input.name.replace(/ (LLC|FZE|Tr\.)$/, ""),
        slug: `queue-seed-${serial}-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        licenceNumber: input.licenceNumber,
        licenceAuthority: input.authority,
        licenceExpiry: inDays(input.expiresInDays),
        licenceActivity: input.activity,
        primaryCategoryId: input.categoryId,
        claimStatus: "unclaimed",
        source: "licence_import",
        verificationTier: 0,
        publishedAt: null,
        createdAt: ago(40 * DAY),
        locations: {
          create: {
            type: "head_office",
            emirate: input.emirate,
            areaId: input.areaId,
            addressLine: "Ground floor",
            phone: input.phone,
            published: true,
            publishedAt: ago(40 * DAY),
          },
        },
      },
      select: { id: true, licenceNumber: true },
    });
  }

  async function claimant(n: number, name: string) {
    return db.user.create({
      data: {
        // Its own prefix, so no other block of `uuid(n)` numbers can collide with it.
        id: `0000004b-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
        phone: `+97150990${String(n).padStart(4, "0")}`,
        fullName: name,
        roles: ["buyer"],
      },
      select: { id: true },
    });
  }

  async function licenceClaim(input: {
    businessId: string;
    licenceNumber: string;
    who: { id: string };
    name: string;
    detectedKind: string;
    waited: number;
  }) {
    const document = await db.document.create({
      data: {
        kind: "trade_licence",
        businessId: input.businessId,
        storagePath: `documents/${input.businessId}/licence-upload.pdf`,
        filename: "licence-upload.pdf",
        bytes: 380_000,
        mimeType: "application/pdf",
        detectedKind: input.detectedKind,
        scannedAt: ago(input.waited),
        createdAt: ago(input.waited),
      },
      select: { id: true },
    });
    const claim = await db.claimSubmission.create({
      data: {
        businessId: input.businessId,
        claimantId: input.who.id,
        route: "licence_upload",
        documentId: document.id,
        claimantName: input.name,
        claimantRole: "owner",
        statedLicenceNumber: input.licenceNumber,
        ocrLicenceNumber: input.detectedKind === "trade_licence" ? input.licenceNumber : null,
        ocrConfidence: input.detectedKind === "trade_licence" ? 0.91 : null,
        createdAt: ago(input.waited),
      },
      select: { id: true },
    });
    // The seat the claim attaches, as the onboarding action does.
    await db.user.update({ where: { id: input.who.id }, data: { businessId: input.businessId, roles: ["buyer", "seller_owner"] } });
    return claim;
  }

  /* A claim every check passes: what bulk approve is for. */
  const zayed = await listing({
    name: "Zayed Facilities Management LLC",
    authority: "AJM",
    licenceNumber: "AJM-118204",
    expiresInDays: 290,
    categoryId: facilities,
    activity: "Facilities Management Services & Cleaning",
    emirate: "ajman",
    areaId: ajman,
    phone: "067441820",
  });
  await licenceClaim({
    businessId: zayed.id,
    licenceNumber: zayed.licenceNumber,
    who: await claimant(1, "Hamdan Al Zaabi"),
    name: "Hamdan Al Zaabi",
    detectedKind: "trade_licence",
    waited: 26 * HOUR,
  });

  /* A DHA licence uploaded in place of a trade licence: request a document. */
  const brightSmile = await listing({
    name: "Bright Smile Dental Clinic LLC",
    authority: "DED",
    licenceNumber: "DED-771905",
    expiresInDays: 400,
    categoryId: firstAid,
    activity: "Dental Clinic",
    emirate: "dubai",
    areaId: dubai,
    phone: "043318870",
  });
  const brightClaim = await licenceClaim({
    businessId: brightSmile.id,
    licenceNumber: brightSmile.licenceNumber,
    who: await claimant(2, "Dr. Meera Pillai"),
    name: "Dr. Meera Pillai",
    detectedKind: "health_authority",
    waited: 4 * HOUR,
  });

  /* A licence that lapses in 21 days: valid today, approvable, flagged. */
  const gulfStar = await listing({
    name: "Gulf Star Auto Spare Parts Tr.",
    authority: "DED",
    licenceNumber: "DED-640912",
    expiresInDays: 21,
    categoryId: valves,
    activity: "Auto Spare Parts Trading",
    emirate: "dubai",
    areaId: dubai,
    phone: "042698812",
  });
  await licenceClaim({
    businessId: gulfStar.id,
    licenceNumber: gulfStar.licenceNumber,
    who: await claimant(3, "Rashid Mahmood"),
    name: "Rashid Mahmood",
    detectedKind: "trade_licence",
    waited: 9 * HOUR,
  });

  /* A category the licence activity does not cover: reject. */
  const aster = await listing({
    name: "Aster Beauty Lounge LLC",
    authority: "DED",
    licenceNumber: "DED-702214",
    expiresInDays: 180,
    categoryId: facilities,
    activity: "Ladies Beauty Salon",
    emirate: "dubai",
    areaId: dubai,
    phone: "043475510",
  });
  const asterOwner = await claimant(4, "Lina Haddad");
  await db.user.update({ where: { id: asterOwner.id }, data: { businessId: aster.id, roles: ["seller_owner"] } });
  await db.listingChangeRequest.create({
    data: {
      businessId: aster.id,
      actorId: asterOwner.id,
      field: "primary_category",
      beforeValue: facilities,
      afterValue: firstAid,
      status: "pending",
      createdAt: ago(HOUR + 10 * 60_000),
    },
  });

  /* A category that fits the licence: approve. */
  const alWaha = await listing({
    name: "Al Waha Industrial Supplies LLC",
    authority: "DED",
    licenceNumber: "DED-688130",
    expiresInDays: 350,
    categoryId: valves,
    activity: "Trading in Pipes & Tubing",
    emirate: "dubai",
    areaId: dubai,
    phone: "043209981",
  });
  const wahaOwner = await claimant(5, "Salim Qureshi");
  await db.user.update({ where: { id: wahaOwner.id }, data: { businessId: alWaha.id, roles: ["seller_owner"] } });
  const wahaChange = await db.listingChangeRequest.create({
    data: {
      businessId: alWaha.id,
      actorId: wahaOwner.id,
      // Primary, not additional: `admin-queues.test.ts` pins the seed's change
      // requests to three fields with a before-value each.
      field: "primary_category",
      beforeValue: valves,
      afterValue: pipes,
      status: "pending",
      createdAt: ago(2 * HOUR),
    },
    select: { id: true },
  });

  /* A branch outside the free-zone licence: review. */
  if (rak) {
    const nexa = await listing({
      name: "Nexa Freight & Logistics LLC",
      authority: "DMCC",
      licenceNumber: "DMCC-40218",
      expiresInDays: 500,
      categoryId: logistics,
      activity: "Freight Forwarding Services",
      emirate: "dubai",
      areaId: dubai,
      phone: "044223190",
    });
    await db.location.create({
      data: {
        businessId: nexa.id,
        type: "warehouse",
        emirate: "ras_al_khaimah",
        areaId: rak,
        addressLine: "Plot 14, Al Ghail Industrial",
        published: true,
        publishedAt: ago(6 * HOUR),
        createdAt: ago(6 * HOUR),
      },
    });
  }

  /* Two assigned, so `Assigned to me` narrows to something. */
  await db.queueItem.createMany({
    data: [
      {
        subjectType: "claim",
        subjectId: brightClaim.id,
        businessId: brightSmile.id,
        assigneeId: opsLead.id,
        assignedAt: ago(3 * HOUR),
        assignedById: opsLead.id,
      },
      {
        subjectType: "change_request",
        subjectId: wahaChange.id,
        businessId: alWaha.id,
        assigneeId: moderator.id,
        assignedAt: ago(HOUR),
        assignedById: opsLead.id,
      },
    ],
  });
  await db.auditEvent.createMany({
    data: [
      {
        actorId: opsLead.id,
        action: "queue_reassigned",
        subject: `ClaimSubmission:${brightClaim.id}`,
        reason: "Taking the DHA upload myself — I spoke to the clinic last week.",
        before: { assigneeId: null },
        after: { assigneeId: opsLead.id },
        createdAt: ago(3 * HOUR),
      },
      {
        actorId: opsLead.id,
        action: "queue_reassigned",
        subject: `ListingChangeRequest:${wahaChange.id}`,
        reason: "Category changes are on the moderator's desk this week.",
        before: { assigneeId: null },
        after: { assigneeId: moderator.id },
        createdAt: ago(HOUR),
      },
    ],
  });
}
