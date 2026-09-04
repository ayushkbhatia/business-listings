import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  cancelCatalogueImport,
  completeCatalogueImport,
  conciergeOfferFor,
  openCatalogueImports,
  rejectCatalogueImport,
  requestCatalogueImport,
  startCatalogueImport,
} from "@/lib/catalogue-import/service";
import {
  CATALOGUE_IMPORT_PRICING_KEY,
  FALLBACK_CATALOGUE_PRICING,
  parseCataloguePricing,
  workingDaysFrom,
} from "@/lib/catalogue-import/pricing";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * The concierge catalogue load, against a real database.
 *
 * Four of these are about money and one is about the audit log, and both are
 * the parts a unit test cannot reach: what Prisma actually wrote, and what a
 * transaction actually committed alongside it.
 *
 * The fee freeze is the one worth reading twice. `feeAed` is stamped onto the
 * row at the moment of asking, so a seller who agreed to AED 250 owes AED 250
 * after somebody edits the platform setting — the alternative is a price that
 * changes under a request already in the queue, which is the kind of thing
 * nobody notices until an invoice is wrong.
 */

const actor = (id: string, businessId: string, ...roles: Role[]): Actor => ({
  id,
  roles,
  businessId,
});

const REASON = "Read the PDF, keyed the first fifty valves in against the DN template.";

let opsLeadId: string;
let categoryId: string;
let seq = 0;

/** The setting row as it was found, so `afterAll` puts it back. */
let originalPricing: { value: unknown } | null = null;

/**
 * What this file created, so it can take it away again.
 *
 * Businesses go first: `CatalogueImportRequest.requestedById` is
 * `onDelete: Restrict`, so a seat cannot be deleted while a request points at
 * it, and deleting the listing cascades the requests out of the way.
 */
const createdBusinessIds: string[] = [];
const createdUserIds: string[] = [];

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      select: { id: true },
    })
  ).id;
  categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;

  originalPricing = await prisma.platformSetting.findUnique({
    where: { key: CATALOGUE_IMPORT_PRICING_KEY },
    select: { value: true },
  });
});

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  /*
     The setting is platform-wide and shared with every other suite on this
     database. Leaving a test's prices behind would make the next run's
     failures belong to this file.
  */
  if (originalPricing) {
    await prisma.platformSetting.upsert({
      where: { key: CATALOGUE_IMPORT_PRICING_KEY },
      update: { value: originalPricing.value as never },
      create: { key: CATALOGUE_IMPORT_PRICING_KEY, value: originalPricing.value as never },
    });
  } else {
    await prisma.platformSetting
      .delete({ where: { key: CATALOGUE_IMPORT_PRICING_KEY } })
      .catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function setPricing(value: unknown): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: CATALOGUE_IMPORT_PRICING_KEY },
    update: { value: value as never },
    create: { key: CATALOGUE_IMPORT_PRICING_KEY, value: value as never },
  });
}

/** A listing on a named plan, with an owner seat and a catalogue file already uploaded. */
async function seller(planId: string) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;

  const business = await prisma.business.create({
    data: {
      tradeName: `Concierge Trading ${stamp}`,
      displayName: `Concierge Trading ${stamp}`,
      slug: `catalogue-import-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId,
      publishedAt: new Date(),
    },
    select: { id: true },
  });

  const owner = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      fullName: `Concierge Owner ${stamp}`,
      roles: ["seller_owner"],
      businessId: business.id,
    },
    select: { id: true },
  });

  const document = await prisma.document.create({
    data: {
      businessId: business.id,
      kind: "catalogue",
      storagePath: `${business.id}/catalogue/price-list-${stamp}.pdf`,
      filename: "price-list.pdf",
      mimeType: "application/pdf",
      bytes: 2_400_000,
    },
    select: { id: true },
  });

  createdBusinessIds.push(business.id);
  createdUserIds.push(owner.id);

  return {
    businessId: business.id,
    actor: actor(owner.id, business.id, "seller_owner"),
    documentId: document.id,
  };
}

describe("what a plan is offered", () => {
  it("does not offer a catalogue load on Free", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const free = await seller("free");

    const offer = await conciergeOfferFor(free.businessId);
    expect(offer.offered).toBe(false);

    const result = await requestCatalogueImport(free.actor, free.businessId, {
      documentId: free.documentId,
    });
    expect(result).toEqual({ ok: false, error: "not_offered" });

    // And nothing reached the queue. A refusal that still wrote a row would be
    // work somebody has to close.
    const rows = await prisma.catalogueImportRequest.count({
      where: { businessId: free.businessId },
    });
    expect(rows).toBe(0);
  });

  it("caps what it promises at the seller's own product limit", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const basic = await seller("basic");

    // Basic holds 150 products, so the panel's fifty stands.
    expect((await conciergeOfferFor(basic.businessId)).productLimit).toBe(50);

    await prisma.business.update({
      where: { id: basic.businessId },
      data: { plan: { connect: { id: "free" } } },
    });
    // Free holds ten. Promising fifty to that seller would be a number the
    // product cannot honour.
    expect((await conciergeOfferFor(basic.businessId)).productLimit).toBe(10);
  });
});

describe("asking for one", () => {
  it("freezes the fee, and a later change to the setting does not move it", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const basic = await seller("basic");

    const asked = await requestCatalogueImport(basic.actor, basic.businessId, {
      documentId: basic.documentId,
      note: "Pages 4 to 11. Ignore the discontinued column.",
    });
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;
    expect(asked.feeAed).toBe(250);

    // Somebody puts the price up.
    await setPricing({ ...FALLBACK_CATALOGUE_PRICING, basic: { offered: true, feeAed: 400 } });

    const row = await prisma.catalogueImportRequest.findUniqueOrThrow({
      where: { id: asked.id },
      select: { feeAed: true },
    });
    expect(row.feeAed).toBe(250);

    // The seller's own screen reads the row, not the setting.
    const offer = await conciergeOfferFor(basic.businessId);
    expect(offer.request?.feeAed).toBe(250);
    // The new price is what the *next* seller is quoted.
    expect(offer.feeAed).toBe(400);
  });

  it("resolves the due date two working days out, skipping Friday and Saturday", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const basic = await seller("basic");

    // A Thursday. Friday and Saturday are the trade week's weekend, so two
    // working days later is the following Monday.
    const thursday = new Date("2026-09-03T06:00:00.000Z");
    const asked = await requestCatalogueImport(
      basic.actor,
      basic.businessId,
      { documentId: basic.documentId },
      thursday,
    );
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;
    expect(asked.dueAt.toISOString()).toBe(
      workingDaysFrom(thursday, 2).toISOString(),
    );
    expect(asked.dueAt.toISOString().slice(0, 10)).toBe("2026-09-07");
  });

  it("refuses a second request while one is open", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const basic = await seller("basic");

    const first = await requestCatalogueImport(basic.actor, basic.businessId, {
      documentId: basic.documentId,
    });
    expect(first.ok).toBe(true);

    const second = await requestCatalogueImport(basic.actor, basic.businessId, {
      documentId: basic.documentId,
    });
    expect(second).toEqual({ ok: false, error: "already_open" });

    expect(
      await prisma.catalogueImportRequest.count({ where: { businessId: basic.businessId } }),
    ).toBe(1);
  });

  it("refuses a seat that is not this business", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const mine = await seller("basic");
    const theirs = await seller("basic");

    const result = await requestCatalogueImport(theirs.actor, mine.businessId, {
      documentId: mine.documentId,
    });
    expect(result).toEqual({ ok: false, error: "not_your_business" });
  });
});

describe("the audit trail", () => {
  it("writes a row carrying the written reason when staff finish a load", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const basic = await seller("basic");
    const asked = await requestCatalogueImport(basic.actor, basic.businessId, {
      documentId: basic.documentId,
    });
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;

    const staff: Actor = { id: opsLeadId, roles: ["staff_ops_lead"] };
    expect(await startCatalogueImport(staff, asked.id, "Picked this up off the queue.")).toEqual({
      ok: true,
    });
    expect(
      await completeCatalogueImport(staff, asked.id, { productsLoaded: 47, reason: REASON }),
    ).toEqual({ ok: true });

    const row = await prisma.catalogueImportRequest.findUniqueOrThrow({
      where: { id: asked.id },
      select: { status: true, productsLoaded: true, loadedAt: true },
    });
    expect(row.status).toBe("loaded");
    expect(row.productsLoaded).toBe(47);
    expect(row.loadedAt).not.toBeNull();

    const audit = await prisma.auditEvent.findMany({
      where: { subject: `CatalogueImportRequest:${asked.id}` },
      orderBy: { createdAt: "asc" },
      select: { action: true, actorId: true, reason: true, after: true },
    });

    // One for the start, one for the completion. Both carry a reason somebody
    // wrote — `AuditEvent.reason` is NOT NULL because the log records decisions.
    expect(audit).toHaveLength(2);
    expect(audit.every((event) => event.actorId === opsLeadId)).toBe(true);
    expect(audit.every((event) => event.action === "queue_decided")).toBe(true);
    expect(audit.every((event) => (event.reason ?? "").trim().length > 0)).toBe(true);
    expect(audit[1]?.reason).toBe(REASON);
    expect(audit[1]?.after).toMatchObject({ status: "loaded", productsLoaded: 47 });
  });

  it("writes nothing when the seller withdraws their own request", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const basic = await seller("basic");
    const asked = await requestCatalogueImport(basic.actor, basic.businessId, {
      documentId: basic.documentId,
    });
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;

    expect(await cancelCatalogueImport(basic.actor, asked.id)).toEqual({ ok: true });

    const row = await prisma.catalogueImportRequest.findUniqueOrThrow({
      where: { id: asked.id },
      select: { status: true, cancelledAt: true },
    });
    expect(row.status).toBe("cancelled");
    expect(row.cancelledAt).not.toBeNull();

    /*
       The subject acting on their own data. The audit log exists to record what
       staff decided about somebody else's listing, and a seller taking back a
       file they sent is not one of those — putting it in the same log would
       make the log harder to read rather than more complete.
    */
    const audit = await prisma.auditEvent.count({
      where: { subject: `CatalogueImportRequest:${asked.id}` },
    });
    expect(audit).toBe(0);

    // And the seller may send another. Withdrawing is not a penalty.
    const again = await requestCatalogueImport(basic.actor, basic.businessId, {
      documentId: basic.documentId,
    });
    expect(again.ok).toBe(true);
  });

  it("audits a staff refusal, which is what separates it from the seller's cancel", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const basic = await seller("basic");
    const asked = await requestCatalogueImport(basic.actor, basic.businessId, {
      documentId: basic.documentId,
    });
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;

    const staff: Actor = { id: opsLeadId, roles: ["staff_ops_lead"] };
    expect(
      await rejectCatalogueImport(staff, asked.id, "Scan is unreadable below page 3. Asked for a resend."),
    ).toEqual({ ok: true });

    const [row, audit] = await Promise.all([
      prisma.catalogueImportRequest.findUniqueOrThrow({
        where: { id: asked.id },
        select: { status: true },
      }),
      prisma.auditEvent.count({ where: { subject: `CatalogueImportRequest:${asked.id}` } }),
    ]);
    // `cancelled`, because the enum has no `rejected` and should not grow one:
    // its doc comment says cancelled is either side withdrawing.
    expect(row.status).toBe("cancelled");
    expect(audit).toBe(1);
  });
});

describe("the staff queue", () => {
  it("lists open work only, and names the seller by displayName", async () => {
    await setPricing(FALLBACK_CATALOGUE_PRICING);
    const open = await seller("basic");
    const withdrawn = await seller("basic");

    const asked = await requestCatalogueImport(open.actor, open.businessId, {
      documentId: open.documentId,
    });
    const dropped = await requestCatalogueImport(withdrawn.actor, withdrawn.businessId, {
      documentId: withdrawn.documentId,
    });
    expect(asked.ok && dropped.ok).toBe(true);
    if (!asked.ok || !dropped.ok) return;
    await cancelCatalogueImport(withdrawn.actor, dropped.id);

    const queue = await openCatalogueImports(200);
    const ids = queue.map((row) => row.id);
    expect(ids).toContain(asked.id);
    expect(ids).not.toContain(dropped.id);

    const row = queue.find((entry) => entry.id === asked.id);
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: open.businessId },
      select: { displayName: true, tradeName: true },
    });
    expect(row?.business.displayName).toBe(business.displayName);
  });
});

describe("the pricing setting", () => {
  it("drops one mangled plan and keeps the rest answerable", () => {
    const parsed = parseCataloguePricing({
      basic: { offered: true, feeAed: 300 },
      // Not a whole number of dirhams. Coercing it would freeze a fee nobody
      // can read back off an invoice.
      pro: { offered: true, feeAed: 12.5 },
      free: { offered: "no", feeAed: 0 },
    });

    expect(parsed).toEqual({ basic: { offered: true, feeAed: 300 } });
  });

  it("skips the weekend from any starting day", () => {
    // 2026-09-04 is a Friday in Dubai; 2026-09-05 a Saturday.
    const friday = new Date("2026-09-04T06:00:00.000Z");
    expect(workingDaysFrom(friday, 1).toISOString().slice(0, 10)).toBe("2026-09-06");
    expect(workingDaysFrom(friday, 2).toISOString().slice(0, 10)).toBe("2026-09-07");

    // A Wednesday runs straight into Thursday and then jumps the weekend.
    const wednesday = new Date("2026-09-02T06:00:00.000Z");
    expect(workingDaysFrom(wednesday, 2).toISOString().slice(0, 10)).toBe("2026-09-06");
  });
});
