import type { ContactLeadPage, ContactLeadRow } from "@/lib/contact/leads";
import { leadSource } from "@/lib/contact/lead-form";

/**
 * Board `1d` amendment — the gallery's facts for the contact reveal.
 *
 * Al Waha Industrial Supplies, the board's own storefront, with a Jebel Ali
 * head office on `04 883 4120` and a branch in Al Quoz. The numbers only ever
 * reach a specimen that is drawn revealed, which is the rule the page keeps.
 */

export const GALLERY_SUPPLIER = "Al Waha Industrial Supplies";
export const GALLERY_SLUG = "al-waha-industrial-supplies";
export const GALLERY_BUSINESS_ID = "gallery-contact-reveal";
export const GALLERY_NOTE =
  "Counted as a lead in this seller's analytics, with the page you came from recorded as the source.";

export const HEAD_ID = "gallery-head-office";
export const BRANCH_ID = "gallery-al-quoz";

export const MASKED = "04 88• ••••";
export const BRANCH_MASKED = "04 34• ••••";

export const REVEALED = {
  headLocationId: HEAD_ID,
  numbers: {
    [HEAD_ID]: { display: "04 883 4120", tel: "+97148834120" },
    [BRANCH_ID]: { display: "04 347 2019", tel: "+97143472019" },
  },
};

export const WHATSAPP_HREF = "https://wa.me/971506412288";

const AT = new Date("2026-09-15T08:00:00.000Z");
const hoursAgo = (h: number) => new Date(AT.getTime() - h * 3_600_000);

function row(
  id: string,
  name: string,
  email: string,
  mobile: string,
  mobileTel: string,
  path: string | null,
  created: Date,
  reveals: number,
  business = { id: GALLERY_BUSINESS_ID, displayName: GALLERY_SUPPLIER, slug: GALLERY_SLUG },
): ContactLeadRow {
  return {
    id,
    name,
    email,
    mobile,
    mobileTel,
    source: leadSource(path, business.slug),
    createdAt: created,
    reveals,
    lastRevealedAt: reveals > 1 ? hoursAgo(2) : created,
    business,
  };
}

const ROWS: ContactLeadRow[] = [
  row("l1", "Rashid Al Mansoori", "rashid@gulf-mep.test", "+971 50 641 2288", "+971506412288", "/search?q=butterfly+valves+dn100", hoursAgo(3), 2),
  row("l2", "Anita Fernandes", "procurement@marina-fm.test", "+971 55 204 8817", "+971552048817", "/c/valves-actuators", hoursAgo(26), 1),
  row("l3", "Omar Haddad", "omar.haddad@coastline.test", "+971 52 993 0114", "+971529930114", null, hoursAgo(50), 1),
  row("l4", "Sanjay Pillai", "sanjay@pillai-contracting.test", "+971 56 118 4402", "+971561184402", "/b/fireline-ducting-works", hoursAgo(98), 3),
];

export const SELLER_PAGE: ContactLeadPage = { rows: ROWS, total: ROWS.length, page: 1, pageSize: 50, recent: 4 };

export const STAFF_PAGE: ContactLeadPage = {
  rows: [
    ...ROWS.slice(0, 2),
    row("l5", "Hessa Al Suwaidi", "hessa@al-rawabi.test", "+971 50 772 1930", "+971507721930", "/", hoursAgo(5), 1, {
      id: "gallery-fireline",
      displayName: "Fireline Ducting Works",
      slug: "fireline-ducting-works",
    }),
  ],
  total: 3,
  page: 1,
  pageSize: 50,
  recent: 3,
};
