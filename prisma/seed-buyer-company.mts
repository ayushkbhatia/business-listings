import type { PrismaClient } from "../lib/db/generated/client.js";
import { hashInviteToken } from "../lib/staff/token.js";
import { monthStart } from "../lib/enquiry/fanout.js";

/**
 * Board `7b` — the buying company as drawn, so `/account/company` can be seen
 * signed in as Rami Haddad (`pnpm dev:seat` or `/dev/seat`, by email).
 *
 * Marina Facilities LLC: a TRN, a licence, an accounts inbox; the three
 * addresses with their access constraints; Rami the admin and named approver,
 * Priya Menon in procurement at AED 25,000 a month, Joseph D'Souza the site
 * store's requester (a person — the board's *Site foreman — JLT* was a shared
 * login, flag 3), and Deepa Nair invited. The rule: over AED 25,000 needs
 * Rami, and a PO number on every acceptance.
 *
 * And the row the board could not explain: **AED 15,624 from Al Waha, three
 * lines, raised by Priya, PO-2026-0418**, waiting on Rami — below the
 * threshold, and beyond what is left of Priya's month because she accepted
 * AED 12,400 from Gulf Fasteners earlier today. The counter is what explains it.
 *
 * PRNG-free, with its own two unpublished suppliers: borrowing a seeded seller
 * moves some other board's counts (the 10h fixture's lesson). Quotes are
 * written before the release, as `acceptQuote` does and the 7c trigger
 * insists. Memberships go through the table, whose trigger writes
 * `user.buyer_company_id`.
 */

type Db = PrismaClient;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const MARINA = {
  company: "Marina Facilities LLC",
  admin: { id: "00000000-0000-4000-8000-0000000007b0", name: "Rami Haddad", email: "rami.haddad@marinafacilities.example", phone: "+971502201188" },
  procurement: { id: "00000000-0000-4000-8000-0000000007b1", name: "Priya Menon", email: "priya.menon@marinafacilities.example", phone: "+971502201189" },
  requester: { id: "00000000-0000-4000-8000-0000000007b2", name: "Joseph D'Souza", email: "joseph.dsouza@marinafacilities.example", phone: "+971502201190" },
  invited: { name: "Deepa Nair", email: "d.nair@marinafacilities.example" },
  /** A fixed link for the invitation, so the join page can be opened from a seeded database. */
  inviteToken: "seed7bMarinaFacilitiesInviteDeepaNair000001",
} as const;

const SUPPLIERS = [
  { slug: "al-waha-industrial-trading-fixture", name: "Al Waha Industrial Trading", licence: "DED-897001", category: "valves-and-fittings" },
  { slug: "gulf-fasteners-supply-fixture", name: "Gulf Fasteners Supply", licence: "DED-897002", category: "valves-and-fittings" },
] as const;

export async function seedBuyerCompany(db: Db, now: Date) {
  console.log("→ a buying company with a team and a rule, for board 7b");
  const at = (ms: number) => new Date(now.getTime() + ms);

  const suppliers: { id: string }[] = [];
  for (const supplier of SUPPLIERS) {
    const category =
      (await db.category.findFirst({ where: { slug: supplier.category }, select: { id: true } })) ??
      (await db.category.findFirst({ orderBy: { id: "asc" }, select: { id: true } }));
    suppliers.push(
      await db.business.create({
        data: {
          tradeName: `${supplier.name} LLC`,
          displayName: supplier.name,
          slug: supplier.slug,
          licenceNumber: supplier.licence,
          licenceAuthority: "DED",
          licenceExpiry: at(400 * DAY),
          verificationTier: 2,
          verifiedAt: at(-200 * DAY),
          claimStatus: "claimed",
          planId: "pro",
          primaryCategoryId: category!.id,
          source: "self_added",
          publishedAt: null,
          createdAt: at(-500 * DAY),
        },
        select: { id: true },
      }),
    );
  }
  const [alWaha, gulf] = suppliers as [{ id: string }, { id: string }];

  for (const person of [MARINA.admin, MARINA.procurement, MARINA.requester]) {
    await db.user.create({
      data: { id: person.id, fullName: person.name, email: person.email, phone: person.phone, roles: ["buyer"] },
    });
  }

  const created = at(-120 * DAY);
  const company = await db.buyerCompany.create({
    data: {
      name: MARINA.company,
      trn: "100448216900003",
      emirate: "dubai",
      licenceNumber: "DED-772104",
      accountsEmail: "accounts@marinafacilities.example",
      approvalThresholdAed: 25_000,
      requirePoNumber: true,
      createdAt: created,
    },
    select: { id: true },
  });

  await db.buyerCompanyMember.create({
    data: { companyId: company.id, userId: MARINA.admin.id, role: "company_admin", joinedAt: created },
  });
  await db.buyerCompany.update({ where: { id: company.id }, data: { approverId: MARINA.admin.id } });
  await db.buyerCompanyMember.create({
    data: {
      companyId: company.id,
      userId: MARINA.procurement.id,
      role: "procurement",
      monthlyLimitAed: 25_000,
      invitedById: MARINA.admin.id,
      joinedAt: at(-100 * DAY),
    },
  });
  await db.buyerCompanyMember.create({
    data: {
      companyId: company.id,
      userId: MARINA.requester.id,
      role: "requester",
      invitedById: MARINA.admin.id,
      joinedAt: at(-60 * DAY),
    },
  });
  await db.buyerCompanyInvite.create({
    data: {
      companyId: company.id,
      email: MARINA.invited.email,
      fullName: MARINA.invited.name,
      role: "procurement",
      monthlyLimitAed: 10_000,
      tokenHash: hashInviteToken(MARINA.inviteToken),
      invitedById: MARINA.admin.id,
      expiresAt: at(5 * DAY),
      lastSentAt: at(-2 * DAY),
      createdAt: at(-2 * DAY),
    },
  });

  const dmcc = await db.area.findFirst({ where: { name: "DMCC", emirate: "dubai" }, select: { id: true, name: true } });
  const marinaPlaza = await db.buyerDeliveryAddress.create({
    data: {
      companyId: company.id,
      label: "Marina Plaza, Tower 2, Level 14",
      addressLine: "Marina Plaza Tower 2, Level 14, Al Marsa Street, Dubai Marina",
      emirate: "dubai",
      attnName: MARINA.admin.name,
      attnPhone: MARINA.admin.phone,
      accessPoint: "Loading bay",
      accessFrom: 7 * 60,
      accessUntil: 17 * 60,
      isDefault: true,
      createdAt: created,
    },
    select: { id: true },
  });
  const siteStore = await db.buyerDeliveryAddress.create({
    data: {
      companyId: company.id,
      label: "Site store — JLT Cluster D",
      addressLine: "Cluster D basement, Jumeirah Lake Towers",
      emirate: "dubai",
      areaId: dmcc?.id ?? null,
      attnName: MARINA.requester.name,
      attnPhone: MARINA.requester.phone,
      accessUntil: 11 * 60,
      createdAt: at(-90 * DAY),
    },
    select: { id: true },
  });
  await db.buyerDeliveryAddress.create({
    data: {
      companyId: company.id,
      label: "Head office — Business Bay",
      addressLine: "Bay Square Building 5, Office 702, Business Bay",
      emirate: "dubai",
      attnName: "Reception",
      loadLimit: "small_parcels",
      createdAt: at(-90 * DAY),
    },
  });

  /* ── What Priya has already committed this month ─────────────────────────── */

  // Two hours ago, but never before the month began — a seed run on the 1st
  // must still count it in the month the page reads.
  const acceptedAt = new Date(Math.max(at(-2 * HOUR).getTime(), monthStart(now).getTime() + 60_000));
  const snapshot = {
    v: 1,
    label: "Site store — JLT Cluster D",
    addressLine: "Cluster D basement, Jumeirah Lake Towers",
    emirate: "dubai",
    areaId: dmcc?.id ?? null,
    areaName: dmcc?.name ?? null,
    attnName: MARINA.requester.name,
    attnPhone: MARINA.requester.phone,
    accessPoint: null,
    accessFrom: null,
    accessUntil: 11 * 60,
    loadLimit: null,
  };
  const earlier = await db.enquiry.create({
    data: {
      ref: "ENQ-8897",
      buyerId: MARINA.procurement.id,
      buyerCompanyId: company.id,
      requirement: "Stainless anchor bolts and chemical anchors for the JLT Cluster D plant room supports.",
      deliverToArea: dmcc?.name ?? null,
      areaId: dmcc?.id ?? null,
      emirate: "dubai",
      deliveryAddressId: siteStore.id,
      deliverySnapshot: snapshot,
      closesAt: at(3 * DAY),
      createdAt: at(-3 * DAY),
      lines: {
        create: [
          { description: "Anchor bolt M16 × 160, A4 stainless", qty: 400, unit: "pcs", sortOrder: 0 },
          { description: "Chemical anchor cartridge, 410 ml", qty: 40, unit: "pcs", sortOrder: 1 },
        ],
      },
      recipients: { create: [{ businessId: gulf.id, state: "quoted", openedAt: at(-3 * DAY + HOUR), firstReplyAt: at(-2 * DAY) }] },
    },
    select: { id: true },
  });
  const earlierQuote = await db.quote.create({
    data: {
      ref: "QT-8897-R1",
      enquiryId: earlier.id,
      businessId: gulf.id,
      revision: 1,
      status: "sent",
      validityDays: 14,
      paymentTerms: "net_30",
      delivery: "included",
      sentAt: at(-2 * DAY),
      expiresAt: at(12 * DAY),
      createdAt: at(-2 * DAY),
      lines: {
        create: [
          { description: "Anchor bolt M16 × 160, A4 stainless", qty: 400, unitPrice: "22.00", sortOrder: 0 },
          { description: "Chemical anchor cartridge, 410 ml", qty: 40, unitPrice: "90.00", sortOrder: 1 },
        ],
      },
    },
    select: { id: true },
  });
  // The acceptance, in the order `acceptQuote` writes it: quote, then release.
  await db.quote.update({ where: { id: earlierQuote.id }, data: { status: "accepted", acceptedAt } });
  await db.enquiry.update({
    where: { id: earlier.id },
    data: { contactReleasedToBusinessId: gulf.id, contactReleasedAt: acceptedAt, buyerReference: "PO-2026-0412" },
  });

  /* ── The board's row: AED 15,624 from Al Waha, waiting on Rami ───────────── */

  const pending = await db.enquiry.create({
    data: {
      ref: "ENQ-8898",
      buyerId: MARINA.procurement.id,
      buyerCompanyId: company.id,
      requirement: "Grooved couplings, gaskets and hangers for the Marina Plaza chilled water riser replacement.",
      emirate: "dubai",
      deliveryAddressId: marinaPlaza.id,
      deliverySnapshot: {
        v: 1,
        label: "Marina Plaza, Tower 2, Level 14",
        addressLine: "Marina Plaza Tower 2, Level 14, Al Marsa Street, Dubai Marina",
        emirate: "dubai",
        areaId: null,
        areaName: null,
        attnName: MARINA.admin.name,
        attnPhone: MARINA.admin.phone,
        accessPoint: "Loading bay",
        accessFrom: 7 * 60,
        accessUntil: 17 * 60,
        loadLimit: null,
      },
      closesAt: at(4 * DAY),
      createdAt: at(-2 * DAY),
      lines: {
        create: [
          { description: "Rigid grooved coupling, DN100", qty: 12, unit: "pcs", sortOrder: 0 },
          { description: "EPDM gasket, DN100", qty: 24, unit: "pcs", sortOrder: 1 },
          { description: "Clevis hanger, DN100", qty: 8, unit: "pcs", sortOrder: 2 },
        ],
      },
      recipients: {
        create: [
          { businessId: alWaha.id, state: "quoted", openedAt: at(-2 * DAY + HOUR), firstReplyAt: at(-1 * DAY) },
          { businessId: gulf.id, state: "opened", openedAt: at(-2 * DAY + 2 * HOUR) },
        ],
      },
    },
    select: { id: true },
  });
  const pendingQuote = await db.quote.create({
    data: {
      ref: "QT-8898-R1",
      enquiryId: pending.id,
      businessId: alWaha.id,
      revision: 1,
      status: "read",
      validityDays: 14,
      paymentTerms: "net_30",
      delivery: "included",
      sentAt: at(-1 * DAY),
      readAt: at(-20 * HOUR),
      expiresAt: at(13 * DAY),
      createdAt: at(-1 * DAY),
      lines: {
        create: [
          { description: "Rigid grooved coupling, DN100", qty: 12, unitPrice: "812.00", leadTimeDays: 5, sortOrder: 0 },
          { description: "EPDM gasket, DN100", qty: 24, unitPrice: "185.00", leadTimeDays: 5, sortOrder: 1 },
          { description: "Clevis hanger, DN100", qty: 8, unitPrice: "180.00", leadTimeDays: 5, sortOrder: 2 },
        ],
      },
    },
    select: { id: true },
  });
  const request = await db.quoteApproval.create({
    data: {
      companyId: company.id,
      enquiryId: pending.id,
      quoteId: pendingQuote.id,
      quoteRevision: 1,
      valueFils: 1_562_400n,
      raisedById: MARINA.procurement.id,
      reasons: ["over_limit"],
      approverId: null,
      poNumber: "PO-2026-0418",
      note: "Al Waha can deliver to the loading bay on Sunday. The riser shutdown is booked for Monday.",
      createdAt: at(-1 * HOUR),
      updatedAt: at(-1 * HOUR),
    },
    select: { id: true },
  });

  /* ── The history those rows would have left ──────────────────────────────── */

  const events: { actorId: string; actorName: string; kind: string; subject: string; after?: object; note?: string; at: Date }[] = [
    { actorId: MARINA.admin.id, actorName: MARINA.admin.name, kind: "company_created", subject: `company:${company.id}`, at: created },
    {
      actorId: MARINA.admin.id,
      actorName: MARINA.admin.name,
      kind: "rule_changed",
      subject: `company:${company.id}`,
      after: { approvalThresholdAed: 25_000, approverId: MARINA.admin.id, approverName: MARINA.admin.name },
      at: at(-110 * DAY),
    },
    { actorId: MARINA.procurement.id, actorName: MARINA.procurement.name, kind: "member_joined", subject: "member", after: { role: "procurement", monthlyLimitAed: 25_000 }, at: at(-100 * DAY) },
    { actorId: MARINA.requester.id, actorName: MARINA.requester.name, kind: "member_joined", subject: "member", after: { role: "requester", monthlyLimitAed: null }, at: at(-60 * DAY) },
    {
      actorId: MARINA.admin.id,
      actorName: MARINA.admin.name,
      kind: "member_invited",
      subject: "invite",
      after: { fullName: MARINA.invited.name, email: MARINA.invited.email, role: "procurement", monthlyLimitAed: 10_000 },
      at: at(-2 * DAY),
    },
    { actorId: MARINA.procurement.id, actorName: MARINA.procurement.name, kind: "quote_accepted", subject: `enquiry:${earlier.id}`, after: { quoteRef: "QT-8897-R1", valueFils: "1240000" }, at: acceptedAt },
    {
      actorId: MARINA.procurement.id,
      actorName: MARINA.procurement.name,
      kind: "approval_requested",
      subject: `approval:${request.id}`,
      after: { enquiryRef: "ENQ-8898", quoteRef: "QT-8898-R1", valueFils: "1562400", reasons: ["over_limit"] },
      note: "Al Waha can deliver to the loading bay on Sunday. The riser shutdown is booked for Monday.",
      at: at(-1 * HOUR),
    },
  ];
  for (const event of events) {
    await db.buyerCompanyEvent.create({
      data: {
        companyId: company.id,
        actorId: event.actorId,
        actorName: event.actorName,
        kind: event.kind as never,
        subject: event.subject,
        ...(event.after ? { after: event.after } : {}),
        note: event.note ?? null,
        createdAt: event.at,
      },
    });
  }
}
