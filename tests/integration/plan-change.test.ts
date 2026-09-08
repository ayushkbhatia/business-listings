import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/db/generated/client";
import type { ProductStatus } from "@/lib/db/generated/enums";
import { prisma } from "@/lib/db/client";
import { actorFromDevSeller } from "@/lib/auth/dev-seller";
import type { Actor } from "@/lib/auth/roles";
import {
  applyDueChanges,
  pendingChangeFor,
  saveKeep,
  scheduleChange,
  withdrawChange,
} from "@/lib/billing/schedule";
import { changePlan, changeTerm, quoteTermChange } from "@/lib/billing/service";
import { creditNoteFor, issueInvoice, storedTotals } from "@/lib/billing/invoice";

/**
 * Board 11f's downgrade model, against a real database.
 *
 * The unit suite proves the grid arithmetic. This proves the four things only
 * Postgres can answer: that a downgrade is scheduled rather than applied, that
 * exactly one change can be pending, that applying it honours the seller's
 * choice, and that an issued invoice is immutable.
 */

/**
 * A seeded seller with a subscription and an owner seat, and no other test.
 *
 * Pinned by slug rather than taken from `findFirst`, which is how this file
 * first went wrong. Without an `orderBy` Postgres returned whichever row it
 * liked, and on this database that was `al-marwan-industrial-supplies-llc` —
 * which `import.test.ts` owns. This file then left it on a different plan with a
 * different entitlement snapshot, and the import suite's product-cap test failed
 * on a change that had nothing to do with importing: `effectiveCaps` prefers a
 * snapshot over the live `Plan` row, so the cap that test had just written was
 * being ignored.
 *
 * Two rules out of that, and they are the same rule twice: pin the fixture, and
 * put back every column you touched. `al-rukn-fze` appears in no other suite —
 * `al-sahra` and `desert-anchor` are the response-time e2e spec's.
 */
const SLUG = "al-rukn-fze";

let businessId = "";
let actor: Actor;

/** The subscription as it was, restored in full. See the note above. */
let original: {
  planId: string | null;
  subPlanId: string;
  entitlementSnapshot: unknown;
  hiddenByPlan: unknown;
  productStatuses: { id: string; status: ProductStatus }[];
  /*
     The period, because a term change moves all four of these.

     `changeTerm` writes `term`, `periodStartedAt`, `renewsAt` and `anchorDay`
     together — it opens a new period, which is the half a plan change does not
     do. Leaving any of them behind puts this fixture on a period no other suite
     expects, and `renewsAt` in particular is what `renewal-job` selects on.
  */
  term: "monthly" | "annual";
  periodStartedAt: Date;
  renewsAt: Date;
  anchorDay: number;
} | null = null;

beforeAll(async () => {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: SLUG },
    select: {
      id: true,
      planId: true,
      subscription: {
        select: {
          planId: true,
          entitlementSnapshot: true,
          hiddenByPlan: true,
          term: true,
          periodStartedAt: true,
          renewsAt: true,
          anchorDay: true,
        },
      },
      team: { where: { roles: { has: "seller_owner" } }, select: { id: true, roles: true }, take: 1 },
      products: { select: { id: true, status: true } },
    },
  });

  businessId = business.id;
  const owner = business.team[0];
  if (!owner) throw new Error(`${SLUG} has no owner seat`);
  if (!business.subscription) throw new Error(`${SLUG} has no subscription`);

  actor = actorFromDevSeller({ userId: owner.id, roles: owner.roles, businessId });
  original = {
    planId: business.planId,
    subPlanId: business.subscription.planId,
    entitlementSnapshot: business.subscription.entitlementSnapshot,
    hiddenByPlan: business.subscription.hiddenByPlan,
    productStatuses: business.products,
    term: business.subscription.term,
    periodStartedAt: business.subscription.periodStartedAt,
    renewsAt: business.subscription.renewsAt,
    anchorDay: business.subscription.anchorDay,
  };
});

/**
 * Every change row this file writes.
 *
 * The seed's own pending changes belong to other businesses and are left alone:
 * repurposing a shared fixture is how a board that asserts on one breaks the
 * board that asserted on it first.
 */
/**
 * Rows the term-change tests raise, tracked by id rather than by predicate.
 *
 * `deleteMany({ businessId })` would take the seed's own invoices and movements
 * with them — the failure `seed-states-are-shared` names, and the reason this
 * file's header already insists on pinning a fixture.
 */
const raisedInvoices: string[] = [];

afterEach(async () => {
  await prisma.subscriptionChange.deleteMany({ where: { businessId } });
  if (raisedInvoices.length > 0) {
    // Lines cascade with the row; the movement is found by the invoice's window.
    await prisma.invoice.deleteMany({ where: { id: { in: raisedInvoices.splice(0) } } });
  }
});

afterAll(async () => {
  if (original) {
    await prisma.business.update({
      where: { id: businessId },
      data: { planId: original.planId },
    });
    await prisma.subscription.updateMany({
      where: { businessId },
      data: {
        planId: original.subPlanId,
        // The snapshot is what `effectiveCaps` prefers over the live plan row, so
        // leaving one behind quietly grandfathers the fixture onto caps no other
        // test expects. That is the failure this restore exists to prevent.
        entitlementSnapshot: (original.entitlementSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue,
        hiddenByPlan: (original.hiddenByPlan ?? Prisma.DbNull) as Prisma.InputJsonValue,
        term: original.term,
        periodStartedAt: original.periodStartedAt,
        renewsAt: original.renewsAt,
        anchorDay: original.anchorDay,
      },
    });
    // And the catalogue, which this file drafts and re-lists.
    for (const product of original.productStatuses) {
      await prisma.product.update({ where: { id: product.id }, data: { status: product.status } });
    }
  }
  await prisma.$disconnect();
});

async function onPlan(planId: string) {
  await prisma.business.update({ where: { id: businessId }, data: { planId } });
  await prisma.subscription.updateMany({ where: { businessId }, data: { planId } });
}

/**
 * Forget what the platform has hidden so far.
 *
 * `hiddenByPlan` is deliberately cumulative — a Pro → Basic → Free walk has to
 * restore correctly on the way up, so a second drop appends rather than
 * replaces. That makes it carry between tests in this file, and an assertion
 * about "what this change hid" would otherwise be reading the previous one's
 * work too.
 */
async function clearHidden() {
  await prisma.subscription.updateMany({ where: { businessId }, data: { hiddenByPlan: [] } });
}

describe("criterion 6 — a downgrade is scheduled, not applied", () => {
  it("charges nothing and moves nothing on the day", async () => {
    await onPlan("pro");
    const invoicesBefore = await prisma.invoice.count({ where: { businessId } });

    const result = await changePlan(actor, businessId, "basic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scheduled).toBe(true);
    expect(result.invoiceId).toBeNull();

    // Still on the plan they paid for, and no invoice for a change that has not
    // happened.
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { planId: true },
    });
    expect(after.planId).toBe("pro");
    expect(await prisma.invoice.count({ where: { businessId } })).toBe(invoicesBefore);
  });

  it("lands on the renewal date, copied at schedule time", async () => {
    /*
       Copied rather than read at apply time: the renewal can move underneath a
       pending change — a term switch opens a new period today — and the date on
       the button was a promise.
    */
    await onPlan("pro");
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { renewsAt: true },
    });

    await changePlan(actor, businessId, "basic");
    const pending = await pendingChangeFor(businessId);
    expect(pending?.effectiveAt.toISOString()).toBe(subscription.renewsAt.toISOString());
  });

  it("is withdrawable, and withdrawing takes the choice with it", async () => {
    await onPlan("pro");
    await changePlan(actor, businessId, "basic");
    await saveKeep(actor, businessId, "products", ["a", "b"], 100);

    expect(await withdrawChange(actor, businessId)).toEqual({ ok: true });
    expect(await pendingChangeFor(businessId)).toBeNull();

    // And a second withdraw is a refusal rather than a silent success.
    expect(await withdrawChange(actor, businessId)).toEqual({ ok: false, error: "not_pending" });
  });
});

describe("Q8 — one pending change per subscription", () => {
  it("refuses a second while one is pending", async () => {
    await onPlan("pro");
    expect((await scheduleChange(actor, businessId, "basic", "monthly")).ok).toBe(true);

    const second = await scheduleChange(actor, businessId, "free", "monthly");
    expect(second).toEqual({ ok: false, error: "already_pending" });
  });

  it("allows a new one after the first is withdrawn", async () => {
    /*
       The index is partial — applied and withdrawn rows are history and must not
       collide. A plain unique on `business_id` would let a seller schedule one
       change ever.
    */
    await onPlan("pro");
    await scheduleChange(actor, businessId, "basic", "monthly");
    await withdrawChange(actor, businessId);

    const again = await scheduleChange(actor, businessId, "free", "monthly");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.change.toPlan.id).toBe("free");
  });

  it("refuses a change that goes nowhere", async () => {
    await onPlan("basic");
    expect(await scheduleChange(actor, businessId, "basic", "monthly")).toEqual({
      ok: false,
      error: "same_plan",
    });
  });
});

describe("criterion 8 — the seller chooses what stays live", () => {
  it("refuses a list longer than the plan holds", async () => {
    /*
       Accepting it would silently drop the tail at apply time and pick for the
       seller anyway, which is the choice they were just given.
    */
    await onPlan("pro");
    await scheduleChange(actor, businessId, "free", "monthly");

    const tooMany = await saveKeep(actor, businessId, "products", ["a", "b", "c"], 2);
    expect(tooMany).toEqual({ ok: false, error: "too_many" });
  });

  it("stores the choice against the change, de-duplicated", async () => {
    await onPlan("pro");
    await scheduleChange(actor, businessId, "basic", "monthly");

    const saved = await saveKeep(actor, businessId, "products", ["a", "a", "b"], 100);
    expect(saved).toEqual({ ok: true, kept: 2 });
    expect((await pendingChangeFor(businessId))?.keepProductIds).toEqual(["a", "b"]);
  });

  it("has nowhere to record a choice without a pending change", async () => {
    await onPlan("pro");
    expect(await saveKeep(actor, businessId, "products", ["a"], 100)).toEqual({
      ok: false,
      error: "not_pending",
    });
  });
});

describe("applying a due change", () => {
  it("does nothing before the date", async () => {
    await onPlan("pro");
    await scheduleChange(actor, businessId, "basic", "monthly");

    expect(await applyDueChanges(new Date("2000-01-01T00:00:00Z"))).toMatchObject({ applied: 0 });
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { planId: true },
    });
    expect(business.planId).toBe("pro");
  });

  it("moves the plan on the date, and only once", async () => {
    await onPlan("pro");
    await scheduleChange(actor, businessId, "basic", "monthly");
    const pending = await pendingChangeFor(businessId);
    const afterDate = new Date((pending?.effectiveAt.getTime() ?? 0) + 1000);

    expect(await applyDueChanges(afterDate)).toMatchObject({ applied: 1 });
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { planId: true },
    });
    expect(business.planId).toBe("basic");

    // Idempotent, so the job can run every day without reapplying yesterday's.
    expect(await applyDueChanges(afterDate)).toMatchObject({ applied: 0 });
    expect(await pendingChangeFor(businessId)).toBeNull();
  });

  it("unlists what the seller did not keep, and deletes nothing", async () => {
    await onPlan("pro");
    await clearHidden();
    await prisma.product.updateMany({ where: { businessId }, data: { status: "live" } });
    const live = await prisma.product.findMany({
      where: { businessId, status: "live" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const total = live.length;
    expect(total).toBeGreaterThan(1);

    await scheduleChange(actor, businessId, "basic", "monthly");
    const keep = live.slice(0, 1).map((product) => product.id);
    await saveKeep(actor, businessId, "products", keep, 100);

    const pending = await pendingChangeFor(businessId);
    await applyDueChanges(new Date((pending?.effectiveAt.getTime() ?? 0) + 1000));

    // Exactly what the seller picked stays live.
    const stillLive = await prisma.product.findMany({
      where: { businessId, status: "live" },
      select: { id: true },
    });
    expect(stillLive.map((product) => product.id)).toEqual(keep);

    // And nothing is gone. `hiddenByPlan` records what to put back on the way up.
    expect(await prisma.product.count({ where: { businessId } })).toBe(total);
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { businessId },
      select: { hiddenByPlan: true },
    });
    expect((subscription.hiddenByPlan as string[]).length).toBe(total - keep.length);
  });

  it("never unhides what the seller hid themselves", async () => {
    /*
       Criterion 11, and board 11f's fifth correction: `Branches published · All
       4` states the cap, not the state, and on board 3c one of those branches is
       `Hidden` by the seller's own choice. A keep list reads as "of the things
       that are live, these stay" — never as "these are live".
    */
    await onPlan("pro");
    /*
       A product the *seller* drafted, which means one the platform has no record
       of hiding. `hiddenByPlan` is the platform's memory of its own work, and
       `restoreHiddenByPlan` legitimately puts those back on the way up — so a
       draft that is in that list is not a counter-example to anything.
    */
    await clearHidden();
    const hidden = await prisma.product.findFirst({
      where: { businessId, status: "live" },
      select: { id: true },
    });
    if (!hidden) return;
    await prisma.product.update({ where: { id: hidden.id }, data: { status: "draft" } });

    await scheduleChange(actor, businessId, "basic", "monthly");
    await saveKeep(actor, businessId, "products", [hidden.id], 100);

    const pending = await pendingChangeFor(businessId);
    await applyDueChanges(new Date((pending?.effectiveAt.getTime() ?? 0) + 1000));

    const after = await prisma.product.findUniqueOrThrow({
      where: { id: hidden.id },
      select: { status: true },
    });
    expect(after.status).toBe("draft");
  });
});

describe("criterion 2 — an issued invoice is immutable", () => {
  const written: string[] = [];

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { in: written } } });
  });

  it("stores the totals and the billed party at issue", async () => {
    const now = new Date();
    const invoice = await issueInvoice({
      businessId,
      issuedAt: now,
      lines: [{ kind: "subscription", description: "Pro", fils: 29_900 }],
    });
    written.push(invoice.id);

    expect(invoice.subtotalFils).toBe(29_900);
    // Rounded once, per invoice — the convention the VAT return already used.
    expect(invoice.vatFils).toBe(1_495);
    expect(invoice.totalFils).toBe(31_395);

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { billedToName: true, ref: true },
    });
    expect(row.billedToName).not.toBeNull();
    // The reference a seller quotes at a bank.
    expect(row.ref).toMatch(/^BL-INV-\d+$/);
  });

  it("does not rewrite an invoice when the business is renamed", async () => {
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { displayName: true },
    });

    const invoice = await issueInvoice({
      businessId,
      issuedAt: new Date(),
      lines: [{ kind: "subscription", description: "Pro", fils: 29_900 }],
    });
    written.push(invoice.id);

    await prisma.business.update({
      where: { id: businessId },
      data: { displayName: `${before.displayName} Renamed` },
    });

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { billedToName: true },
    });
    // A tax invoice records a supply to a party as they were on the day.
    expect(row.billedToName).toBe(before.displayName);

    await prisma.business.update({
      where: { id: businessId },
      data: { displayName: before.displayName },
    });
  });

  it("refuses an invoice with no lines", async () => {
    // A reference number with nothing behind it is a document an accountant
    // asks about and nobody can explain.
    await expect(
      issueInvoice({ businessId, issuedAt: new Date(), lines: [] }),
    ).rejects.toThrow();
  });

  it("corrects with a credit note rather than an edit", async () => {
    const invoice = await issueInvoice({
      businessId,
      issuedAt: new Date(),
      paidAt: new Date(),
      lines: [{ kind: "subscription", description: "Pro", fils: 29_900 }],
    });
    written.push(invoice.id);

    const note = await creditNoteFor(invoice.id, "Charged in error", new Date());
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    written.push(note.invoice.id);

    // Negative throughout, and it cancels the original to the fil.
    expect(note.invoice.subtotalFils).toBe(-29_900);
    expect(note.invoice.totalFils).toBe(-31_395);
    expect(note.invoice.totalFils + invoice.totalFils).toBe(0);

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: note.invoice.id },
      select: { docType: true, correctsId: true },
    });
    expect(row.docType).toBe("credit_note");
    expect(row.correctsId).toBe(invoice.id);

    // One correction per invoice. A second is the same mistake twice.
    expect(await creditNoteFor(invoice.id, "Again", new Date())).toEqual({
      ok: false,
      error: "already_corrected",
    });
  });

  it("reads stored totals rather than recomputing them", async () => {
    const invoice = await issueInvoice({
      businessId,
      issuedAt: new Date(),
      lines: [{ kind: "subscription", description: "Pro", fils: 29_900 }],
    });
    written.push(invoice.id);

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: {
        subtotalFils: true,
        vatFils: true,
        totalFils: true,
        vatRate: true,
        lines: { select: { amountAed: true, qty: true } },
      },
    });

    const totals = storedTotals(row);
    expect(totals.stored).toBe(true);
    expect(totals.totalFils).toBe(31_395);

    /*
       And the fallback says so. An invoice issued before the columns existed is
       honestly a derived number, and the point of criterion 2 is that a reader
       can tell the difference rather than that the difference never arises.
    */
    const derived = storedTotals({ ...row, subtotalFils: null, vatFils: null, totalFils: null });
    expect(derived.stored).toBe(false);
    expect(derived.totalFils).toBe(31_395);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Board 11f — changing term, and the invoice it raises
// ─────────────────────────────────────────────────────────────────────────────

describe("changing term", () => {
  /**
   * `changeTerm` had no test at all, which is how it kept a hand-rolled invoice
   * through four boards.
   *
   * It was the last `tx.invoice.create` outside `issueInvoice`, and what that
   * cost was not cosmetic: a `TERM-…` reference nobody could quote at a bank,
   * `status: "issued"` on money the charge had already taken — which
   * `invoiceList` counts into `outstandingFils`, so board 3m told the seller
   * they owed it — no stored totals, no frozen billed party, and a null
   * `pdfPath` that made board 11g's download route 404.
   */
  async function toAnnual() {
    await onPlan("pro");
    await prisma.subscription.updateMany({
      where: { businessId },
      data: {
        term: "monthly",
        periodStartedAt: new Date(Date.now() - 10 * 86_400_000),
        renewsAt: new Date(Date.now() + 20 * 86_400_000),
      },
    });
    const result = await changeTerm(actor, businessId, "annual");
    if (result.ok && result.invoiceId) raisedInvoices.push(result.invoiceId);
    return result;
  }

  it("quotes the switch before it charges for it", async () => {
    await onPlan("pro");
    await prisma.subscription.updateMany({ where: { businessId }, data: { term: "monthly" } });
    const quoted = await quoteTermChange(actor, businessId, "annual");
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) throw new Error("unreachable");
    expect(quoted.quote.from).toBe("monthly");
    expect(quoted.quote.to).toBe("annual");
    // VAT on the net, the convention board 3m states for everything here.
    expect(quoted.quote.proration.vatFils).toBeGreaterThan(0);
  });

  it("raises the invoice through the one issuer, paid and referenced", async () => {
    const result = await toAnnual();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.invoiceId).not.toBeNull();
    expect(result.scheduled).toBe(false);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId! },
      select: {
        ref: true,
        status: true,
        paidAt: true,
        subtotalFils: true,
        vatFils: true,
        totalFils: true,
        billedToName: true,
        pspRef: true,
      },
    });

    // The reference a seller can quote at a bank, from the BL-INV sequence.
    expect(invoice.ref).toMatch(/^BL-INV-/);
    // Paid, because the charge succeeded before the transaction opened. An
    // `issued` row here is an invoice for money already taken.
    expect(invoice.status).toBe("paid");
    expect(invoice.paidAt).not.toBeNull();
    // Totals stored once, so two screens cannot compute two answers.
    expect(invoice.subtotalFils).not.toBeNull();
    expect(invoice.vatFils).not.toBeNull();
    expect(invoice.totalFils).toBe((invoice.subtotalFils ?? 0) + (invoice.vatFils ?? 0));
    // The billed party, frozen at issue — board 11g's rule.
    expect(invoice.billedToName).not.toBeNull();
    // And the provider's own reference, kept for a seller disputing a line.
    expect(invoice.pspRef).toMatch(/^TERM-/);
  });

  it("is not counted as money the platform is still owed", async () => {
    /*
       The consequence, and it was on the console rather than on the seller's
       page: `invoiceList` sums `status === "issued"` into `outstandingFils` for
       `/admin/invoices`, so every term change used to add its own already-paid
       amount to the figure finance reads as unpaid.
    */
    const result = await toAnnual();
    if (!result.ok) throw new Error("unreachable");
    const { invoiceList } = await import("@/lib/billing/invoice-list");
    const list = await invoiceList();
    const mine = list.rows.find((row) => row.id === result.invoiceId);
    expect(mine, "the term-change invoice is on the console list").toBeDefined();
    expect(mine!.status).not.toBe("issued");
  });

  it("stores the totals the screen reads, rather than recomputing them", async () => {
    const result = await toAnnual();
    if (!result.ok) throw new Error("unreachable");
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId! },
      select: {
        subtotalFils: true,
        vatFils: true,
        totalFils: true,
        vatRate: true,
        lines: { select: { amountAed: true, qty: true } },
      },
    });
    expect(storedTotals(invoice)).not.toBeNull();
  });

  it("records the contraction, because an annual price trades revenue for cash", async () => {
    const before = await prisma.mrrMovement.count({ where: { businessId } });
    const result = await toAnnual();
    if (!result.ok) throw new Error("unreachable");
    const after = await prisma.mrrMovement.count({ where: { businessId } });
    expect(after).toBe(before + 1);
    // Found by its note rather than by recency: other tests in this file write
    // movements at the same instant, and `occurredAt desc` picks between them
    // arbitrarily.
    const movement = await prisma.mrrMovement.findFirstOrThrow({
      where: { businessId, note: "Moved to annual" },
      select: { deltaFils: true, note: true },
    });
    // Two twelfths less recurring revenue, which is what an annual price is.
    expect(movement.deltaFils).toBeLessThan(0);
    await prisma.mrrMovement.deleteMany({ where: { businessId, note: "Moved to annual" } });
  });
});
