import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board `1d` amendment — phone leads, for the two panels that read them.
 *
 * A reveal records a lead only when a buyer submits the form on a storefront,
 * which the acceptance suite does once per run against a fresh visitor. The
 * seller's and staff's lists would then read one row each, which tests the
 * empty state and little else — the lesson in `seed-what-the-e2e-cannot-reach`.
 *
 * So: six leads on the Pro seller seat's own listing (Al Marwan, the storefront
 * `tests/e2e/storefront.spec.ts` reveals on), one per source the table words —
 * a search with a phrase, a category page, the home page, the seller's own
 * branches tab, another supplier's storefront and direct — with one buyer who
 * came back in two more sessions; and two on another claimed seller, so the
 * staff list has a supplier column worth reading.
 *
 * Rows only, beside the listings' existing ones: no shared fixture changes
 * state. Emails are on the reserved `.test` domain and mobiles are unallocated.
 * The wall clock, because *in the last 30 days* is measured from now.
 */

type Db = PrismaClient;

const HOUR = 3_600_000;

export const CONTACT_LEAD_SELLER_SLUG = "al-marwan-industrial-supplies-llc";

const LEADS = [
  { visitor: "7a1d0000-0000-4000-8000-00000000c001", name: "Rashid Al Mansoori", email: "rashid@gulf-mep.test", mobile: "+971506410001", source: "/search?q=butterfly+valves+dn100", hoursAgo: 3, sessions: 3 },
  { visitor: "7a1d0000-0000-4000-8000-00000000c002", name: "Anita Fernandes", email: "procurement@marina-fm.test", mobile: "+971552040002", source: "/c/valves-and-fittings", hoursAgo: 27, sessions: 1 },
  { visitor: "7a1d0000-0000-4000-8000-00000000c003", name: "Omar Haddad", email: "omar.haddad@coastline.test", mobile: "+971529930003", source: null, hoursAgo: 52, sessions: 1 },
  { visitor: "7a1d0000-0000-4000-8000-00000000c004", name: "Hessa Al Suwaidi", email: "hessa@al-rawabi.test", mobile: "+971507720004", source: "/", hoursAgo: 75, sessions: 1 },
  { visitor: "7a1d0000-0000-4000-8000-00000000c005", name: "Sanjay Pillai", email: "sanjay@pillai-contracting.test", mobile: "+971561180005", source: "/b/al-marwan-industrial-supplies-llc/branches", hoursAgo: 120, sessions: 1 },
  { visitor: "7a1d0000-0000-4000-8000-00000000c006", name: "Farah Qasim", email: "farah@qasim-build.test", mobile: "+971585550006", source: "/b/elsewhere-fixture", hoursAgo: 24 * 41, sessions: 1 },
] as const;

export async function seedContactLeads(db: Db, now: Date) {
  console.log("→ phone leads, for the 1d amendment's two panels");
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);

  const seller = await db.business.findUnique({
    where: { slug: CONTACT_LEAD_SELLER_SLUG },
    select: { id: true, locations: { where: { published: true }, select: { id: true }, orderBy: [{ type: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 1 } },
  });
  if (!seller) throw new Error(`seed: no ${CONTACT_LEAD_SELLER_SLUG} for the phone leads`);

  const other = await db.business.findFirst({
    where: { claimStatus: "claimed", publishedAt: { not: null }, suspendedAt: null, slug: { not: CONTACT_LEAD_SELLER_SLUG }, locations: { some: { published: true, phone: { not: null } } } },
    select: { id: true },
    orderBy: { slug: "asc" },
  });

  const rows = [
    ...LEADS.map((lead) => ({ ...lead, businessId: seller.id, locationId: seller.locations[0]?.id ?? null })),
    ...(other
      ? [
          { visitor: "7a1d0000-0000-4000-8000-00000000c101", name: "Mariam Yousef", email: "mariam@yousef-fitout.test", mobile: "+971501230101", source: "/search?q=grooved+couplings", hoursAgo: 8, sessions: 1, businessId: other.id, locationId: null },
          { visitor: "7a1d0000-0000-4000-8000-00000000c102", name: "Deepak Rao", email: "deepak@rao-hvac.test", mobile: "+971551230102", source: null, hoursAgo: 30, sessions: 2, businessId: other.id, locationId: null },
        ]
      : []),
  ];

  for (const [index, lead] of rows.entries()) {
    const created = at(lead.hoursAgo);
    const record = await db.contactLead.create({
      data: {
        businessId: lead.businessId,
        visitorId: lead.visitor,
        name: lead.name,
        email: lead.email,
        mobile: lead.mobile,
        sourcePath: lead.source,
        createdAt: created,
      },
      select: { id: true },
    });
    await db.contactReveal.createMany({
      data: Array.from({ length: lead.sessions }, (_, session) => ({
        businessId: lead.businessId,
        locationId: lead.locationId,
        channel: "phone" as const,
        surface: "storefront",
        sessionId: `seedrevealsession${String(index).padStart(3, "0")}${session}`,
        leadId: record.id,
        sourcePath: session === 0 ? lead.source : `/b/${CONTACT_LEAD_SELLER_SLUG}`,
        createdAt: new Date(created.getTime() + session * 26 * HOUR),
      })),
    });
  }
  console.log(`   ${rows.length} phone leads`);
}
