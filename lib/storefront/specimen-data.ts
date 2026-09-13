import type { SectionData } from "./render-data";

/**
 * The data the specimens page renders every section against.
 *
 * Written by hand, and named for what it is. Board 5g asks for every section
 * "at real scale" so a reviewer can answer *"what does enabling this actually
 * give the seller"* — which needs plausible content, not lorem, and not a real
 * seller's account either. A specimens page that reached into the database
 * would break when somebody edited a listing and would show one seller's
 * catalogue to every member of staff.
 *
 * Deliberately UAE-specific and deliberately unglamorous: nine products, two
 * branches, one review with a reply, one certificate that expires. A specimen
 * set where everything is full and nothing is missing hides exactly the states
 * the sections have to handle.
 */

/**
 * Days from a fixed date, not from today.
 *
 * The specimens page is a reference surface and a reviewer comparing two
 * screenshots a week apart should see the same dates. `new Date()` here would
 * make every specimen drift.
 */
const ANCHOR = Date.UTC(2026, 7, 26);
const day = (offset: number) => new Date(ANCHOR + offset * 86_400_000);

export const SPECIMEN_DATA: SectionData = {
  kind: "goods",
  work: null,
  business: {
    slug: "al-waha-valves-and-fittings",
    displayName: "Al Waha Valves & Fittings",
    tradeName: "Al Waha Valves & Fittings LLC",
    description:
      "Stockist of gate, globe and butterfly valves for contractors across Dubai and Sharjah. Counter sales from Al Quoz and scheduled site delivery.",
    // The top rung. It read 3, which was trade references — reserved, never
    // built, and now cut from the ladder — so the specimen rendered a badge for
    // a rung no storefront can hold.
    verificationTier: 2,
    verifiedAt: day(-64),
    // Measured, not chosen. 2 h 14 m.
    responseTimeMedianMs: 8_040_000,
    establishedYear: 2009,
    logoUrl: null,
  },

  locations: [
    {
      id: "loc-1",
      type: "head_office",
      emirate: "dubai",
      areaName: "Al Quoz Industrial 3",
      addressLine: "Warehouse 7, Street 12",
      phone: "+97143380192",
      lat: 25.1268,
      lng: 55.2404,
    },
    {
      id: "loc-2",
      type: "branch",
      emirate: "sharjah",
      areaName: "Industrial Area 4",
      addressLine: "Shop 4, Al Wahda Street",
      phone: "+97165331847",
      lat: 25.3197,
      lng: 55.4083,
    },
  ],

  products: [
    { id: "p1", slug: "gate-valve-dn100-pn16", name: "Gate valve DN100 PN16", sku: "GV-100-16", availability: "in_stock", stockQty: 84, leadTimeDays: null, minOrderQty: 1, sizeLabel: "DN100", imageUrl: null },
    { id: "p2", slug: "butterfly-valve-dn200", name: "Butterfly valve DN200 wafer", sku: "BV-200-W", availability: "in_stock", stockQty: 12, leadTimeDays: null, minOrderQty: 1, sizeLabel: "DN200", imageUrl: null },
    { id: "p3", slug: "globe-valve-dn50", name: "Globe valve DN50 flanged", sku: "GL-050-F", availability: "made_to_order", stockQty: null, leadTimeDays: 21, minOrderQty: 4, sizeLabel: "DN50", imageUrl: null },
    { id: "p4", slug: "check-valve-dn80", name: "Swing check valve DN80", sku: "CV-080", availability: "indent", stockQty: null, leadTimeDays: 45, minOrderQty: 10, sizeLabel: "DN80", imageUrl: null },
    { id: "p5", slug: "ball-valve-dn25", name: "Ball valve DN25 threaded", sku: "BA-025-T", availability: "out_of_stock", stockQty: 0, leadTimeDays: null, minOrderQty: 1, sizeLabel: "DN25", imageUrl: null },
    { id: "p6", slug: "strainer-dn100", name: "Y-strainer DN100", sku: "ST-100", availability: "in_stock", stockQty: 31, leadTimeDays: null, minOrderQty: 1, sizeLabel: "DN100", imageUrl: null },
  ],
  productCount: 214,

  categories: [
    { id: "c1", name: "Gate valves", count: 62 },
    { id: "c2", name: "Butterfly valves", count: 48 },
    { id: "c3", name: "Strainers & accessories", count: 31 },
  ],

  reviews: [
    {
      id: "r1",
      author: "Emirates Fitout Contracting",
      overall: 4,
      body: "Quoted within the day and the price held. Delivery slipped by one day against the three quoted, which we were told about in advance.",
      sellerReply:
        "Thank you. The delay was our transport contractor and we have changed it since.",
      createdAt: day(-21),
    },
  ],
  reviewSummary: { count: 1, average: 4 },

  documents: [
    // Filenames, because that is all `Document` holds. No title column and no
    // validity dates — the specimen must not show what the data cannot.
    { id: "d1", title: "iso-9001-2015.pdf", kind: "certificate", href: "#" },
    { id: "d2", title: "valve-range-catalogue-2026.pdf", kind: "catalogue", href: "#" },
    { id: "d3", title: "dn100-gate-valve-datasheet.pdf", kind: "datasheet", href: "#" },
  ],

  brands: [
    { id: "b1", name: "Grundfos", logoUrl: null },
    { id: "b2", name: "KSB", logoUrl: null },
    { id: "b3", name: "AVK", logoUrl: null },
    { id: "b4", name: "Crane", logoUrl: null },
  ],

  team: [
    // The branch line, never a mobile. Both of these consented.
    { id: "t1", name: "Rashid Al Mansoori", role: "Counter sales", phone: "+97143380192", photoUrl: null },
    { id: "t2", name: "Priya Nair", role: "Estimation", phone: "+97143380192", photoUrl: null },
  ],

  specRows: [
    { label: "Bore", values: ["DN100", "DN200", "DN50", "DN80", "DN25", "DN100"] },
    { label: "Pressure", values: ["PN16", "PN10", "PN16", "PN16", "PN25", "PN16"] },
    { label: "Body", values: ["Ductile iron", "Ductile iron", "Cast steel", "Cast iron", "Brass", "Cast iron"] },
    // A gap, on purpose. Nothing is fully specified and the table has to say so.
    { label: "Face to face", values: ["EN558-1", null, "EN558-1", null, null, null] },
  ],

  heroImageUrl: null,
};

/** What a seller filled in, per section type, for the specimen storefront. */
export const SPECIMEN_CONTENT: Record<string, Record<string, unknown>> = {
  hero: {
    eyebrow: "Al Quoz Industrial 3",
    headline: "Valves off the shelf, not off a catalogue",
    buttonLabel: "Ask for a quote",
  },
  enquiry_form: {
    intro: "Send the sizes and quantities. We quote from stock the same day where we have it.",
  },
  offer_banner: {
    headline: "Ramadan hours: counter open 9am to 3pm",
    body: "Site delivery runs as normal. Orders placed before 1pm go out the same day.",
    // Not a discount code. A string to quote inside an enquiry.
    reference: "RAMADAN26",
    endsOn: "2026-04-19",
  },
};

/*
 * ── Board `5c-s` — the specimen firm that sells work ─────────────────────────
 *
 * Meridian's four, in `1d-s` order, with the fee basis and turnaround from that
 * page's cards — including the unset fee basis on corporate tax registration,
 * which must render *Not stated* (B6). The render this board was drawn from
 * showed a firm that no longer exists on the track; since the section reads live
 * from scope sheets, a specimen showing services the seller does not have would
 * be showing something the section cannot produce.
 *
 * No fee amount anywhere, and no credential identifier carrying a figure: the
 * specimens page asserts the run holds no price.
 */
export const SPECIMEN_WORK_DATA: SectionData = {
  ...SPECIMEN_DATA,
  kind: "services",
  business: {
    slug: "meridian-chartered-accountants",
    displayName: "Meridian Chartered Accountants",
    tradeName: "Meridian Chartered Accountants LLC",
    description:
      "Statutory audit, VAT and corporate tax for contractors and trading companies. Audits from our Business Bay office; filings for clients in every emirate.",
    verificationTier: 2,
    verifiedAt: day(-88),
    responseTimeMedianMs: 10_800_000,
    establishedYear: 2009,
    logoUrl: null,
  },
  locations: [
    {
      id: "loc-m1",
      type: "head_office",
      emirate: "dubai",
      areaName: "Business Bay",
      addressLine: "Office 1406, Bay Square 3",
      phone: "+97144219930",
      lat: 25.1865,
      lng: 55.2797,
    },
  ],
  products: [],
  productCount: 0,
  categories: [],
  brands: [],
  team: [
    // The office line, never a mobile. Both consented, as the stockist's did.
    { id: "t-m1", name: "Farah Siddiqui", role: "Audit partner", phone: "+97144219930", photoUrl: null },
    { id: "t-m2", name: "Omar Haddad", role: "Tax manager", phone: "+97144219930", photoUrl: null },
  ],
  specRows: [],
  documents: [],
  reviews: [
    {
      id: "r-m1",
      author: "Gulf Crest Contracting",
      overall: 5,
      body: "The audit was signed inside the three weeks they said, and the management letter was specific enough to act on.",
      sellerReply: null,
      createdAt: day(-34),
    },
  ],
  reviewSummary: { count: 1, average: 5 },
  work: {
    services: [
      {
        id: "s1",
        slug: "statutory-audit",
        name: "Statutory audit",
        scope: "Signed report and management letter, IFRS or IFRS for SMEs.",
        engagementType: "one_off_job",
        turnaround: "3–4 weeks",
        feeBasis: "Fixed fee",
        deliveredWhere: "at_our_office",
        places: [{ emirate: "dubai", areaId: null, label: "Dubai" }],
      },
      {
        id: "s2",
        slug: "vat-return-filing",
        name: "VAT return filing",
        scope: "Filed return and the FTA acknowledgement, each quarter.",
        engagementType: "ongoing_contract",
        turnaround: "5 working days",
        feeBasis: "Per return",
        deliveredWhere: "remote",
        places: [
          { emirate: "abu_dhabi", areaId: null, label: "Abu Dhabi" },
          { emirate: "dubai", areaId: null, label: "Dubai" },
          { emirate: "sharjah", areaId: null, label: "Sharjah" },
        ],
      },
      {
        id: "s3",
        slug: "corporate-tax-registration",
        name: "Corporate tax registration",
        scope: "Registration confirmation and the first-period filing calendar.",
        engagementType: "one_off_job",
        turnaround: "2 weeks",
        // Unset on purpose — the gap the grid must say rather than hide.
        feeBasis: null,
        deliveredWhere: null,
        places: [
          { emirate: "abu_dhabi", areaId: null, label: "Abu Dhabi" },
          { emirate: "dubai", areaId: null, label: "Dubai" },
          { emirate: "sharjah", areaId: null, label: "Sharjah" },
        ],
      },
      {
        id: "s4",
        slug: "monthly-bookkeeping",
        name: "Monthly bookkeeping",
        scope: "Management accounts by the 10th, on your ledger or ours.",
        engagementType: "ongoing_contract",
        turnaround: "Ongoing",
        feeBasis: "Retainer",
        deliveredWhere: "remote",
        places: [
          { emirate: "abu_dhabi", areaId: null, label: "Abu Dhabi" },
          { emirate: "dubai", areaId: null, label: "Dubai" },
          { emirate: "sharjah", areaId: null, label: "Sharjah" },
        ],
      },
    ],
    credentials: [
      {
        id: "cr1",
        kind: "fta_tax_agent",
        identifier: "30014982",
        issuer: null,
        expiresOn: day(215),
        verified: true,
        verifiedBy: "FTA tax agent register",
      },
      {
        id: "cr2",
        kind: "mof_audit_approval",
        identifier: "Register no. 1142",
        issuer: "Ministry of Finance",
        expiresOn: day(127),
        verified: false,
        verifiedBy: null,
      },
      {
        id: "cr3",
        kind: "professional_body",
        identifier: "Two partners",
        issuer: "ACCA",
        expiresOn: day(127),
        verified: false,
        verifiedBy: null,
      },
    ],
    coverage: [
      { emirate: "abu_dhabi", areaId: null, label: "Abu Dhabi" },
      { emirate: "dubai", areaId: null, label: "Dubai" },
      { emirate: "sharjah", areaId: null, label: "Sharjah" },
    ],
    freeZones: [],
    sectors: [
      { label: "Contracting", engagements: 40 },
      { label: "Trading", engagements: 25 },
      { label: "Free zone entities", engagements: null },
    ],
    deliveryModes: ["remote", "at_our_office"],
  },
};

/**
 * What the specimen firm that sells work filled in — board `5c-s`.
 *
 * The stockist's hero reads *Valves off the shelf* and its enquiry intro asks
 * for sizes and quantities; rendered over an audit practice, the canvas showed
 * a firm that sells work asking for quantities, which is exactly the shared-copy
 * defect B5 names. No figure in any of it — the specimens page asserts that.
 */
export const SPECIMEN_WORK_CONTENT: Record<string, Record<string, unknown>> = {
  hero: {
    eyebrow: "Business Bay",
    headline: "Audits signed on the date we give you",
    buttonLabel: "Request a quote",
  },
  enquiry_form: {
    intro: "Tell us the entity, the year end and what the audit is for. We reply with a scope and a quote.",
  },
  offer_banner: {
    headline: "Ramadan hours: office open 9am to 3pm",
    body: "Filings due in Ramadan are prepared the week before, so nothing waits on reduced hours.",
    reference: "RAMADAN26",
    endsOn: "2026-04-19",
  },
};

/** The specimen content that belongs with a specimen's data. */
export function specimenContentFor(data: SectionData): Record<string, Record<string, unknown>> {
  return data.kind === "services" ? SPECIMEN_WORK_CONTENT : SPECIMEN_CONTENT;
}
