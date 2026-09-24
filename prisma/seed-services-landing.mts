import type { PrismaClient } from "../lib/db/generated/client.js";
import type { DeliveredWhere, Emirate } from "../lib/db/generated/enums.js";
import { buildBusinessSearchText } from "../lib/search/index-text.js";

/**
 * Board `6a-s` — a services landing page with something true on it.
 *
 * *VAT consultants in Business Bay, Dubai*, as drawn, over sixty-odd practices
 * that COVER Business Bay — most of them from somewhere else. That is the
 * board's whole premise (B1), so the fixtures are built to exercise it rather
 * than to look full:
 *
 *  - **Lighthouse Tax Consultancy** — the board's first row: a checked FTA agent
 *    number, per return, remote, three sectors. Office in Deira; covers Dubai.
 *  - **Al Qasimi Chartered Accountants** — a retainer, at their office, DMCC and
 *    JAFZA registrations for the scope chip, a checked FTA number, and a live
 *    audit service too, which is what puts it on the audit page as well.
 *  - **Sterling Fiscal Advisors** — no badge. *Not a registered agent — they
 *    prepare, you submit.* The absence is the only trustworthy negative (B4).
 *  - **Canal Tax Partners** — its VAT service narrowed to Business Bay itself:
 *    on the Business Bay page, absent from Downtown's.
 *  - **Gulf Ledger Advisory** — a Dubai-wide default and a VAT service narrowed
 *    to Abu Dhabi. The union says Dubai; the service says not. Absent from both
 *    Dubai pages — coverage resolves per service.
 *  - **Quayside Tax Services** — an unclaimed licence import with an office in
 *    Business Bay and nothing else: on the page by its address, with no
 *    enquiry button, counted by the claim card.
 *  - **Marina Tax House** — a checked FTA number whose confirmed date passed
 *    last month. No badge, not counted (B4).
 *  - **Bayside VAT Desk** — tier 2 stored, licence lapsed yesterday, sweep not
 *    yet run: counted out of *licence-verified* by the page, not by the job.
 *
 * …and fifty-six more, rotating fee basis, delivery and coverage shape, so the
 * floors are cleared by the rule rather than by a count typed in.
 *
 * ## What is published
 *
 * VAT in Business Bay and in Downtown (the *Nearby* pair), audit in Business
 * Bay (*Related work*), and VAT across Dubai — `6a-s` D-EMI's emirate class.
 * Deira has copy and no publish, so it must appear in no link block. The VAT
 * and audit trades are opened for the services template; nothing else is.
 *
 * ## What it must not disturb
 *
 * `search-blended.spec.ts` searches *vat return filing*, and every token must
 * match. No fixture here carries the word *return* in anything search reads, so
 * the 1c-s fixtures keep the Dubai result set they were written against. No
 * branch carries a phone number, so board 4h's shared-number sweep files
 * nothing about them. Enquiry history is two to three months old, so board
 * 11a's cap trim this month is untouched.
 *
 * Idempotent by slug prefix, PRNG-free, deterministic.
 */

type Db = PrismaClient;

const DAY = 86_400_000;
const PREFIX = "svc6as-";

/** UUIDs in a range of their own, so no other seed's seats collide. */
function seatId(n: number): string {
  return `00000000-0000-4000-86a5-${n.toString(16).padStart(12, "0")}`;
}

interface FirmSpec {
  slug: string;
  displayName: string;
  licence: string;
  tier: 0 | 1 | 2;
  claimed: boolean;
  description: string | null;
  /** The business default. Emirate rows are whole emirates; area rows name one. */
  covers: { emirate: Emirate; area?: string }[];
  /** Office, where there is one. */
  office: string | null;
  vat: {
    name: string;
    slug: string;
    feeBasis: string;
    delivered: DeliveredWhere;
    sectors?: string;
    /** Narrowed to these, rather than inheriting the default. */
    narrowedTo?: { emirate: Emirate; area?: string }[];
  } | null;
  audit: boolean;
  /** A checked FTA agent number, and when the register said it runs to. */
  fta?: { number: string; expiresInDays: number | null };
  freeZones?: string[];
  /** Days until the licence lapses. Negative has lapsed. */
  licenceDays?: number;
  /** Minutes to first reply on three historical enquiries — measured, never set. */
  replies?: [number, number, number];
}

const NAMED: FirmSpec[] = [
  {
    slug: `${PREFIX}lighthouse-tax-consultancy`,
    displayName: "Lighthouse Tax Consultancy",
    licence: "DED-844101",
    tier: 2,
    claimed: true,
    description:
      "Tax and assurance for SMEs and free-zone companies. Registered tax agents; we correspond with the FTA on your behalf.",
    covers: [{ emirate: "dubai" }],
    office: "deira",
    vat: {
      name: "VAT registration and quarterly compliance",
      slug: "vat-registration-and-quarterly-compliance",
      feeBasis: "per_return",
      delivered: "remote",
      sectors: "Retail, logistics, construction",
    },
    audit: true,
    fta: { number: "20034512", expiresInDays: 400 },
    replies: [95, 130, 160],
  },
  {
    slug: `${PREFIX}al-qasimi-chartered-accountants`,
    displayName: "Al Qasimi Chartered Accountants",
    licence: "DED-844102",
    tier: 2,
    claimed: true,
    description: "Audit, VAT and corporate tax. MoF-approved auditors, DMCC and JAFZA listed.",
    covers: [{ emirate: "dubai" }, { emirate: "sharjah" }],
    office: "downtown-dubai",
    vat: {
      name: "VAT compliance retainer",
      slug: "vat-compliance-retainer",
      feeBasis: "retainer",
      delivered: "at_our_office",
    },
    audit: true,
    fta: { number: "20011870", expiresInDays: 300 },
    freeZones: ["dmcc", "jebel-ali-free-zone"],
    replies: [200, 260, 250],
  },
  {
    slug: `${PREFIX}sterling-fiscal-advisors`,
    displayName: "Sterling Fiscal Advisors",
    licence: "DED-844103",
    tier: 2,
    claimed: true,
    description:
      "VAT registration and quarterly filing for small trading companies. Not a registered agent — they prepare, you submit.",
    covers: [{ emirate: "dubai" }],
    office: null,
    vat: {
      name: "VAT registration for small traders",
      slug: "vat-registration-for-small-traders",
      feeBasis: "fixed_fee",
      delivered: "remote",
    },
    audit: true,
    replies: [480, 560, 610],
  },
  {
    slug: `${PREFIX}canal-tax-partners`,
    displayName: "Canal Tax Partners",
    licence: "DED-844104",
    tier: 2,
    claimed: true,
    description: "A two-partner practice working only with companies in Business Bay towers.",
    covers: [{ emirate: "dubai" }],
    office: "business-bay",
    vat: {
      name: "VAT health check",
      slug: "vat-health-check",
      feeBasis: "fixed_fee",
      delivered: "on_site",
      narrowedTo: [{ emirate: "dubai", area: "business-bay" }],
    },
    audit: true,
    replies: [150, 180, 210],
  },
  {
    slug: `${PREFIX}gulf-ledger-advisory`,
    displayName: "Gulf Ledger Advisory",
    licence: "ADDED-844105",
    tier: 2,
    claimed: true,
    description: "Corporate tax and VAT for Abu Dhabi holding companies.",
    covers: [{ emirate: "dubai" }],
    office: null,
    vat: {
      name: "VAT for holding structures",
      slug: "vat-for-holding-structures",
      feeBasis: "per_hour",
      delivered: "remote",
      narrowedTo: [{ emirate: "abu_dhabi" }],
    },
    audit: false,
  },
  {
    slug: `${PREFIX}quayside-tax-services`,
    displayName: "Quayside Tax Services",
    licence: "DED-844106",
    tier: 0,
    claimed: false,
    description: null,
    covers: [],
    office: "business-bay",
    vat: null,
    audit: false,
  },
  {
    slug: `${PREFIX}marina-tax-house`,
    displayName: "Marina Tax House",
    licence: "DED-844107",
    tier: 2,
    claimed: true,
    description: "VAT and excise for hospitality groups.",
    covers: [{ emirate: "dubai" }],
    office: null,
    vat: {
      name: "Excise and VAT for hospitality",
      slug: "excise-and-vat-for-hospitality",
      feeBasis: "retainer",
      delivered: "remote",
      sectors: "Hospitality",
    },
    audit: true,
    fta: { number: "20029944", expiresInDays: -30 },
  },
  {
    slug: `${PREFIX}bayside-vat-desk`,
    displayName: "Bayside VAT Desk",
    licence: "DED-844108",
    tier: 2,
    claimed: true,
    description: "Registrations and deregistrations, turned round inside a week.",
    covers: [{ emirate: "dubai" }],
    office: "business-bay",
    vat: {
      name: "VAT deregistration",
      slug: "vat-deregistration",
      feeBasis: "fixed_fee",
      delivered: "remote",
    },
    audit: true,
    licenceDays: -1,
  },
];

const FIRST = [
  "Atlas", "Beacon", "Cedar", "Delta", "Ember", "Falcon", "Granite",
  "Iris", "Juniper", "Keystone", "Lumen", "Marlin", "Nova", "Onyx",
] as const;
const SECOND = ["Tax Advisers", "VAT Consultants", "Tax Consultancy", "Accounting & Tax"] as const;
const SERVICE_NAMES = [
  "VAT registration and quarterly compliance",
  "VAT health check",
  "Corporate tax and VAT advisory",
  "VAT group registration",
] as const;
const FEE_BASES = ["per_return", "retainer", "fixed_fee", "per_hour"] as const;
const DELIVERED: DeliveredWhere[] = ["remote", "at_our_office", "on_site"];
const SECTORS = [undefined, "Trading, free zone entities", "Retail, logistics, construction", "Real estate"] as const;
const OFFICES = ["deira", "business-bay", null, "downtown-dubai"] as const;

function generated(): FirmSpec[] {
  const out: FirmSpec[] = [];
  let index = 0;
  for (const second of SECOND) {
    for (const first of FIRST) {
      const i = index;
      index += 1;
      const name = `${first} ${second}`;
      const slug = `${PREFIX}${name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-")}`;
      out.push({
        slug,
        displayName: name,
        licence: `DED-845${String(100 + i).padStart(3, "0")}`,
        tier: i % 2 === 0 ? 2 : 1,
        claimed: true,
        description: [
          "VAT and corporate tax for owner-managed companies across Dubai.",
          "Registrations, quarterly compliance and voluntary disclosures for trading companies.",
          "Tax work for property, holding and family companies, with a partner on every file.",
          "Small-company VAT, bookkeeping and corporate tax under one engagement.",
        ][i % 4]!,
        covers:
          i % 5 === 0
            ? [{ emirate: "dubai" }, { emirate: "sharjah" }]
            : i % 5 === 1
              ? [
                  { emirate: "dubai", area: "business-bay" },
                  { emirate: "dubai", area: "downtown-dubai" },
                  { emirate: "dubai", area: "difc" },
                ]
              : [{ emirate: "dubai" }],
        office: OFFICES[i % OFFICES.length] ?? null,
        vat: {
          name: SERVICE_NAMES[i % SERVICE_NAMES.length]!,
          slug: SERVICE_NAMES[i % SERVICE_NAMES.length]!.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          feeBasis: FEE_BASES[i % FEE_BASES.length]!,
          delivered: DELIVERED[i % DELIVERED.length]!,
          ...(SECTORS[i % SECTORS.length] ? { sectors: SECTORS[i % SECTORS.length] } : {}),
        },
        audit: true,
        ...(i % 3 === 0 ? { fta: { number: String(20100000 + i * 37), expiresInDays: 200 + i } } : {}),
        ...(i < 4 ? { replies: [60 + i * 20, 90 + i * 25, 120 + i * 30] as [number, number, number] } : {}),
      });
    }
  }
  return out;
}

/* ── The copy ────────────────────────────────────────────────────────────── */

const ASKS: Record<string, { question: string; why: string }[]> = {
  "vat-and-tax": [
    {
      question: "Are you a registered FTA tax agent?",
      why: "Only an agent can deal with the authority in your name. Everyone else prepares the return and you file it, which matters when a query or a penalty notice arrives.",
    },
    {
      question: "Is the fee per return or a retainer?",
      why: "Per return suits a company with steady quarters. A retainer usually includes the queries between them, which is where the time actually goes.",
    },
    {
      question: "Who handles an FTA audit if one comes?",
      why: "Frequently excluded from the fee and quoted separately. Worth reading the exclusions line before you sign, not after.",
    },
  ],
  "audit-and-assurance": [
    {
      question: "Are you on the approved list my free zone requires?",
      why: "DMCC, JAFZA and several others accept audit reports only from firms on their own list. A report from anyone else is work you pay for twice.",
    },
    {
      question: "Who signs the report, and how many engagements do they carry?",
      why: "The partner who signs is the one accountable for the opinion. A signing partner with two hundred files sees yours for an afternoon.",
    },
    {
      question: "What happens if the books are not ready on the agreed date?",
      why: "Most fees assume complete records on day one. Late records are where re-quotes and missed renewal deadlines come from.",
    },
  ],
};

const BB_VAT_INTRO = `
Most VAT work in Business Bay is done remotely, so the practices on this page are not all physically in the district — they cover it. The towers along the canal hold thousands of small trading and holding companies whose books live in cloud accounting software, and the work a VAT consultant does for them is registrations, quarterly computations, voluntary disclosures and the correspondence that follows. None of that needs a meeting room in the same building, and the firms that do it best are often in Deira, Downtown or a free zone office across the creek.

What matters more than the address is whether the practice is a registered FTA tax agent. An agent can correspond with the Federal Tax Authority on your behalf and represent you when a query or an audit notice arrives; a consultant who is not an agent prepares the work and hands it to you to submit. Both are legitimate, and they are priced differently. The badge beside a practice's name is the agent number checked against the FTA's register, and a practice with no badge has not had one checked — which is not the same as saying it is not an agent, and the questions below are how to find out.

Business Bay companies tend to be young and to change shape quickly: a licence moved from a free zone, a second entity added for a new line of business, a group registration that no longer fits. A practice that has done group registrations and deregistrations before will save you a quarter of back-and-forth, so ask for one it has done recently.

Nothing here is priced, because a VAT engagement is priced on the number of returns, the state of the books and what is excluded. Send one brief and the firms that can take it will come back with a basis you can compare.
`.trim();

const DT_VAT_INTRO = `
Downtown Dubai's companies are mostly hospitality, retail and property management — businesses with high transaction volumes, a lot of partially exempt supplies and, in property, the recurring question of which charges are standard-rated and which are exempt. The practices listed here cover Downtown whether or not they sit in it, and most of the VAT work they do for Downtown clients is done remotely against the client's own accounting system.

The distinction that matters first is between a registered FTA tax agent and a consultant who is not one. An agent corresponds with the authority for you, and represents you if a return is queried; a consultant who is not an agent prepares the work for you to submit. The badge on each row is an agent number we checked against the FTA's register. A row with no badge is a practice whose number nobody has checked, not a practice we have found wanting.

For a hospitality or retail business, ask how the practice handles high-volume reconciliations and apportionment of input tax — it is where Downtown returns go wrong most often, and where a fixed fee quoted without seeing the ledger is least likely to hold. For property management, ask who has handled the treatment of service charges before.

Prices are not published here. A VAT engagement is priced on the number of returns, the condition of the records and what is left out, and none of that is knowable before a practice has seen your books. Describe the work once and the firms that cover Downtown will reply with a basis you can compare line by line.
`.trim();

const BB_AUDIT_INTRO = `
Auditors covering Business Bay work mostly for companies whose licence or free zone requires an annual audit, and for groups preparing for a bank facility or a sale. The firms on this page cover the district whether or not they have an office in it: fieldwork for a Business Bay trading company is largely done against the client's ledger, with one or two days on site for inventory and confirmations.

The first question is not the fee, it is whether the firm is acceptable to whoever will read the report. Several free zones accept audit reports only from firms on their own approved list, and a bank may insist on a firm it recognises. A clean report from a firm your free zone does not accept is a report you pay for twice, so confirm the list before you compare anything else.

The second is timing. Audit fees in the UAE are almost always quoted on the assumption that complete, reconciled records are ready on the first day of fieldwork. Business Bay companies are often young and have changed accounting systems or owners recently; if yours has, say so in the brief, because it is the single biggest reason a quote changes after work starts.

A third question is who signs. The partner whose name is on the opinion is the person accountable for it, and in a busy season a signing partner can carry a very large number of files; ask how many, and who does the fieldwork under them. A firm that answers plainly is usually a firm that will be plain about a qualification too.

Nothing on this page is priced. An audit is priced on the size and state of the books, the number of entities and the deadline, and the firms that can take yours will say what they base the fee on when they reply.
`.trim();

const DXB_VAT_INTRO = `
This page lists the VAT practices that cover Dubai, wherever in the emirate they sit. For most VAT work that is the right question: registrations, quarterly computations and voluntary disclosures are done against your accounting system, not at your desk, and a practice in Deira serves a company in Jebel Ali as easily as one next door. If your work needs someone on site — an inventory count, an excise warehouse, a group of companies whose records are on paper — the area pages below narrow the list to the practices covering that district.

The fact that matters most is whether a practice is a registered FTA tax agent. An agent can deal with the Federal Tax Authority in your name, answer a query and attend an audit; a consultant who is not an agent prepares the work for you to file. The badge beside a practice is an agent number we checked against the FTA's register. No badge means nobody has had a number checked, which is a reason to ask rather than a verdict.

Dubai companies change shape often — a free zone licence moved onshore, a second entity added, a group registration outgrown — and each change carries VAT consequences that are easier to get right before the first return than after it. When you describe the work, say what has changed in the last year.

No fees are published on this page. A VAT engagement is priced on the number of returns, the condition of the records and what the practice excludes, and you can compare those only once they have seen what you need.
`.trim();

const DEIRA_VAT_INTRO = `
Deira is where a great many Dubai trading companies keep their books, and the VAT practices serving it know the reverse-charge and designated-zone questions that come with import-heavy trade. This page is written and not yet published: it goes live when a person decides the copy is ready and the practices covering Deira clear the page's floors.
`.trim();

const FAQ: Record<string, { question: string; answer: string; scopeSpecific: boolean }[]> = {
  "business-bay|vat-and-tax": [
    {
      question: "Do I need a VAT consultant with an office in Business Bay?",
      answer:
        "Rarely. Registrations, returns and disclosures are done against your accounting system, and most Business Bay companies are served remotely. Choose on agent status and how the fee is structured, and use the office only as a tie-break.",
      scopeSpecific: true,
    },
    {
      question: "Can a practice covering Business Bay handle a DIFC or DMCC company?",
      answer:
        "Usually, but ask. Free zone companies register for VAT like any other, and the practices here cover the district next door as a matter of course — what differs is the free zone's own filing calendar, which a practice should know without looking it up.",
      scopeSpecific: true,
    },
    {
      question: "What does a registered FTA tax agent do that a consultant does not?",
      answer:
        "An agent is authorised to deal with the Federal Tax Authority in your name: respond to a query, attend an audit, request a reconsideration. A consultant who is not an agent prepares the work and you submit it yourself.",
      scopeSpecific: false,
    },
    {
      question: "How quickly should a VAT practice reply to an enquiry?",
      answer:
        "The reply time beside each practice is measured from the enquiries it has actually answered, not stated by the practice. A firm with no time shown has not answered enough enquiries for one to be measured yet.",
      scopeSpecific: false,
    },
  ],
  "downtown-dubai|vat-and-tax": [
    {
      question: "Which Downtown businesses need the most VAT attention?",
      answer:
        "Hospitality and retail, for volume and apportionment, and property management, for the treatment of service charges. Say which you are in the brief so the reply is specific.",
      scopeSpecific: true,
    },
    {
      question: "Are Downtown practices more expensive?",
      answer:
        "Not as a rule, and the practices here are not all in Downtown. Fees follow the number of returns and the state of the books, not the postcode of the practice.",
      scopeSpecific: true,
    },
    {
      question: "What does a registered FTA tax agent do that a consultant does not?",
      answer:
        "An agent deals with the Federal Tax Authority in your name. A consultant who is not an agent prepares the work for you to submit.",
      scopeSpecific: false,
    },
    {
      question: "Can I ask several practices at once?",
      answer:
        "Yes. Describe the work once and it goes to the practices covering Downtown that hold a verified trade licence, up to eight of them.",
      scopeSpecific: false,
    },
  ],
  "business-bay|audit-and-assurance": [
    {
      question: "Does my Business Bay company need an audit at all?",
      answer:
        "It depends on the licence and on who is asking. Mainland companies are often audited for a bank or a shareholder; free zone companies usually because the zone requires it at renewal.",
      scopeSpecific: true,
    },
    {
      question: "Can an auditor covering Business Bay audit a DMCC company?",
      answer:
        "Only if the firm is on DMCC's approved list. Ask for it before comparing fees — a report from a firm the zone does not accept will not be accepted at renewal.",
      scopeSpecific: true,
    },
    {
      question: "How long does an audit take?",
      answer:
        "Two to four weeks of fieldwork from complete, reconciled records is common for a small company. Incomplete records are the usual reason it takes longer.",
      scopeSpecific: false,
    },
    {
      question: "Is the fee fixed?",
      answer:
        "Usually fixed, on the assumption that records are ready. Read what the fee excludes before you accept it.",
      scopeSpecific: false,
    },
  ],
  "dubai|vat-and-tax": [
    {
      question: "Should I choose a VAT practice near my office?",
      answer:
        "Only if the work needs someone on site. For returns and registrations, choose on agent status, fee basis and measured reply time; the area pages narrow the list when location does matter.",
      scopeSpecific: true,
    },
    {
      question: "Do Dubai practices handle companies registered in Dubai's free zones?",
      answer:
        "Most do. A free zone company registers for VAT like a mainland one; what differs is the zone's own calendar and whether it is a designated zone for goods.",
      scopeSpecific: true,
    },
    {
      question: "What does a registered FTA tax agent do that a consultant does not?",
      answer:
        "An agent deals with the Federal Tax Authority in your name. A consultant who is not an agent prepares the work for you to submit.",
      scopeSpecific: false,
    },
    {
      question: "How are VAT engagements priced?",
      answer:
        "Per return, on a retainer, by the hour or as a fixed fee for a defined piece of work. The basis is on each practice's services; the amount comes back when you describe the work.",
      scopeSpecific: false,
    },
  ],
};

/* ── The run ─────────────────────────────────────────────────────────────── */

export async function seedServicesLanding(db: Db, now: Date): Promise<void> {
  console.log("→ services landing pages, for board 6a-s");
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const ahead = (days: number) => new Date(now.getTime() + days * DAY);

  const [vat, audit, family] = await Promise.all([
    db.category.findUnique({ where: { slug: "vat-and-tax" }, select: { id: true, name: true, synonyms: true } }),
    db.category.findUnique({ where: { slug: "audit-and-assurance" }, select: { id: true, name: true } }),
    db.scopeSheetFamily.findUnique({ where: { id: "professional-services" }, select: { id: true } }),
  ]);
  if (!vat || !audit || !family) {
    console.log("   skipped: the VAT or audit trade, or the professional-services family, is missing");
    return;
  }

  /*
     Two districts the base area list never had. Added here, after every
     generated listing, rather than in `AREAS`: the main seed draws a pin for
     each business from that list in order, and a new row there would move every
     draw after it and every fixture that pins one.
  */
  for (const area of [
    { slug: "business-bay", name: "Business Bay", nameAr: "الخليج التجاري", lat: 25.1855, lng: 55.2651 },
    { slug: "downtown-dubai", name: "Downtown Dubai", nameAr: "وسط مدينة دبي", lat: 25.1948, lng: 55.2789 },
  ]) {
    await db.area.upsert({
      where: { slug: area.slug },
      create: { emirate: "dubai", isFreeZone: false, ...area },
      update: {},
    });
  }
  const areaRows = await db.area.findMany({
    where: { slug: { in: ["business-bay", "downtown-dubai", "deira", "difc", "dmcc", "jebel-ali-free-zone"] } },
    select: { id: true, slug: true, emirate: true },
  });
  const areaOf = (slug: string) => areaRows.find((row) => row.slug === slug) ?? null;

  /* The trades' own wording, and the template opened for exactly these two. */
  await db.category.update({
    where: { id: vat.id },
    data: { pluralHuman: "VAT consultants", credentialKind: "fta_tax_agent", servicesLandingOpenedAt: ago(20) },
  });
  await db.category.update({
    where: { id: audit.id },
    data: { pluralHuman: "Auditors", credentialKind: "mof_audit_approval", servicesLandingOpenedAt: ago(20) },
  });
  for (const [slug, asks] of Object.entries(ASKS)) {
    const category = slug === "vat-and-tax" ? vat : audit;
    await db.categoryAsk.deleteMany({ where: { categoryId: category.id } });
    await db.categoryAsk.createMany({
      data: asks.map((ask, position) => ({ categoryId: category.id, position, ...ask })),
    });
  }

  /* A buyer of their own, so no other fixture's inbox grows. */
  const buyerId = seatId(1);
  await db.user.upsert({
    where: { id: buyerId },
    create: { id: buyerId, email: "procurement@6as-fixture.example", fullName: "Layla Haddad", roles: ["buyer"] },
    update: {},
  });

  await db.enquiry.deleteMany({ where: { ref: { startsWith: "ENQ-6AS" } } });
  await db.user.deleteMany({ where: { email: { startsWith: `owner@${PREFIX}` } } });
  await db.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });

  const firms = [...NAMED, ...generated()];
  let seat = 10;
  let enquiries = 0;
  for (const spec of firms) {
    const office = spec.office ? areaOf(spec.office) : null;
    const firm = await db.business.create({
      data: {
        slug: spec.slug,
        displayName: spec.displayName,
        tradeName: `${spec.displayName} LLC`,
        licenceNumber: spec.licence,
        licenceAuthority: spec.licence.startsWith("ADDED") ? "ADDED" : "DED",
        licenceExpiry: ahead(spec.licenceDays ?? 260),
        primaryCategoryId: vat.id,
        claimStatus: spec.claimed ? "claimed" : "unclaimed",
        publishedAt: ago(160),
        verificationTier: spec.tier,
        verifiedAt: spec.tier >= 1 ? ago(150) : null,
        planId: spec.claimed ? "basic" : null,
        sellsKind: spec.claimed ? "services" : "unset",
        scopeSheetFamilyId: spec.claimed ? family.id : null,
        deliveryModes: spec.claimed ? ["remote", "at_our_office"] : [],
        description: spec.description,
        establishedYear: 2009 + (spec.licence.charCodeAt(spec.licence.length - 1) % 12),
        source: spec.claimed ? "self_added" : "licence_import",
        searchText: buildBusinessSearchText({
          displayName: spec.displayName,
          tradeName: `${spec.displayName} LLC`,
          description: spec.description ?? "",
          categoryNames: [vat.name],
          synonyms: vat.synonyms,
        }),
        ...(office
          ? {
              locations: {
                create: {
                  type: "head_office",
                  emirate: office.emirate,
                  areaId: office.id,
                  addressLine: `${spec.displayName}, ${spec.office!.replace(/-/g, " ")}`,
                  published: true,
                  publishedAt: ago(160),
                },
              },
            }
          : {}),
      },
      select: { id: true },
    });

    const covers = spec.covers
      .map((row) => ({ emirate: row.emirate, areaId: row.area ? (areaOf(row.area)?.id ?? null) : null }))
      .filter((row, index, all) => all.findIndex((other) => other.emirate === row.emirate && other.areaId === row.areaId) === index);
    if (covers.length > 0) {
      await db.serviceCoverage.createMany({ data: covers.map((row) => ({ businessId: firm.id, ...row })) });
    }

    if (spec.vat) {
      const service = await db.service.create({
        data: {
          businessId: firm.id,
          categoryId: vat.id,
          name: spec.vat.name,
          slug: spec.vat.slug,
          position: 0,
          status: "live",
          publishedAt: ago(140),
          engagementType: "ongoing_contract",
          feeBasis: spec.vat.feeBasis,
          turnaround: "Within the filing window",
          deliveredWhere: spec.vat.delivered,
          deliverable: "Computation, working papers and the submission receipt",
          scope: "Quarterly VAT computation, reconciliation to the ledger and submission on the FTA portal.",
          ...(spec.vat.sectors ? { values: { create: [{ fieldKey: "sectors", value: spec.vat.sectors }] } } : {}),
        },
        select: { id: true },
      });
      const narrowed = (spec.vat.narrowedTo ?? []).map((row) => ({
        businessId: firm.id,
        serviceId: service.id,
        emirate: row.emirate,
        areaId: row.area ? (areaOf(row.area)?.id ?? null) : null,
      }));
      if (narrowed.length > 0) await db.serviceCoverage.createMany({ data: narrowed });
    }

    if (spec.audit) {
      await db.service.create({
        data: {
          businessId: firm.id,
          categoryId: audit.id,
          name: "Statutory audit",
          slug: "statutory-audit",
          position: 1,
          status: "live",
          publishedAt: ago(140),
          engagementType: "ongoing_contract",
          feeBasis: "fixed_fee",
          turnaround: "3–4 weeks from complete records",
          deliveredWhere: "at_our_office",
          deliverable: "Signed audit report and management letter",
          scope: "Planning, substantive testing, the signed report and a management letter on control weaknesses.",
        },
      });
    }

    for (const zone of spec.freeZones ?? []) {
      const area = areaOf(zone);
      if (area) await db.freeZoneRegistration.create({ data: { businessId: firm.id, areaId: area.id } });
    }

    if (spec.fta) {
      await db.credential.create({
        data: {
          businessId: firm.id,
          kind: "fta_tax_agent",
          identifier: spec.fta.number,
          issuer: "Federal Tax Authority",
          expiresOn:
            spec.fta.expiresInDays === null
              ? null
              : new Date(`${ahead(spec.fta.expiresInDays).toISOString().slice(0, 10)}T00:00:00.000Z`),
          trust: "register_verified",
          verifiedOn: ago(120),
          verifiedBy: "FTA tax agent register",
          review: "auto_verified",
          reviewOpenedAt: ago(120),
        },
      });
    }

    /*
       Reply history, for the few with a measured time. The seat is who
       answered — a reply from nobody is what board 7d's per-person figures
       refuse — and the dates are two to three months back, inside the ninety-
       day window and outside this month's plan cap.
    */
    if (spec.replies && spec.claimed) {
      const owner = seatId(seat);
      seat += 1;
      await db.user.create({
        data: {
          id: owner,
          email: `owner@${spec.slug}.example`,
          fullName: `${spec.displayName.split(" ")[0]} owner`,
          roles: ["seller_owner"],
          businessId: firm.id,
        },
      });
      for (const [j, minutes] of spec.replies.entries()) {
        const deliveredAt = ago(35 + j * 14 + (seat % 5));
        const enquiry = await db.enquiry.create({
          data: {
            ref: `ENQ-6AS${String(seat).padStart(2, "0")}${j}`,
            buyerId,
            requirement: "Quarterly VAT compliance for a trading company, two entities.",
            closesAt: new Date(deliveredAt.getTime() + 7 * DAY),
            createdAt: deliveredAt,
            emirate: "dubai",
            lines: { create: [{ description: "VAT compliance", qty: null, sortOrder: 0 }] },
          },
          select: { id: true },
        });
        const repliedAt = new Date(deliveredAt.getTime() + minutes * 60_000);
        await db.enquiryRecipient.create({
          data: {
            enquiryId: enquiry.id,
            businessId: firm.id,
            state: "quoted",
            createdAt: deliveredAt,
            openedAt: new Date(deliveredAt.getTime() + minutes * 30_000),
            firstReplyAt: repliedAt,
          },
        });
        await db.message.create({
          data: {
            enquiryId: enquiry.id,
            businessId: firm.id,
            senderId: owner,
            authorSide: "seller",
            body: "Thank you — we can take this on. Our proposal follows with the basis for the fee.",
            createdAt: repliedAt,
          },
        });
        enquiries += 1;
      }
    }
  }

  /* ── The pages ─────────────────────────────────────────────────────────── */

  const pages: { area: string | null; category: { id: string }; key: string; intro: string; meta: string | null; publish: boolean }[] = [
    {
      area: "business-bay",
      category: vat,
      key: "business-bay|vat-and-tax",
      intro: BB_VAT_INTRO,
      meta: "VAT consultants covering Business Bay, with registered FTA tax agents checked against the register, measured reply times and fee bases side by side.",
      publish: true,
    },
    {
      area: "downtown-dubai",
      category: vat,
      key: "downtown-dubai|vat-and-tax",
      intro: DT_VAT_INTRO,
      meta: null,
      publish: true,
    },
    {
      area: "business-bay",
      category: audit,
      key: "business-bay|audit-and-assurance",
      intro: BB_AUDIT_INTRO,
      meta: null,
      publish: true,
    },
    {
      area: "deira",
      category: vat,
      key: "deira|vat-and-tax",
      intro: DEIRA_VAT_INTRO,
      meta: null,
      publish: false,
    },
  ];

  for (const spec of pages) {
    const area = spec.area ? areaOf(spec.area) : null;
    if (!area) continue;
    const page = await db.areaPage.upsert({
      where: { areaId_categoryId: { areaId: area.id, categoryId: spec.category.id } },
      create: {
        areaId: area.id,
        categoryId: spec.category.id,
        intro: spec.intro,
        metaDescription: spec.meta,
        // Fixed, for §Freshness's reason: a seed that stamped today would claim
        // every page had been updated the morning somebody ran it.
        contentUpdatedAt: new Date(Date.UTC(2026, 8, 12)),
        publishedAt: spec.publish ? ago(20) : null,
        firstPublishedAt: spec.publish ? ago(20) : null,
      },
      update: {
        intro: spec.intro,
        metaDescription: spec.meta,
        contentUpdatedAt: new Date(Date.UTC(2026, 8, 12)),
        publishedAt: spec.publish ? ago(20) : null,
        firstPublishedAt: spec.publish ? ago(20) : null,
      },
      select: { id: true },
    });
    await db.landingFaq.deleteMany({ where: { areaPageId: page.id } });
    for (const [position, row] of (FAQ[spec.key] ?? []).entries()) {
      await db.landingFaq.create({ data: { areaPageId: page.id, position, liveToken: null, ...row } });
    }
  }

  /* D-EMI: the emirate class, below sector level. */
  const emiratePage = await db.emiratePage.upsert({
    where: { emirate_categoryId: { emirate: "dubai", categoryId: vat.id } },
    create: {
      emirate: "dubai",
      categoryId: vat.id,
      intro: DXB_VAT_INTRO,
      contentUpdatedAt: new Date(Date.UTC(2026, 8, 12)),
      publishedAt: ago(20),
      firstPublishedAt: ago(20),
    },
    update: {
      intro: DXB_VAT_INTRO,
      contentUpdatedAt: new Date(Date.UTC(2026, 8, 12)),
      publishedAt: ago(20),
      firstPublishedAt: ago(20),
    },
    select: { id: true },
  });
  await db.landingFaq.deleteMany({ where: { emiratePageId: emiratePage.id } });
  for (const [position, row] of (FAQ["dubai|vat-and-tax"] ?? []).entries()) {
    await db.landingFaq.create({ data: { emiratePageId: emiratePage.id, position, liveToken: null, ...row } });
  }

  const checked = firms.filter((firm) => firm.fta && (firm.fta.expiresInDays ?? 1) > 0).length;
  console.log(
    `   ${firms.length} practices (${checked} with a checked FTA number), ${enquiries} answered enquiries; VAT in Business Bay, Downtown and Dubai, audit in Business Bay published; Deira written and held`,
  );
}
