import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { PermissionError } from "@/lib/auth/errors";
import { bandOf, getInbox, LEAD_TABS, tabWhere } from "@/lib/leads/inbox";
import { assignLead, assignableSeats } from "@/lib/leads/assign";
import { clearOutcome, markOutcome } from "@/lib/leads/outcome";
import { findDraft, saveDraft } from "@/lib/quote/draft";
import { sendQuoteForBusiness } from "@/lib/quote/send-quote";

/**
 * Board 3j — the inbox, against a real database.
 *
 * Everything here is about a query, which is why none of it is a unit test: the
 * four tabs are four `where` clauses, and the bug they shipped with was a SQL
 * one that no amount of TypeScript would have caught. `NOT (column = $1)` over a
 * nullable column is NULL rather than true, so three of the four tabs matched
 * nothing while the fourth worked — and every count read zero over a rail with
 * twenty-one leads in it.
 *
 * ## Fixtures, and cleaning up after them
 *
 * Every row this file creates carries `PREFIX` in the requirement and is deleted
 * by that, never by reference. `tests/integration/attribution.test.ts` records
 * why: enquiries left behind by one suite counted toward another's free-plan cap
 * and turned a passing file red without changing a line of it. The integration
 * project runs with `fileParallelism: false` against one shared Postgres, so a
 * leak is somebody else's failure tomorrow.
 *
 * It deliberately uses the Pro seat. `seedAtMonthlyCap` throws if the free
 * seller gains a recipient row dated in the current month, and
 * `onlyOneSellerAtCap` deletes the oldest rows of any capped seller — either
 * would make these fixtures depend on the day of the month.
 */

const PREFIX = "3J-INBOX-FIXTURE";

let businessId: string;
let ownerId: string;
let buyerId: string;
let owner: Actor;
let escalationMinutes: number;

const created: string[] = [];

beforeAll(async () => {
  const business = await prisma.business.findFirstOrThrow({
    where: { slug: "al-marwan-industrial-supplies-llc" },
    select: { id: true, leadEscalationMinutes: true },
  });
  businessId = business.id;
  escalationMinutes = Math.max(5, business.leadEscalationMinutes);

  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId, roles: { has: "seller_owner" } },
    select: { id: true, roles: true },
  });
  ownerId = seat.id;
  owner = { id: seat.id, roles: seat.roles, businessId };

  const buyer = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "buyer" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  buyerId = buyer.id;
});

afterEach(async () => {
  const ids = created.splice(0);
  if (ids.length > 0) await prisma.enquiry.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.$disconnect();
});

interface LeadOptions {
  minutesAgo?: number;
  state?: "delivered" | "opened" | "quoted";
  replied?: boolean;
  outcome?: "won" | "lost";
  declined?: boolean;
  acceptedByUs?: boolean;
  assignedTo?: string;
  targetPerUnit?: string | null;
}

/** One lead, shaped by what the test is about. Returns the enquiry id. */
async function lead(label: string, options: LeadOptions = {}): Promise<string> {
  const minutesAgo = options.minutesAgo ?? 10;
  const at = new Date(Date.now() - minutesAgo * 60_000);

  const enquiry = await prisma.enquiry.create({
    data: {
      // Never `ENQ-<number>`: `advanceEnquiryRefSequence` reads that shape, and
      // a test reference in it would push the live counter every run.
      ref: `ENQ-${PREFIX}-${label}`,
      buyerId,
      requirement: `${PREFIX} ${label} — resilient seated gate valves for a riser.`,
      closesAt: new Date(Date.now() + 5 * 86_400_000),
      createdAt: at,
      ...(options.acceptedByUs
        ? { contactReleasedToBusinessId: businessId, contactReleasedAt: at }
        : {}),
      lines: {
        create: [
          {
            description: `${PREFIX} gate valve`,
            qty: 4,
            unit: "pcs",
            targetUnitPriceAed: options.targetPerUnit ?? null,
            sortOrder: 0,
          },
        ],
      },
    },
    select: { id: true },
  });
  created.push(enquiry.id);

  /*
     A quoted lead carries a quote.

     `sendQuoteForBusiness` sets `state = "quoted"` when it writes one, so a row
     in that state with nothing behind it is a row the application cannot
     produce — and since the tabs are defined by the quote rather than by the
     state column, a fixture without one lands in `Open`, correctly.
  */
  if ((options.state ?? "delivered") === "quoted") {
    await prisma.quote.create({
      data: {
        ref: `QT-${PREFIX}-${label}`,
        enquiryId: enquiry.id,
        businessId,
        revision: 1,
        status: "sent",
        sentAt: options.replied ? new Date(at.getTime() + 60_000) : at,
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
        lines: {
          create: [
            {
              description: `${PREFIX} gate valve`,
              qty: 4,
              unitPrice: "500.00",
              sortOrder: 0,
            },
          ],
        },
      },
    });
  }

  await prisma.enquiryRecipient.create({
    data: {
      enquiryId: enquiry.id,
      businessId,
      state: options.declined ? "declined" : (options.state ?? "delivered"),
      createdAt: at,
      firstReplyAt: options.replied ? new Date(at.getTime() + 60_000) : null,
      ...(options.outcome
        ? { outcome: options.outcome, outcomeAt: new Date(), outcomeById: ownerId }
        : {}),
      ...(options.assignedTo
        ? { assignedToId: options.assignedTo, assignedAt: at, assignedById: ownerId }
        : {}),
    },
  });

  return enquiry.id;
}

/** Where a given enquiry landed, or null if it is on no tab at all. */
async function tabOf(enquiryId: string): Promise<string | null> {
  for (const tab of LEAD_TABS) {
    const found = await prisma.enquiryRecipient.count({
      where: { ...tabWhere(businessId, tab, { kind: "all" }), enquiryId },
    });
    if (found > 0) return tab;
  }
  return null;
}

describe("the four tabs", () => {
  it("puts every lead on exactly one of them", async () => {
    /*
       The failure this is written against: three tabs matching nothing because
       the clause negated a nullable column. A lead on no tab is invisible, and
       a lead on two makes the counts sum to more than the queue.
    */
    const ids = await Promise.all([
      lead("OPEN"),
      lead("QUOTED", { state: "quoted", replied: true }),
      lead("WON", { state: "quoted", replied: true, outcome: "won" }),
      lead("LOST", { state: "quoted", replied: true, outcome: "lost" }),
      lead("DECLINED", { declined: true }),
      lead("ACCEPTED", { state: "quoted", replied: true, acceptedByUs: true }),
    ]);

    const placed = await Promise.all(ids.map(tabOf));
    expect(placed).toEqual(["open", "quoted", "won", "lost", "lost", "won"]);

    for (const id of ids) {
      const onTabs = await Promise.all(
        LEAD_TABS.map((tab) =>
          prisma.enquiryRecipient.count({
            where: { ...tabWhere(businessId, tab, { kind: "all" }), enquiryId: id },
          }),
        ),
      );
      expect(onTabs.filter((n) => n > 0), id).toHaveLength(1);
    }
  });

  it("counts the whole queue, so the four sum to the population", async () => {
    await Promise.all([
      lead("SUM-A"),
      lead("SUM-B", { state: "quoted", replied: true }),
      lead("SUM-C", { state: "quoted", replied: true, outcome: "won" }),
    ]);

    const counts = await Promise.all(
      LEAD_TABS.map((tab) =>
        prisma.enquiryRecipient.count({ where: tabWhere(businessId, tab, { kind: "all" }) }),
      ),
    );
    const total = await prisma.enquiryRecipient.count({ where: { businessId } });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("lets the seller's own word beat what the platform observed", async () => {
    /*
       The buyer accepted this supplier, and the supplier says they lost it —
       a real case: the buyer accepted and then went elsewhere off the record.
       The seller's column wins, because it is the one a person set.

       `markOutcome` refuses to *write* that combination; a row already carrying
       it must still land somewhere, and the tab has to be the one the seller
       chose rather than the one the enquiry implies.
    */
    const id = await lead("OVERRIDE", {
      state: "quoted",
      replied: true,
      acceptedByUs: true,
      outcome: "lost",
    });
    expect(await tabOf(id)).toBe("lost");
  });
});

describe("the waiting bands", () => {
  it("reads late from the supplier's own escalation setting, not a second number", () => {
    /*
       lib/enquiry/escalation-job.ts emails the owner on exactly this predicate
       every hour. A rail with its own threshold would paint a row red beside an
       email saying the lead is fine.
    */
    const now = new Date();
    const at = (minutes: number) => ({
      firstReplyAt: null,
      createdAt: new Date(now.getTime() - minutes * 60_000),
    });

    expect(bandOf(at(escalationMinutes + 1), escalationMinutes, now)).toBe("breached");
    expect(bandOf(at(escalationMinutes), escalationMinutes, now)).toBe("breached");
    expect(bandOf(at(escalationMinutes * 0.75), escalationMinutes, now)).toBe("approaching");
    expect(bandOf(at(escalationMinutes * 0.25), escalationMinutes, now)).toBe("waiting");
  });

  it("never calls an answered lead late, however old it is", () => {
    const now = new Date();
    expect(
      bandOf(
        { firstReplyAt: new Date(now.getTime() - 60_000), createdAt: new Date(0) },
        escalationMinutes,
        now,
      ),
    ).toBe("answered");
  });

  it("honours the five-minute floor the sweep applies", () => {
    // A threshold nobody meant to set. The job clamps it; so does the rail, or
    // the two disagree about a supplier who typed 1.
    const now = new Date();
    const twoMinutes = { firstReplyAt: null, createdAt: new Date(now.getTime() - 2 * 60_000) };
    expect(bandOf(twoMinutes, 1, now)).not.toBe("breached");
  });
});

describe("the rail", () => {
  it("puts unanswered leads above answered ones, oldest first", async () => {
    await Promise.all([
      lead("ORDER-NEW", { minutesAgo: 5 }),
      lead("ORDER-OLD", { minutesAgo: escalationMinutes * 4 }),
      lead("ORDER-DONE", { minutesAgo: escalationMinutes * 8, state: "opened", replied: true }),
    ]);

    const page = await getInbox({ businessId, tab: "open", scope: { kind: "all" } });
    const mine = page.rows.filter((row) => row.requirement.includes(PREFIX));
    expect(mine.map((row) => row.ref)).toEqual([
      `ENQ-${PREFIX}-ORDER-OLD`,
      `ENQ-${PREFIX}-ORDER-NEW`,
      `ENQ-${PREFIX}-ORDER-DONE`,
    ]);
  });

  it("reads the buyer's budget from their own targets, and shows none where there is none", async () => {
    await lead("BUDGET", { targetPerUnit: "250.00" });
    await lead("NOBUDGET");

    const page = await getInbox({ businessId, tab: "open", scope: { kind: "all" } });
    const priced = page.rows.find((row) => row.ref === `ENQ-${PREFIX}-BUDGET`);
    const blank = page.rows.find((row) => row.ref === `ENQ-${PREFIX}-NOBUDGET`);

    // Four at 250. The buyer's figure, not an estimate of the deal.
    expect(priced?.buyerBudgetAed).toBe("1000.00");
    // A guess would be worse than a blank, and a zero would read as free.
    expect(blank?.buyerBudgetAed).toBeNull();
  });

  it("never carries a buyer's surname, company or number before acceptance", async () => {
    await lead("MASKED");
    const page = await getInbox({ businessId, tab: "open", scope: { kind: "all" } });
    const row = page.rows.find((r) => r.ref === `ENQ-${PREFIX}-MASKED`);

    expect(row?.buyer.released).toBe(false);
    // Rule 1 is enforced by not selecting the columns; this is the shape that
    // proves the payload has nowhere to leak them from.
    expect(Object.keys(row?.buyer ?? {})).toEqual(["released", "firstName"]);
  });
});

describe("the scope filter", () => {
  it("narrows every count, not just the list", async () => {
    await lead("SCOPE-MINE", { assignedTo: ownerId });
    await lead("SCOPE-THEIRS");

    const all = await getInbox({ businessId, tab: "open", scope: { kind: "all" } });
    const mine = await getInbox({
      businessId,
      tab: "open",
      scope: { kind: "mine", userId: ownerId },
    });

    expect(mine.counts.open).toBeLessThan(all.counts.open);
    expect(mine.rows.every((row) => row.assignedTo?.id === ownerId)).toBe(true);
  });

  it("finds the leads nobody has picked up", async () => {
    await lead("SCOPE-FREE");
    const page = await getInbox({ businessId, tab: "open", scope: { kind: "unassigned" } });
    expect(page.rows.every((row) => row.assignedTo === null)).toBe(true);
    expect(page.rows.some((row) => row.ref === `ENQ-${PREFIX}-SCOPE-FREE`)).toBe(true);
  });
});

describe("assignment", () => {
  it("refuses a seat that is not on this business", async () => {
    const id = await lead("ASSIGN-STRANGER");
    const stranger = await prisma.user.findFirstOrThrow({
      where: { businessId: null },
      select: { id: true },
    });
    expect(
      await assignLead(owner, businessId, { enquiryId: id, assignedToId: stranger.id }),
    ).toEqual({ ok: false, error: "not_your_seat" });
  });

  it("refuses a seat that cannot reply to enquiries", async () => {
    // Board 7d gives a finance seat no reply capability, so routing work to one
    // would put a lead in front of somebody who cannot open it.
    const seats = await assignableSeats(owner, businessId);
    const finance = await prisma.user.findFirst({
      where: { businessId, roles: { has: "seller_finance" } },
      select: { id: true },
    });
    if (finance) expect(seats.map((s) => s.id)).not.toContain(finance.id);
  });

  it("is not a sales seat's to make", async () => {
    const id = await lead("ASSIGN-SALES");
    const sales: Actor = { id: ownerId, roles: ["seller_sales"], businessId };
    await expect(
      assignLead(sales, businessId, { enquiryId: id, assignedToId: ownerId }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("clears cleanly", async () => {
    const id = await lead("ASSIGN-CLEAR", { assignedTo: ownerId });
    expect(await assignLead(owner, businessId, { enquiryId: id, assignedToId: null })).toEqual({
      ok: true,
      assignedToId: null,
    });
    const row = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: id, businessId } },
      select: { assignedToId: true, assignedAt: true, assignedById: true },
    });
    expect(row).toEqual({ assignedToId: null, assignedAt: null, assignedById: null });
  });
});

describe("marking an outcome", () => {
  it("records no amount, because quoted value is measured rather than typed", async () => {
    const id = await lead("OUTCOME-WON", { state: "quoted", replied: true });
    expect(await markOutcome(owner, businessId, { enquiryId: id, outcome: "won" })).toEqual({
      ok: true,
      outcome: "won",
    });

    /*
       CLAUDE.md lists quoted value among the derived metrics with no writable
       path. This asserts the column is not there rather than that it is unused:
       a nullable amount nobody writes today is a nullable amount somebody
       writes next quarter.
    */
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'enquiry_recipient'`;
    const names = columns.map((c) => c.column_name);
    expect(names.some((n) => /value|amount|aed/.test(n))).toBe(false);
  });

  it("refuses to contradict a buyer who accepted", async () => {
    const id = await lead("OUTCOME-ACCEPTED", {
      state: "quoted",
      replied: true,
      acceptedByUs: true,
    });
    expect(
      await markOutcome(owner, businessId, { enquiryId: id, outcome: "lost" }),
    ).toEqual({ ok: false, error: "buyer_decided" });
  });

  it("refuses before there is a quote to win or lose", async () => {
    const id = await lead("OUTCOME-EARLY");
    expect(await markOutcome(owner, businessId, { enquiryId: id, outcome: "won" })).toEqual({
      ok: false,
      error: "not_quoted",
    });
  });

  it("is not a colleague's lead to close", async () => {
    // Question 5: the assignee and any manager, not every seat.
    const other = await prisma.user.findFirst({
      where: { businessId, id: { not: ownerId } },
      select: { id: true },
    });
    if (!other) return;

    const id = await lead("OUTCOME-THEIRS", {
      state: "quoted",
      replied: true,
      assignedTo: other.id,
    });
    const sales: Actor = { id: ownerId, roles: ["seller_sales"], businessId };
    expect(await markOutcome(sales, businessId, { enquiryId: id, outcome: "won" })).toEqual({
      ok: false,
      error: "not_yours_to_mark",
    });
  });

  it("keeps a reason on a loss and not on a win", async () => {
    const lost = await lead("OUTCOME-REASON", { state: "quoted", replied: true });
    await markOutcome(owner, businessId, {
      enquiryId: lost,
      outcome: "lost",
      reason: "Lead time.",
    });

    const won = await lead("OUTCOME-NOREASON", { state: "quoted", replied: true });
    await markOutcome(owner, businessId, {
      enquiryId: won,
      outcome: "won",
      reason: "Should not be kept.",
    });

    const rows = await prisma.enquiryRecipient.findMany({
      where: { businessId, enquiryId: { in: [lost, won] } },
      select: { enquiryId: true, outcomeReason: true },
    });
    expect(rows.find((r) => r.enquiryId === lost)?.outcomeReason).toBe("Lead time.");
    // A reason against a win reads as an explanation nobody asked for.
    expect(rows.find((r) => r.enquiryId === won)?.outcomeReason).toBeNull();
  });

  it("puts the lead back in the working list when cleared", async () => {
    const id = await lead("OUTCOME-REOPEN", { state: "quoted", replied: true });
    await markOutcome(owner, businessId, { enquiryId: id, outcome: "lost" });
    expect(await tabOf(id)).toBe("lost");

    await clearOutcome(owner, businessId, { enquiryId: id });
    expect(await tabOf(id)).toBe("quoted");
  });
});

describe("the autosaved draft", () => {
  it("keeps only the lines that carry a price", async () => {
    /*
       `QuoteLine.unitPrice` is NOT NULL, so an unpriced line has nothing to
       store — and zero would be worse than nothing, because a zero line is a
       real thing a seller sends for a sample or absorbed freight. A draft that
       came back reading 0.00 in every untouched box is "never silently blank"
       inverted: the seller would send prices they never typed.
    */
    const id = await lead("DRAFT-PARTIAL", { state: "opened" });
    const line = await prisma.enquiryLine.findFirstOrThrow({
      where: { enquiryId: id },
      select: { id: true, description: true },
    });

    const saved = await saveDraft(owner, businessId, {
      enquiryId: id,
      note: "Half done.",
      validityDays: 14,
      lines: [
        {
          enquiryLineId: line.id,
          productId: null,
          description: line.description,
          qty: 4,
          unitPrice: "410.00",
          leadTimeDays: null,
        },
        {
          enquiryLineId: line.id,
          productId: null,
          description: "Not reached yet",
          qty: 2,
          unitPrice: "   ",
          leadTimeDays: null,
        },
      ],
    });
    expect(saved.ok).toBe(true);

    const draft = await findDraft(id, businessId);
    expect(draft?.lines).toHaveLength(1);
    expect(draft?.lines[0]?.unitPrice.toString()).toBe("410");
    // Restored in place, not in order — two lines of the same wording in
    // different sizes is the case description-matching got wrong.
    expect(draft?.lines[0]?.enquiryLineId).toBe(line.id);
  });

  it("does not stamp a first reply, because a draft is not one", async () => {
    const id = await lead("DRAFT-NOREPLY");
    const line = await prisma.enquiryLine.findFirstOrThrow({ where: { enquiryId: id } });

    await saveDraft(owner, businessId, {
      enquiryId: id,
      note: "",
      validityDays: 14,
      lines: [
        {
          enquiryLineId: line.id,
          productId: null,
          description: line.description,
          qty: 4,
          unitPrice: "100.00",
          leadTimeDays: null,
        },
      ],
    });

    const row = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId: id, businessId } },
      select: { firstReplyAt: true, state: true },
    });
    // §2: "a reply counts as a response; a saved draft does not."
    expect(row.firstReplyAt).toBeNull();
    expect(row.state).toBe("delivered");
  });

  it("is promoted rather than duplicated when the quote is sent", async () => {
    const id = await lead("DRAFT-PROMOTE");
    const line = await prisma.enquiryLine.findFirstOrThrow({ where: { enquiryId: id } });
    const draftLine = {
      enquiryLineId: line.id,
      productId: null,
      description: line.description,
      qty: 4,
      unitPrice: "410.00",
      leadTimeDays: null,
    };

    await saveDraft(owner, businessId, {
      enquiryId: id,
      note: "Draft.",
      validityDays: 14,
      lines: [draftLine],
    });
    const draft = await findDraft(id, businessId);

    const sent = await sendQuoteForBusiness(owner, businessId, {
      enquiryId: id,
      note: "Sent.",
      validityDays: 14,
      lines: [draftLine],
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error("unreachable");

    // The same row, finished. A second row at the same revision cannot exist —
    // `Quote` is unique on (enquiryId, businessId, revision) — and one at a
    // made-up revision would leave a hole in the sequence the buyer reads.
    expect(sent.quoteId).toBe(draft?.id);
    expect(await prisma.quote.count({ where: { enquiryId: id, businessId } })).toBe(1);
    expect(await findDraft(id, businessId)).toBeNull();
    expect(sent.quoteRef.startsWith("QT-")).toBe(true);
  });

  it("refuses to autosave over a lead that has an outcome", async () => {
    const id = await lead("DRAFT-DECIDED", { state: "quoted", replied: true, outcome: "won" });
    const line = await prisma.enquiryLine.findFirstOrThrow({ where: { enquiryId: id } });
    expect(
      await saveDraft(owner, businessId, {
        enquiryId: id,
        note: "",
        validityDays: 14,
        lines: [
          {
            enquiryLineId: line.id,
            productId: null,
            description: line.description,
            qty: 4,
            unitPrice: "1.00",
            leadTimeDays: null,
          },
        ],
      }),
    ).toEqual({ ok: false, error: "decided" });
  });
});

describe("what a quote records about the enquiry it answered", () => {
  it("names the revision it was priced against", async () => {
    /*
       `againstRevision` defaulted to 1 and had no writer, so every quote in the
       database claimed to be priced against R1 whatever the buyer had since
       changed — and the buyer's tracking page renders it.
    */
    const id = await lead("AGAINST-REVISION");
    await prisma.enquiry.update({ where: { id }, data: { revision: 3, revisedAt: new Date() } });
    const line = await prisma.enquiryLine.findFirstOrThrow({ where: { enquiryId: id } });

    const sent = await sendQuoteForBusiness(owner, businessId, {
      enquiryId: id,
      note: "",
      validityDays: 14,
      lines: [
        {
          enquiryLineId: line.id,
          productId: null,
          description: line.description,
          qty: 4,
          unitPrice: "500.00",
          leadTimeDays: null,
        },
      ],
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error("unreachable");

    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: sent.quoteId },
      select: { againstRevision: true },
    });
    expect(quote.againstRevision).toBe(3);
  });
});
