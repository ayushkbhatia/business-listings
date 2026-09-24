import type { PrismaClient } from "../lib/db/generated/client.js";
import { MARINA } from "./seed-buyer-company.mjs";

/**
 * Board `1n` — one RFQ, four quotes priced line by line, and a fifth supplier
 * who opened it and went quiet.
 *
 * `ENQ-8864` is the board as drawn and corrected at export: *Chilled water riser
 * — valves, couplings, gaskets*, three lines sent to five suppliers. Emirates
 * Valve wins the valve, Northern Gulf the coupling and the gasket, and neither
 * wins overall — the cheapest per line is **AED 13,560 across two suppliers**,
 * 1,320 under Al Waha's 14,880, which is the figure the drawn card got wrong.
 * Read-only in the acceptance suite. Gulf Cool opened it two days ago and has
 * not quoted, so its row offers the one nudge; a spec nudging it would spend
 * the fixture, so none does.
 *
 * `ENQ-8865` is the one the acceptance suite accepts on (memory: destructive
 * e2e tests eat fixtures). `ENQ-8866` is the board as its nav draws it —
 * Priya Menon buying for Marina Facilities — for `/dev/seat` and the company
 * path: every quote is beyond what is left of her month, so every row reads
 * *Send for approval* and names Rami Haddad (`B7`).
 *
 * Suppliers of their own, claimed, licence verified, on Pro and never
 * published, for the reason `seedNegotiationThreads` gives: every seeded seller
 * already carries some board's measured fixture. Each has an owner seat and a
 * notification preference, so accepting on `ENQ-8865` writes the decline notices
 * `B8` promises into the delivery log where the suite can read them. Quotes are
 * written against their lines' ids — `QuoteLine.enquiryLineId`, which is what
 * the comparison keys on — and before any release, as `acceptQuote` does.
 *
 * The wall clock, so *quoted in 1 h 40 min* and *closes in 3 days* read as
 * drawn whenever the seed runs. PRNG-free.
 */

type Db = PrismaClient;

export const COMPARE_CLAIM_TOKEN = "seed-0000-4000-8000-provisional06";
export const COMPARE_ENQUIRY_ID = "seedenquirycompare0001";
export const COMPARE_ACCEPT_ENQUIRY_ID = "seedenquirycompare0002";
export const COMPARE_COMPANY_ENQUIRY_ID = "seedenquirycompare0003";

const BUYER_ID = "00000000-0000-4000-8000-00000000c1a0";

const SUPPLIERS = [
  { key: "alwaha", slug: "al-waha-industrial-supplies-fixture", name: "Al Waha Industrial Supplies", licence: "DED-886401", owner: "Faisal Al Waha" },
  { key: "emirates", slug: "emirates-valve-fitting-co-fixture", name: "Emirates Valve & Fitting Co.", licence: "DED-886402", owner: "Sunil Pillai" },
  { key: "northern", slug: "northern-gulf-trading-1n-fixture", name: "Northern Gulf Trading", licence: "DED-886403", owner: "Omar Haddad" },
  { key: "technopump", slug: "technopump-trading-fixture", name: "Technopump Trading LLC", licence: "DED-886404", owner: "Arjun Mehta" },
  { key: "gulfcool", slug: "gulf-cool-technical-services-fixture", name: "Gulf Cool Technical Services", licence: "DED-886405", owner: "Kareem Nasser" },
] as const;
type Key = (typeof SUPPLIERS)[number]["key"];

const OWNER_IDS: Record<Key, string> = {
  alwaha: "00000000-0000-4000-8000-00000000c1a1",
  emirates: "00000000-0000-4000-8000-00000000c1a2",
  northern: "00000000-0000-4000-8000-00000000c1a3",
  technopump: "00000000-0000-4000-8000-00000000c1a4",
  gulfcool: "00000000-0000-4000-8000-00000000c1a5",
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The three lines, as the board heads its columns. */
const LINES = [
  { key: "valve", description: "Resilient seated gate valve, flanged", qty: 40, unit: "pcs", size: "DN100" },
  { key: "coupling", description: "Rigid grooved coupling", qty: 120, unit: "pcs", size: "DN100" },
  { key: "gasket", description: "EPDM gasket", qty: 120, unit: "pcs", size: "DN100" },
] as const;
type LineKey = (typeof LINES)[number]["key"];

/**
 * Each supplier's quote as the board prices it — a unit price per line, the
 * line total being qty × unit (7,920 = 40 × 198). No entry is *not quoted*.
 */
const QUOTES: Partial<
  Record<Key, { minutes: number; lead: number; terms: "net_30" | "net_60" | "advance"; delivery: "included" | "charged_separately" | "collection"; prices: Partial<Record<LineKey, string>> }>
> = {
  alwaha: { minutes: 100, lead: 0, terms: "net_30", delivery: "included", prices: { valve: "198.00", coupling: "46.00", gasket: "12.00" } },
  emirates: { minutes: 175, lead: 0, terms: "advance", delivery: "charged_separately", prices: { valve: "183.00", coupling: "50.00" } },
  northern: { minutes: 370, lead: 12, terms: "net_60", delivery: "included", prices: { valve: "268.00", coupling: "41.00", gasket: "11.00" } },
  technopump: { minutes: 560, lead: 10, terms: "net_30", delivery: "collection", prices: { valve: "236.00", coupling: "48.00", gasket: "13.00" } },
};

/** The same mark `nextQuoteRef` puts in a reference: the enquiry number and the seller's code. */
function quoteRef(enquiryRef: string, slug: string, revision: number): string {
  const mark = slug.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase() || "SUP";
  return `QT-${enquiryRef.replace(/^ENQ-/, "")}-${mark}R${revision}`;
}

export async function seedCompareQuotes(db: Db, now: Date) {
  console.log("→ quotes compared line by line, for board 1n");
  const at = (ms: number) => new Date(now.getTime() + ms);

  const category = await db.category.findFirst({ where: { slug: "valves-and-fittings" }, select: { id: true } });
  if (!category) throw new Error("Board 1n fixtures need the valves category; the seed has none.");

  const business = new Map<Key, { id: string; slug: string }>();
  for (const [index, supplier] of SUPPLIERS.entries()) {
    const row = await db.business.create({
      data: {
        tradeName: supplier.name.endsWith("LLC") ? supplier.name : `${supplier.name} LLC`,
        displayName: supplier.name,
        slug: supplier.slug,
        licenceNumber: supplier.licence,
        licenceAuthority: "DED",
        licenceExpiry: at(400 * DAY),
        verificationTier: 2,
        verifiedAt: at(-(90 + index * 20) * DAY),
        claimStatus: "claimed",
        planId: "pro",
        primaryCategoryId: category.id,
        source: "self_added",
        // Never published: see the file comment.
        publishedAt: null,
        createdAt: at(-500 * DAY),
      },
      select: { id: true, slug: true },
    });
    business.set(supplier.key, row);
    await db.user.create({
      data: {
        id: OWNER_IDS[supplier.key],
        phone: `+97155886${String(4010 + index)}`,
        fullName: supplier.owner,
        roles: ["seller_owner"],
        businessId: row.id,
      },
    });
    /*
       The decline and the nudge are on the platform floor in-app; the matrix
       here adds nothing to them. It exists because `notify` sends nothing to a
       business with no preference row at all.
    */
    await db.notificationPreference.create({
      data: {
        businessId: row.id,
        routing: { enquiry_received: ["in_app"], quote_accepted: ["in_app"], quote_declined: ["in_app"], enquiry_nudged: ["in_app"] },
        quietHoursEnabled: true,
      },
    });
  }

  await db.user.create({
    data: {
      id: BUYER_ID,
      phone: "+971544120106",
      fullName: "Priya Menon",
      roles: [],
      isProvisional: true,
      claimToken: COMPARE_CLAIM_TOKEN,
    },
  });

  const marina = await db.buyerCompanyMember.findFirst({
    where: { userId: MARINA.procurement.id, deactivatedAt: null },
    select: { companyId: true },
  });
  const marinaPlaza = marina
    ? await db.buyerDeliveryAddress.findFirst({
        where: { companyId: marina.companyId, isDefault: true, archivedAt: null },
        select: { id: true, label: true, addressLine: true, emirate: true, attnName: true, attnPhone: true, accessPoint: true, accessFrom: true, accessUntil: true },
      })
    : null;

  /* ── ENQ-8864: the board as drawn ───────────────────────────────────────── */
  await rfq(db, {
    id: COMPARE_ENQUIRY_ID,
    ref: "ENQ-8864",
    buyerId: BUYER_ID,
    createdAt: at(-2 * DAY - 3 * HOUR),
    closesAt: at(3 * DAY + 2 * HOUR),
    // Eleven days out: ex-stock and ten days land in time, twelve does not —
    // flag 6's boundary, drawn from the buyer's own date.
    neededBy: at(11 * DAY),
    quoted: ["alwaha", "emirates", "northern", "technopump"],
    waiting: { gulfcool: { openedAt: at(-2 * DAY) } },
    business,
  });

  /* ── ENQ-8865: the one the suite accepts on ─────────────────────────────── */
  await rfq(db, {
    id: COMPARE_ACCEPT_ENQUIRY_ID,
    ref: "ENQ-8865",
    buyerId: BUYER_ID,
    createdAt: at(-30 * HOUR),
    closesAt: at(4 * DAY),
    neededBy: at(20 * DAY),
    quoted: ["alwaha", "northern", "technopump"],
    // Delivered and never opened: the fourth state a fan-out produces, beside
    // three quotes. Declined with the rest when the suite accepts.
    waiting: { gulfcool: { openedAt: null } },
    business,
  });

  /* ── ENQ-8866: Priya, buying for Marina Facilities ──────────────────────── */
  if (marina) {
    await rfq(db, {
      id: COMPARE_COMPANY_ENQUIRY_ID,
      ref: "ENQ-8866",
      buyerId: MARINA.procurement.id,
      buyerCompanyId: marina.companyId,
      delivery: marinaPlaza
        ? {
            id: marinaPlaza.id,
            snapshot: {
              v: 1,
              label: marinaPlaza.label,
              addressLine: marinaPlaza.addressLine,
              emirate: marinaPlaza.emirate,
              areaId: null,
              areaName: null,
              attnName: marinaPlaza.attnName,
              attnPhone: marinaPlaza.attnPhone,
              accessPoint: marinaPlaza.accessPoint,
              accessFrom: marinaPlaza.accessFrom,
              accessUntil: marinaPlaza.accessUntil,
              loadLimit: null,
            },
          }
        : null,
      createdAt: at(-2 * DAY - 3 * HOUR),
      closesAt: at(3 * DAY + 2 * HOUR),
      neededBy: at(11 * DAY),
      quoted: ["alwaha", "emirates", "northern", "technopump"],
      waiting: { gulfcool: { openedAt: at(-2 * DAY) } },
      business,
    });
  }
}

async function rfq(
  db: Db,
  input: {
    id: string;
    ref: string;
    buyerId: string;
    buyerCompanyId?: string;
    delivery?: { id: string; snapshot: object } | null;
    createdAt: Date;
    closesAt: Date;
    neededBy: Date;
    quoted: readonly Key[];
    waiting: Partial<Record<Key, { openedAt: Date | null }>>;
    business: Map<Key, { id: string; slug: string }>;
  },
) {
  const after = (minutes: number) => new Date(input.createdAt.getTime() + minutes * MIN);

  const enquiry = await db.enquiry.create({
    data: {
      id: input.id,
      ref: input.ref,
      buyerId: input.buyerId,
      ...(input.buyerCompanyId ? { buyerCompanyId: input.buyerCompanyId } : {}),
      ...(input.delivery ? { deliveryAddressId: input.delivery.id, deliverySnapshot: input.delivery.snapshot } : {}),
      requirement:
        "Chilled water riser — valves, couplings, gaskets. Resilient seated gate valves, rigid grooved couplings and EPDM gaskets for the Marina Plaza riser replacement, to the loading bay in one drop.",
      deliverToArea: "Dubai Marina",
      emirate: "dubai",
      termsWanted: "net_30",
      neededBy: input.neededBy,
      closesAt: input.closesAt,
      createdAt: input.createdAt,
    },
    select: { id: true },
  });

  const lineIds = new Map<LineKey, string>();
  for (const [index, line] of LINES.entries()) {
    const row = await db.enquiryLine.create({
      data: {
        enquiryId: enquiry.id,
        description: line.description,
        qty: line.qty,
        unit: line.unit,
        size: line.size,
        sortOrder: index,
      },
      select: { id: true },
    });
    lineIds.set(line.key, row.id);
  }

  for (const key of input.quoted) {
    const quote = QUOTES[key]!;
    const supplier = input.business.get(key)!;
    const sentAt = after(quote.minutes);
    await db.enquiryRecipient.create({
      data: {
        enquiryId: enquiry.id,
        businessId: supplier.id,
        state: "quoted",
        openedAt: after(Math.min(30, quote.minutes)),
        firstReplyAt: sentAt,
        createdAt: input.createdAt,
      },
    });
    await db.quote.create({
      data: {
        ref: quoteRef(input.ref, supplier.slug, 1),
        enquiryId: enquiry.id,
        businessId: supplier.id,
        revision: 1,
        validityDays: 14,
        status: "sent",
        paymentTerms: quote.terms,
        delivery: quote.delivery,
        sentAt,
        expiresAt: new Date(sentAt.getTime() + 14 * DAY),
        createdAt: sentAt,
        lines: {
          create: LINES.filter((line) => quote.prices[line.key] !== undefined).map((line, index) => ({
            enquiryLineId: lineIds.get(line.key)!,
            description: `${line.description} ${line.size}`,
            qty: line.qty,
            unitPrice: quote.prices[line.key]!,
            leadTimeDays: quote.lead,
            sortOrder: index,
          })),
        },
      },
    });
  }

  for (const [key, waiting] of Object.entries(input.waiting) as [Key, { openedAt: Date | null }][]) {
    await db.enquiryRecipient.create({
      data: {
        enquiryId: enquiry.id,
        businessId: input.business.get(key)!.id,
        state: waiting.openedAt ? "opened" : "delivered",
        openedAt: waiting.openedAt,
        createdAt: input.createdAt,
      },
    });
  }
}
