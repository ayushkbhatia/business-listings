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
  business: {
    slug: "al-waha-valves-and-fittings",
    displayName: "Al Waha Valves & Fittings",
    tradeName: "Al Waha Valves & Fittings LLC",
    description:
      "Stockist of gate, globe and butterfly valves for contractors across Dubai and Sharjah. Counter sales from Al Quoz and scheduled site delivery.",
    // The top achievable rung. It read 3, which is now trade references —
    // reserved and unbuilt — so the specimen rendered a badge for a rung no
    // storefront can hold.
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
