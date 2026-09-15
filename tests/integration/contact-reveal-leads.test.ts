import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  contactGate,
  landlinesFor,
  recordWhatsAppOpen,
  revealedInSession,
  revealForReturningVisitor,
  submitContactLead,
  type RevealViewer,
} from "@/lib/contact/service";
import { leadsForBusiness, leadsForStaff } from "@/lib/contact/leads";

/**
 * Board `1d` amendment — the reveal's rules, against a database.
 *
 * A fixture storefront of its own (claimed, published, a head office and a
 * branch with landlines), a second one with no landline, and an unclaimed one.
 * Every lead and reveal this file writes is on those three and removed with them.
 */

const STAMP = Date.now();
const SLUG = `contact-lead-fixture-${STAMP}`;
const FIELDS = { name: "Priya Menon", email: "Priya@MarinaFM.test", mobile: "050 641 2288" };

let businessId: string;
let bareId: string;
let unclaimedId: string;
let headId: string;
let branchId: string;

const viewer = (overrides: Partial<RevealViewer> = {}): RevealViewer => ({
  visitorId: null,
  sessionId: null,
  actorId: null,
  ...overrides,
});
/** A fresh rate-limit key per case, so the cases never share an allowance. */
const requester = () => `test-${randomUUID()}`;

beforeAll(async () => {
  const [category, area] = await Promise.all([
    prisma.category.findFirstOrThrow({ select: { id: true } }),
    prisma.area.findFirstOrThrow({ select: { id: true } }),
  ]);
  const base = {
    licenceAuthority: "DED" as const,
    licenceExpiry: new Date(STAMP + 365 * 86_400_000),
    primaryCategoryId: category.id,
    source: "licence_import" as const,
  };

  const business = await prisma.business.create({
    data: {
      ...base,
      tradeName: "Contact Lead Fixture LLC",
      displayName: "Contact Lead Fixture",
      slug: SLUG,
      licenceNumber: `DED-CL${STAMP}`,
      claimStatus: "claimed",
      publishedAt: new Date(STAMP - 86_400_000),
      locations: {
        create: [
          { type: "head_office", emirate: "dubai", areaId: area.id, addressLine: "Warehouse 14", phone: "04 883 4120", whatsapp: "+971506412288", published: true },
          { type: "trade_counter", emirate: "dubai", areaId: area.id, addressLine: "Shop 3", phone: "04 347 2019", published: true },
        ],
      },
    },
    select: { id: true, locations: { select: { id: true, type: true } } },
  });
  businessId = business.id;
  headId = business.locations.find((l) => l.type === "head_office")!.id;
  branchId = business.locations.find((l) => l.type === "trade_counter")!.id;

  bareId = (
    await prisma.business.create({
      data: {
        ...base,
        tradeName: "Contact Lead Bare LLC",
        displayName: "Contact Lead Bare",
        slug: `${SLUG}-bare`,
        licenceNumber: `DED-CB${STAMP}`,
        claimStatus: "claimed",
        publishedAt: new Date(STAMP - 86_400_000),
        locations: { create: [{ type: "head_office", emirate: "dubai", areaId: area.id, addressLine: "Office 2", published: true }] },
      },
      select: { id: true },
    })
  ).id;

  unclaimedId = (
    await prisma.business.create({
      data: {
        ...base,
        tradeName: "Contact Lead Unclaimed LLC",
        displayName: "Contact Lead Unclaimed",
        slug: `${SLUG}-unclaimed`,
        licenceNumber: `DED-CU${STAMP}`,
        publishedAt: new Date(STAMP - 86_400_000),
        locations: { create: [{ type: "head_office", emirate: "dubai", areaId: area.id, addressLine: "Office 9", phone: "04 111 2233", published: true }] },
      },
      select: { id: true },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.contactReveal.deleteMany({ where: { businessId: { in: [businessId, bareId, unclaimedId] } } });
  await prisma.contactLead.deleteMany({ where: { businessId: { in: [businessId, bareId, unclaimedId] } } });
});

afterAll(async () => {
  await prisma.business.deleteMany({ where: { slug: { startsWith: SLUG } } });
  await prisma.$disconnect();
});

describe("what a reveal hands back", () => {
  it("every published landline of a claimed storefront, head office first", async () => {
    const landlines = await landlinesFor(businessId);
    expect(landlines).toEqual({
      businessId,
      headLocationId: headId,
      numbers: {
        [headId]: { display: "04 883 4120", tel: "+97148834120" },
        [branchId]: { display: "04 347 2019", tel: "+97143472019" },
      },
    });
  });

  it("nothing for a storefront with no landline, or a listing nobody claimed (10g)", async () => {
    expect(await landlinesFor(bareId)).toBeNull();
    expect(await landlinesFor(unclaimedId)).toBeNull();
    const refused = await submitContactLead({ businessId: unclaimedId, fields: FIELDS, viewer: viewer(), sourcePath: null, requester: requester() });
    expect(refused).toEqual({ ok: false, reason: "no_landline" });
    expect(await prisma.contactLead.count({ where: { businessId: unclaimedId } })).toBe(0);
  });
});

describe("the form, submitted", () => {
  it("records the lead and one reveal, and mints the visitor and session", async () => {
    const outcome = await submitContactLead({
      businessId,
      fields: FIELDS,
      viewer: viewer(),
      sourcePath: "/search?q=valves",
      requester: requester(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.landlines.numbers[headId]?.display).toBe("04 883 4120");
    expect(outcome.visitorId).toMatch(/^[0-9a-f-]{36}$/);

    const lead = await prisma.contactLead.findFirstOrThrow({ where: { businessId }, include: { reveals: true } });
    expect(lead).toMatchObject({
      visitorId: outcome.visitorId,
      name: "Priya Menon",
      email: "priya@marinafm.test",
      mobile: "+971506412288",
      sourcePath: "/search?q=valves",
    });
    expect(lead.reveals).toHaveLength(1);
    expect(lead.reveals[0]).toMatchObject({
      channel: "phone",
      surface: "storefront",
      sessionId: outcome.sessionId,
      locationId: headId,
      sourcePath: "/search?q=valves",
    });
  });

  it("refuses bad fields with every problem, and writes nothing", async () => {
    const outcome = await submitContactLead({
      businessId,
      fields: { name: "", email: "nope", mobile: "04 883 4120" },
      viewer: viewer(),
      sourcePath: null,
      requester: requester(),
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "invalid",
      problems: { name: "name_missing", email: "email_shape", mobile: "mobile_not_uae" },
    });
    expect(await prisma.contactLead.count({ where: { businessId } })).toBe(0);
    expect(await prisma.contactReveal.count({ where: { businessId } })).toBe(0);
  });

  it("the database refuses a lead the form would have refused", async () => {
    await expect(
      prisma.contactLead.create({
        data: { businessId, visitorId: randomUUID(), name: "Priya", email: "priya@marinafm.test", mobile: "+97148834120" },
      }),
    ).rejects.toThrow(/contact_lead_mobile_e164/);
    await expect(
      prisma.contactLead.create({
        data: { businessId, visitorId: randomUUID(), name: "Priya", email: "Priya@Marina.test", mobile: "+971506412288" },
      }),
    ).rejects.toThrow(/contact_lead_email_shape/);
    await expect(
      prisma.contactLead.create({
        data: { businessId, visitorId: randomUUID(), name: "Priya", email: "p@m.test", mobile: "+971506412288", sourcePath: "https://evil.test/x" },
      }),
    ).rejects.toThrow(/contact_lead_source_is_a_path/);
  });
});

describe("once per visitor and listing (B10), once per session (B1, B6)", () => {
  it("a returning visitor reveals with no form, in a new session, as a new visit on the same lead", async () => {
    const first = await submitContactLead({ businessId, fields: FIELDS, viewer: viewer(), sourcePath: null, requester: requester() });
    if (!first.ok) throw new Error("submit refused");

    // Same session, again: the same row, not a second one.
    const again = await revealForReturningVisitor({
      businessId,
      viewer: viewer({ visitorId: first.visitorId, sessionId: first.sessionId }),
      sourcePath: null,
    });
    expect(again.ok).toBe(true);
    expect(await prisma.contactReveal.count({ where: { businessId } })).toBe(1);

    // A new session: masked again until clicked, then one more visit — and no second lead.
    const gate = await contactGate(businessId, viewer({ visitorId: first.visitorId, sessionId: "a-new-browser-session-0001" }));
    expect(gate).toEqual({ revealed: false, formRequired: false, prefill: null });
    const later = await revealForReturningVisitor({
      businessId,
      viewer: viewer({ visitorId: first.visitorId, sessionId: "a-new-browser-session-0001" }),
      sourcePath: "/c/valves",
    });
    expect(later.ok).toBe(true);
    expect(await prisma.contactLead.count({ where: { businessId } })).toBe(1);

    const page = await leadsForBusiness(businessId);
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({ name: "Priya Menon", reveals: 2, mobile: "+971 50 641 2288" });
  });

  it("a stranger is sent to the form, with nothing written", async () => {
    const outcome = await revealForReturningVisitor({ businessId, viewer: viewer({ sessionId: "stranger-session-00001" }), sourcePath: null });
    expect(outcome).toEqual({ ok: false, reason: "form_required", prefill: null });
    expect(await prisma.contactReveal.count({ where: { businessId } })).toBe(0);
  });

  it("the same browser on another listing is asked again, prefilled with what it gave last (B12)", async () => {
    const first = await submitContactLead({ businessId, fields: FIELDS, viewer: viewer(), sourcePath: null, requester: requester() });
    if (!first.ok) throw new Error("submit refused");
    // Another storefront with a landline: the seeded seller.
    const other = await prisma.business.findFirstOrThrow({
      where: { claimStatus: "claimed", publishedAt: { not: null }, suspendedAt: null, id: { not: businessId }, locations: { some: { published: true, phone: { not: null } } } },
      select: { id: true },
      orderBy: { slug: "asc" },
    });
    const gate = await contactGate(other.id, viewer({ visitorId: first.visitorId }));
    expect(gate.formRequired).toBe(true);
    expect(gate.prefill).toEqual({ name: "Priya Menon", email: "priya@marinafm.test", mobile: "50 641 2288" });
  });

  it("a signed-in buyer is matched on the account, so a second device is not asked again", async () => {
    const buyer = await prisma.user.findFirstOrThrow({ where: { roles: { has: "buyer" } }, select: { id: true } });
    const first = await submitContactLead({
      businessId,
      fields: FIELDS,
      viewer: viewer({ actorId: buyer.id }),
      sourcePath: null,
      requester: requester(),
    });
    expect(first.ok).toBe(true);
    const otherDevice = await contactGate(businessId, viewer({ actorId: buyer.id, visitorId: randomUUID() }));
    expect(otherDevice.formRequired).toBe(false);
  });

  it("renders revealed for the session that revealed, and only that one", async () => {
    const first = await submitContactLead({ businessId, fields: FIELDS, viewer: viewer(), sourcePath: null, requester: requester() });
    if (!first.ok) throw new Error("submit refused");
    expect((await contactGate(businessId, viewer({ sessionId: first.sessionId }))).revealed).toBe(true);
    expect((await revealedInSession(businessId, viewer({ sessionId: first.sessionId })))?.headLocationId).toBe(headId);
    expect(await revealedInSession(businessId, viewer({ sessionId: "somebody-elses-session" }))).toBeNull();
  });
});

describe("WhatsApp is not the gate (B4)", () => {
  it("records an open once per session where there is one, mints none where there is not, and asks nothing", async () => {
    await recordWhatsAppOpen({ businessId, viewer: viewer({ sessionId: "reveal-session-000001" }), sourcePath: null });
    await recordWhatsAppOpen({ businessId, viewer: viewer({ sessionId: "reveal-session-000001" }), sourcePath: null });
    await recordWhatsAppOpen({ businessId, viewer: viewer(), sourcePath: null });
    const rows = await prisma.contactReveal.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sessionId).sort()).toEqual([null, "reveal-session-000001"].sort());
    expect(rows.every((row) => row.channel === "whatsapp" && row.leadId === null)).toBe(true);
    expect(await prisma.contactLead.count({ where: { businessId } })).toBe(0);
  });
});

describe("the rate limit", () => {
  it("refuses the twenty-first new lead in an hour from one requester, and never an existing one", async () => {
    const key = requester();
    const ids = Array.from({ length: 20 }, () => randomUUID());
    await prisma.rateLimitHit.createMany({ data: ids.map(() => ({ bucket: "contact_lead", identifier: key })) });
    const refused = await submitContactLead({ businessId, fields: FIELDS, viewer: viewer(), sourcePath: null, requester: key });
    expect(refused).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(await prisma.contactLead.count({ where: { businessId } })).toBe(0);
    await prisma.rateLimitHit.deleteMany({ where: { identifier: key } });
  });
});

describe("the two panels", () => {
  it("staff read every listing's leads, narrowed by display name or slug", async () => {
    await submitContactLead({ businessId, fields: FIELDS, viewer: viewer(), sourcePath: `/b/${SLUG}/branches`, requester: requester() });
    const byName = await leadsForStaff({ supplier: "contact lead fixture" });
    expect(byName.rows.map((row) => row.business.slug)).toEqual([SLUG]);
    expect(byName.rows[0]!.source).toMatchObject({ kind: "storefront" });
    const bySlug = await leadsForStaff({ supplier: SLUG.toUpperCase() });
    expect(bySlug.total).toBe(1);
    const all = await leadsForStaff({});
    expect(all.total).toBeGreaterThanOrEqual(1);
  });
});
