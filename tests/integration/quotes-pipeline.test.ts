import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { PermissionError } from "@/lib/auth/errors";
import { tabWhere } from "@/lib/leads/inbox";
import {
  contractHolds,
  expiringSoon,
  findByRef,
  getPipeline,
  PIPELINE_TABS,
} from "@/lib/quotes/pipeline";
import { ceilingFor, extendQuote, MAX_DAYS_FROM_SEND, presetDate } from "@/lib/quotes/extend";
import { exportPipeline } from "@/lib/quotes/export";
import { replySpeed } from "@/lib/quotes/speed";

/**
 * Board 3k — the pipeline, its contract, and the action it exists for.
 *
 * Fixtures carry `PREFIX` in the requirement and are deleted by it, never by
 * reference: the integration project runs `fileParallelism: false` against one
 * shared Postgres, and a leak is somebody else's red test tomorrow. The Pro seat
 * is used for the same reason board 3j's suite uses it — `seedAtMonthlyCap`
 * throws if the free seller gains a current-month recipient row.
 */

const PREFIX = "3K-PIPELINE-FIXTURE";

let businessId: string;
let ownerId: string;
let buyerId: string;
let owner: Actor;

const created: string[] = [];

beforeAll(async () => {
  const business = await prisma.business.findFirstOrThrow({
    where: { slug: "al-marwan-industrial-supplies-llc" },
    select: { id: true },
  });
  businessId = business.id;

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

interface QuoteOptions {
  /** Days from now the window closes. Negative is a window already shut. */
  validForDays?: number;
  outcome?: "won" | "lost";
  declined?: boolean;
  acceptedByUs?: boolean;
  sentHoursAgo?: number;
  repliedHoursAfter?: number;
  extended?: number;
  enquiryClosed?: boolean;
  revisions?: number;
}

/** One quoted lead, shaped by what the test is about. Returns the quote ref. */
async function quoted(label: string, options: QuoteOptions = {}): Promise<string> {
  const sentHoursAgo = options.sentHoursAgo ?? 24;
  const at = new Date(Date.now() - sentHoursAgo * 3_600_000);
  const replied = new Date(at.getTime() + (options.repliedHoursAfter ?? 1) * 3_600_000);

  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}`,
      buyerId,
      requirement: `${PREFIX} ${label} — resilient seated gate valves for a riser.`,
      closesAt: new Date(
        Date.now() + (options.enquiryClosed ? -2 : 20) * 86_400_000,
      ),
      createdAt: at,
      ...(options.acceptedByUs
        ? { contactReleasedToBusinessId: businessId, contactReleasedAt: replied }
        : {}),
      lines: {
        create: [{ description: `${PREFIX} valve`, qty: 4, unit: "pcs", sortOrder: 0 }],
      },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  created.push(enquiry.id);

  await prisma.enquiryRecipient.create({
    data: {
      enquiryId: enquiry.id,
      businessId,
      state: options.declined ? "declined" : "quoted",
      createdAt: at,
      firstReplyAt: replied,
      ...(options.outcome
        ? { outcome: options.outcome, outcomeAt: new Date(), outcomeById: ownerId }
        : {}),
    },
  });

  const revisions = options.revisions ?? 1;
  let ref = "";
  for (let revision = 1; revision <= revisions; revision += 1) {
    ref = `QT-${PREFIX}-${label}-R${revision}`;
    await prisma.quote.create({
      data: {
        ref,
        enquiryId: enquiry.id,
        businessId,
        revision,
        validityDays: 14,
        status: "sent",
        sentAt: replied,
        expiresAt: new Date(Date.now() + (options.validForDays ?? 14) * 86_400_000),
        createdAt: replied,
        ...(options.extended
          ? {
              extensionCount: options.extended,
              lastExtendedAt: new Date(),
              extendedById: ownerId,
            }
          : {}),
        lines: {
          create: [
            {
              enquiryLineId: enquiry.lines[0]!.id,
              description: `${PREFIX} valve`,
              qty: 4,
              unitPrice: "500.00",
              sortOrder: 0,
            },
          ],
        },
      },
    });
  }
  return ref;
}

async function tabOf(ref: string): Promise<string[]> {
  const found: string[] = [];
  for (const tab of PIPELINE_TABS) {
    const page = await getPipeline({ businessId, tab, scope: { kind: "all" } });
    if (page.rows.some((row) => row.ref === ref)) found.push(tab);
  }
  return found;
}

describe("the count contract", () => {
  it("puts every quoted lead in exactly one of the four that sum", async () => {
    await Promise.all([
      quoted("AWAIT"),
      quoted("EXPIRED", { validForDays: -3 }),
      quoted("WON", { outcome: "won" }),
      quoted("LOST", { outcome: "lost" }),
      quoted("DECLINED", { declined: true }),
      quoted("ACCEPTED", { acceptedByUs: true }),
    ]);

    const page = await getPipeline({ businessId, tab: "all", scope: { kind: "all" } });
    // §3: Awaiting + Won + Lost + Expired = All. Expiring is a filter over
    // Awaiting and is excluded from the sum.
    expect(contractHolds(page.counts)).toBe(true);
  });

  it("counts expiring soon as a subset of awaiting, never an addition", async () => {
    await quoted("SOON", { validForDays: 3 });
    await quoted("LATER", { validForDays: 30 });

    const page = await getPipeline({ businessId, tab: "all", scope: { kind: "all" } });
    expect(page.counts.expiring).toBeLessThanOrEqual(page.counts.awaiting);
    expect(contractHolds(page.counts)).toBe(true);

    expect(await tabOf(`QT-${PREFIX}-SOON-R1`)).toEqual(["all", "awaiting", "expiring"]);
    expect(await tabOf(`QT-${PREFIX}-LATER-R1`)).toEqual(["all", "awaiting"]);
  });

  it("shows a revision as one row, not two", async () => {
    /*
       §3: "a revision is a version of one quote, not a second row." In this
       schema a revision IS a second `Quote` row — `sendQuoteForBusiness` never
       edits a sent one — so the pipeline groups by lead and renders the latest.
    */
    await quoted("REVISED", { revisions: 3 });

    const page = await getPipeline({ businessId, tab: "all", scope: { kind: "all" } });
    const mine = page.rows.filter((row) => row.ref.includes(`${PREFIX}-REVISED`));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.ref).toBe(`QT-${PREFIX}-REVISED-R3`);
    expect(mine[0]?.revision).toBe(3);
  });

  it("reconciles with board 3j's Quoted tab, which is what the amendment asks", async () => {
    /*
       The 3j amendment: its `Quoted` tab counts leads with a quote and **no
       outcome marked**, and that population is this screen's Awaiting plus
       Expired — the same leads, split by whether their window has run out.

       3j shipped with that predicate already, so this is the assertion that it
       stays true rather than a change. If the two ever diverge, one screen is
       counting a lead the other is not, which is the double-count the amendment
       exists to end.
    */
    await Promise.all([
      quoted("RECON-A"),
      quoted("RECON-B", { validForDays: -1 }),
      quoted("RECON-C", { outcome: "won" }),
    ]);

    const pipeline = await getPipeline({ businessId, tab: "all", scope: { kind: "all" } });
    const inboxQuoted = await prisma.enquiryRecipient.count({
      where: tabWhere(businessId, "quoted", { kind: "all" }),
    });

    expect(inboxQuoted).toBe(pipeline.counts.awaiting + pipeline.counts.expired);
  });

  it("keeps a draft out of the pipeline entirely", async () => {
    const ref = await quoted("DRAFTED");
    const quote = await prisma.quote.findFirstOrThrow({ where: { ref } });
    await prisma.quote.update({ where: { id: quote.id }, data: { status: "draft" } });

    // A draft is the seller's own workings; the buyer has never seen it.
    expect(await tabOf(ref)).toEqual([]);
  });
});

describe("the strip and the footer state real numbers", () => {
  it("totals the whole tab, not the page on screen", async () => {
    await Promise.all([quoted("SUM-A"), quoted("SUM-B")]);
    const page = await getPipeline({ businessId, tab: "all", scope: { kind: "all" } });

    const everyRow = await prisma.quote.findMany({
      where: { businessId, status: { not: "draft" } },
      select: { id: true },
    });
    expect(everyRow.length).toBeGreaterThan(0);
    // Two thousand from this file's two fixtures, plus whatever the seed holds.
    expect(Number(page.quotedTotalAed)).toBeGreaterThanOrEqual(4000);
  });
});

describe("extending a window", () => {
  it("moves the date, counts the move and names who made it", async () => {
    const ref = await quoted("EXTEND-OK", { validForDays: 4 });
    const quote = await prisma.quote.findFirstOrThrow({ where: { ref } });
    const until = presetDate(quote.expiresAt!, 7);

    const result = await extendQuote(owner, businessId, { quoteId: quote.id, until });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.extensionCount).toBe(1);

    const after = await prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
      select: { expiresAt: true, extensionCount: true, extendedById: true, lastExtendedAt: true },
    });
    expect(after.expiresAt?.getTime()).toBe(until.getTime());
    expect(after.extendedById).toBe(ownerId);
    expect(after.lastExtendedAt).not.toBeNull();
  });

  it("changes nothing else about the quote", async () => {
    // §5: "not a price, not a line, not a version."
    const ref = await quoted("EXTEND-ONLY", { validForDays: 4 });
    const before = await prisma.quote.findFirstOrThrow({
      where: { ref },
      include: { lines: true },
    });

    await extendQuote(owner, businessId, {
      quoteId: before.id,
      until: presetDate(before.expiresAt!, 7),
    });

    const after = await prisma.quote.findUniqueOrThrow({
      where: { id: before.id },
      include: { lines: true },
    });
    expect(after.revision).toBe(before.revision);
    expect(after.ref).toBe(before.ref);
    expect(after.lines.map((l) => l.unitPrice.toString())).toEqual(
      before.lines.map((l) => l.unitPrice.toString()),
    );
    expect(await prisma.quote.count({ where: { enquiryId: before.enquiryId } })).toBe(1);
  });

  it("sends the buyer nothing", async () => {
    /*
       §5: "Extending is silent." A message would make it a notification, which
       is the one thing the card promises it is not — and a seller who assumed
       it messaged would not send the follow-up that would have.
    */
    const ref = await quoted("EXTEND-QUIET", { validForDays: 4 });
    const quote = await prisma.quote.findFirstOrThrow({ where: { ref } });
    const before = await prisma.message.count({ where: { enquiryId: quote.enquiryId } });

    await extendQuote(owner, businessId, {
      quoteId: quote.id,
      until: presetDate(quote.expiresAt!, 7),
    });

    expect(await prisma.message.count({ where: { enquiryId: quote.enquiryId } })).toBe(before);
    expect(
      await prisma.notificationDelivery.count({ where: { enquiryId: quote.enquiryId } }),
    ).toBe(0);
  });

  it("refuses an expired window, because that is the point of the action", async () => {
    const ref = await quoted("EXTEND-DEAD", { validForDays: -2 });
    const quote = await prisma.quote.findFirstOrThrow({ where: { ref } });
    expect(
      await extendQuote(owner, businessId, {
        quoteId: quote.id,
        until: new Date(Date.now() + 7 * 86_400_000),
      }),
    ).toEqual({ ok: false, error: "expired" });
  });

  it("refuses a date more than sixty days from when it was sent", async () => {
    const ref = await quoted("EXTEND-FAR", { validForDays: 4 });
    const quote = await prisma.quote.findFirstOrThrow({ where: { ref } });
    const past = new Date(ceilingFor(quote.sentAt).getTime() + 86_400_000);

    expect(await extendQuote(owner, businessId, { quoteId: quote.id, until: past })).toEqual({
      ok: false,
      error: "too_far",
    });
    // And accepts one exactly on the ceiling, so the boundary is not off by one.
    expect(
      (await extendQuote(owner, businessId, { quoteId: quote.id, until: ceilingFor(quote.sentAt) }))
        .ok,
    ).toBe(true);
    expect(MAX_DAYS_FROM_SEND).toBe(60);
  });

  it("refuses to shorten a window the buyer already holds", async () => {
    const ref = await quoted("EXTEND-BACK", { validForDays: 10 });
    const quote = await prisma.quote.findFirstOrThrow({ where: { ref } });
    expect(
      await extendQuote(owner, businessId, {
        quoteId: quote.id,
        until: new Date(quote.expiresAt!.getTime() - 86_400_000),
      }),
    ).toEqual({ ok: false, error: "backwards" });
  });

  it("refuses once an outcome is marked", async () => {
    const ref = await quoted("EXTEND-DONE", { validForDays: 5, outcome: "won" });
    const quote = await prisma.quote.findFirstOrThrow({ where: { ref } });
    expect(
      await extendQuote(owner, businessId, {
        quoteId: quote.id,
        until: presetDate(quote.expiresAt!, 7),
      }),
    ).toEqual({ ok: false, error: "decided" });
  });

  it("is not a colleague's quote to move", async () => {
    const ref = await quoted("EXTEND-THEIRS", { validForDays: 5 });
    const quote = await prisma.quote.findFirstOrThrow({ where: { ref } });
    const sales: Actor = { id: ownerId, roles: ["seller_sales"], businessId };

    // Unassigned and not a manager: the same rule board 3j applies to outcomes.
    expect(
      await extendQuote(sales, businessId, {
        quoteId: quote.id,
        until: presetDate(quote.expiresAt!, 7),
      }),
    ).toEqual({ ok: false, error: "not_yours_to_extend" });
  });

  it("is refused outright to a seat that cannot send quotes", async () => {
    const ref = await quoted("EXTEND-FINANCE", { validForDays: 5 });
    const quote = await prisma.quote.findFirstOrThrow({ where: { ref } });
    const finance: Actor = { id: ownerId, roles: ["seller_finance"], businessId };
    await expect(
      extendQuote(finance, businessId, {
        quoteId: quote.id,
        until: presetDate(quote.expiresAt!, 7),
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("gives an unknown quote and somebody else's the same answer", async () => {
    const other = await prisma.quote.findFirstOrThrow({
      where: { businessId: { not: businessId } },
      select: { id: true },
    });
    expect(
      await extendQuote(owner, businessId, {
        quoteId: other.id,
        until: new Date(Date.now() + 7 * 86_400_000),
      }),
    ).toEqual({ ok: false, error: "not_your_quote" });
  });
});

describe("the expiring card", () => {
  it("lists only what closes inside seven days, soonest first", async () => {
    await Promise.all([
      quoted("SOON-3", { validForDays: 3 }),
      quoted("SOON-1", { validForDays: 1 }),
      quoted("SOON-30", { validForDays: 30 }),
    ]);

    const rows = await expiringSoon({ businessId, scope: { kind: "all" }, take: 20 });
    const mine = rows.filter((row) => row.ref.includes(PREFIX));
    expect(mine.map((row) => row.ref)).toEqual([
      `QT-${PREFIX}-SOON-1-R1`,
      `QT-${PREFIX}-SOON-3-R1`,
    ]);
  });
});

describe("the speed card", () => {
  it("reads counts rather than rates, and leaves an empty band empty", async () => {
    await Promise.all([
      quoted("FAST-WON", { repliedHoursAfter: 1, outcome: "won" }),
      quoted("FAST-LOST", { repliedHoursAfter: 1, outcome: "lost" }),
      quoted("SLOW-LOST", { repliedHoursAfter: 30, outcome: "lost" }),
    ]);

    const card = await replySpeed({ businessId, scope: { kind: "all" } });
    expect(card.fast.resolved).toBeGreaterThanOrEqual(2);
    expect(card.fast.won).toBeGreaterThanOrEqual(1);
    expect(card.slow.resolved).toBeGreaterThanOrEqual(1);
    // Counts, never a percentage. §8.1: 23 resolved quotes split into two
    // buckets cannot carry one, so the shape has no rate in it at all.
    expect(Object.keys(card.fast)).toEqual(["resolved", "won"]);
  });

  it("leaves an undecided quote out of both buckets", async () => {
    const before = await replySpeed({ businessId, scope: { kind: "all" } });
    await quoted("UNDECIDED", { repliedHoursAfter: 1, validForDays: 30 });
    const after = await replySpeed({ businessId, scope: { kind: "all" } });

    // Nothing to attribute to speed yet, and counting it would flatter whichever
    // bucket happens to hold the newest work.
    expect(after.fast.resolved).toBe(before.fast.resolved);
  });
});

describe("the export", () => {
  it("carries the seller-marked caveat before any column head", async () => {
    await quoted("CSV-ONE");
    const file = await exportPipeline({ businessId, tab: "all", scope: { kind: "all" } });

    const lines = file.csv.split("\r\n");
    expect(lines[0]).toContain("takes no payment and never sees the order");
    expect(lines[1]).toContain("Ref");
    expect(file.filename.endsWith(".csv")).toBe(true);
  });

  it("neutralises a formula a buyer could have typed into a requirement", async () => {
    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `ENQ-${PREFIX}-CSV-FORMULA`,
        buyerId,
        requirement: `=HYPERLINK("http://example.test") ${PREFIX} formula probe.`,
        closesAt: new Date(Date.now() + 10 * 86_400_000),
        lines: { create: [{ description: `${PREFIX} valve`, qty: 1, sortOrder: 0 }] },
      },
      select: { id: true },
    });
    created.push(enquiry.id);
    await prisma.enquiryRecipient.create({
      data: { enquiryId: enquiry.id, businessId, state: "quoted", firstReplyAt: new Date() },
    });
    await prisma.quote.create({
      data: {
        ref: `QT-${PREFIX}-CSV-FORMULA-R1`,
        enquiryId: enquiry.id,
        businessId,
        revision: 1,
        status: "sent",
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 86_400_000),
        lines: { create: [{ description: "probe", qty: 1, unitPrice: "1.00", sortOrder: 0 }] },
      },
    });

    const file = await exportPipeline({ businessId, tab: "all", scope: { kind: "all" } });
    // Quoted and prefixed, so a spreadsheet reads it as text rather than
    // evaluating something a stranger wrote.
    expect(file.csv).toContain(`"'=HYPERLINK`);
  });

  it("exports every row of a tab, not the first page", async () => {
    const file = await exportPipeline({ businessId, tab: "all", scope: { kind: "all" } });
    const page = await getPipeline({ businessId, tab: "all", scope: { kind: "all" } });
    expect(file.rows).toBe(page.total);
  });
});

describe("the deep link", () => {
  it("finds a row by the reference both sides say on the phone", async () => {
    const ref = await quoted("DEEPLINK");
    const row = await findByRef(businessId, ref);
    expect(row?.ref).toBe(ref);
  });

  it("does not find another supplier's quote", async () => {
    const other = await prisma.quote.findFirstOrThrow({
      where: { businessId: { not: businessId } },
      select: { ref: true },
    });
    expect(await findByRef(businessId, other.ref)).toBeNull();
  });
});
