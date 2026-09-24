import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { comparisonOutlook } from "@/lib/buyer-company/queue";
import { getQuoteComparison } from "@/lib/db/queries/quote-comparison";
import { sweepClosingEnquiries } from "@/lib/enquiry/closing-job";
import { nudge, nudgeUnanswered } from "@/lib/enquiry/nudge";
import { acceptQuote } from "@/lib/enquiry/service";
import { NUDGE_AFTER_MS } from "@/lib/enquiry/tracking";
import { messageAllSuppliers } from "@/lib/messaging/message-all";
import { buildComparison, winnersOf } from "@/lib/quote/comparison";
import { quoteComparisonCsv } from "@/lib/quote/comparison-export";
import { filsToAed } from "@/lib/quote/money";
import { isVerified } from "@/lib/verification";

/**
 * Board `1n` — comparing the quotes, against a real database and through the
 * services the page, its actions and the hourly sweep call.
 *
 *   - the read model is the buyer's alone, and a brief is not its to read;
 *   - accepting declines the others out loud (`B8`), naming nothing that won;
 *   - the nudge reaches a supplier who opened and went quiet, once (`B10`);
 *   - *Message all* is one message in each supplier's own thread, never a room;
 *   - the closing notice goes once, and only where there is something to lose;
 *   - the CSV is the model, and the row forecast agrees with the gate (`B7`).
 *
 * Suppliers, owners and buyers are this file's own, prefixed, so no seeded
 * count moves and no other file's rows can satisfy an assertion here.
 */

// No carrier is real here: in-app confirms, and email is captured rather than sent.
const sentEmail = vi.hoisted(() => [] as { to: string; subject: string | null; body: string }[]);
vi.mock("@/lib/notify/senders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notify/senders")>();
  return {
    ...actual,
    resolveNotificationSenders: () => ({
      in_app: new actual.InAppNotificationSender(),
      email: {
        name: "capture",
        channel: "email",
        send: async (message: { to: string; subject: string | null; body: string }) => {
          sentEmail.push({ to: message.to, subject: message.subject, body: message.body });
          return { delivered: true, providerRef: "capture" };
        },
      },
    }),
  };
});

const PREFIX = "cmp1n";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const users: string[] = [];
let buyerId: string;
let otherBuyerId: string;
let categoryId: string;
const suppliers: { id: string; slug: string; name: string; ownerId: string }[] = [];

async function user(label: string, over: Partial<{ roles: string[]; businessId: string; email: string }> = {}) {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      fullName: `${PREFIX} ${label}`,
      email: over.email ?? `${PREFIX}-${label}-${id.slice(0, 8)}@example.test`,
      roles: (over.roles ?? ["buyer"]) as never,
      ...(over.businessId ? { businessId: over.businessId } : {}),
    },
  });
  users.push(id);
  return id;
}

async function removeFixtures() {
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
  const businesses = await prisma.business.findMany({ where: { slug: { startsWith: `${PREFIX}-` } }, select: { id: true } });
  const ids = businesses.map((b) => b.id);
  await prisma.notificationDelivery.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.user.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
  await prisma.rateLimitHit.deleteMany({ where: { bucket: "message_all" } });
}

beforeAll(async () => {
  await removeFixtures();
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: "valves-and-fittings" }, select: { id: true } })).id;
  const names = ["Al Waha Industrial Supplies", "Emirates Valve & Fitting Co.", "Northern Gulf Trading", "Technopump Trading LLC", "Gulf Cool Technical Services"];
  for (const [index, name] of names.entries()) {
    const slug = `${PREFIX}-${index}-${randomUUID().slice(0, 6)}`;
    const business = await prisma.business.create({
      data: {
        tradeName: `${name} LLC`,
        displayName: name,
        slug,
        licenceNumber: `DED-${PREFIX}-${index}`,
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 400 * DAY),
        verificationTier: 2,
        verifiedAt: new Date(Date.now() - 90 * DAY),
        claimStatus: "claimed",
        planId: "pro",
        primaryCategoryId: categoryId,
        source: "self_added",
        publishedAt: null,
      },
      select: { id: true },
    });
    const ownerId = await user(`owner${index}`, { roles: ["seller_owner"], businessId: business.id });
    // Email chosen on the matrix for the decline; in-app is on the platform floor.
    await prisma.notificationPreference.create({
      data: { businessId: business.id, routing: { quote_declined: ["email"], enquiry_nudged: ["email"] }, quietHoursEnabled: false },
    });
    await prisma.seatChannel.create({
      data: { userId: ownerId, businessId: business.id, kind: "email", address: `${PREFIX}-owner${index}@example.test`, verifiedAt: new Date() },
    });
    suppliers.push({ id: business.id, slug, name, ownerId });
  }
  buyerId = await user("buyer");
  otherBuyerId = await user("other");
});

beforeEach(() => {
  sentEmail.length = 0;
});

afterAll(async () => {
  await removeFixtures();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const PRICES: Record<number, (string | null)[]> = {
  0: ["198.00", "46.00", "12.00"],
  1: ["183.00", "50.00", null],
  2: ["268.00", "41.00", "11.00"],
  3: ["236.00", "48.00", "13.00"],
};
const QTY = [40, 120, 120];

let seq = 0;
/** The board as drawn: four quotes and a fifth supplier who opened it. */
async function board(over: Partial<{ buyer: string; closesAt: Date; createdAt: Date; openedQuiet: boolean }> = {}) {
  seq += 1;
  const createdAt = over.createdAt ?? new Date(Date.now() - 2 * DAY);
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${Date.now().toString(36)}-${seq}`,
      buyerId: over.buyer ?? buyerId,
      requirement: `${PREFIX} chilled water riser ${seq}. Valves, couplings, gaskets.`,
      closesAt: over.closesAt ?? new Date(Date.now() + 3 * DAY),
      createdAt,
      neededBy: new Date(Date.now() + 11 * DAY),
    },
    select: { id: true, ref: true },
  });
  const lineIds: string[] = [];
  for (const [index, description] of ["Gate valve", "Grooved coupling", "EPDM gasket"].entries()) {
    const line = await prisma.enquiryLine.create({
      data: { enquiryId: enquiry.id, description, qty: QTY[index]!, unit: "pcs", size: "DN100", sortOrder: index },
      select: { id: true },
    });
    lineIds.push(line.id);
  }
  for (const [index, supplier] of suppliers.slice(0, 4).entries()) {
    const sentAt = new Date(createdAt.getTime() + (index + 1) * HOUR);
    await prisma.enquiryRecipient.create({
      data: { enquiryId: enquiry.id, businessId: supplier.id, state: "quoted", openedAt: sentAt, firstReplyAt: sentAt, createdAt },
    });
    await prisma.quote.create({
      data: {
        ref: `QT-${PREFIX}-${seq}-${index}`,
        enquiryId: enquiry.id,
        businessId: supplier.id,
        status: "sent",
        sentAt,
        expiresAt: new Date(Date.now() + 10 * DAY),
        lines: {
          create: PRICES[index]!.flatMap((price, lineIndex) =>
            price === null
              ? []
              : [{ enquiryLineId: lineIds[lineIndex]!, description: `line ${lineIndex}`, qty: QTY[lineIndex]!, unitPrice: price, sortOrder: lineIndex }],
          ),
        },
      },
    });
  }
  await prisma.enquiryRecipient.create({
    data: {
      enquiryId: enquiry.id,
      businessId: suppliers[4]!.id,
      state: over.openedQuiet === false ? "delivered" : "opened",
      openedAt: over.openedQuiet === false ? null : new Date(createdAt.getTime() + 2 * HOUR),
      createdAt,
    },
  });
  return enquiry;
}

describe("the read model is the buyer's", () => {
  it("reads the board line by line, and computes the corrected card from it", async () => {
    const enquiry = await board();
    const data = await getQuoteComparison(buyerId, enquiry.ref);
    expect(data).not.toBeNull();
    const model = buildComparison(data!.input, new Date());
    expect(model.quoted).toBe(4);
    expect(model.sentTo).toBe(5);
    expect([...winnersOf(model).values()].map((id) => suppliers.find((s) => s.id === id)!.name)).toEqual([
      "Emirates Valve & Fitting Co.",
      "Northern Gulf Trading",
      "Northern Gulf Trading",
    ]);
    expect(filsToAed(model.cheapest!.totalFils)).toBe("13560.00");
    expect(model.cheapest!.deliveries).toBe(2);
    expect(filsToAed(model.cheapest!.against!.savingFils)).toBe("1320.00");
  });

  it("resolves a reference or an id, and nobody else's", async () => {
    const enquiry = await board();
    expect(await getQuoteComparison(buyerId, enquiry.id)).not.toBeNull();
    // Somebody else's enquiry and an unknown one are the same null.
    expect(await getQuoteComparison(otherBuyerId, enquiry.ref)).toBeNull();
    expect(await getQuoteComparison(buyerId, "ENQ-000000")).toBeNull();
    // A supplier who quoted on it is not its buyer either.
    expect(await getQuoteComparison(suppliers[0]!.ownerId, enquiry.ref)).toBeNull();
  });

  it("leaves an enquiry for work to the proposals comparison", async () => {
    const enquiry = await board();
    await prisma.serviceBrief.create({
      data: { enquiryId: enquiry.id, categoryId, engagementType: "one_off_job", startMode: "asap" },
    });
    expect(await getQuoteComparison(buyerId, enquiry.ref)).toBeNull();
  });

  it("exports the model: the basis first, a row per supplier, the lowest per line last", async () => {
    const enquiry = await board();
    const data = (await getQuoteComparison(buyerId, enquiry.ref))!;
    const { filename, csv } = quoteComparisonCsv(data, buildComparison(data.input, new Date()));
    expect(filename).toMatch(/^ENQ-cmp1n-[a-z0-9-]+-quotes\.csv$/);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toMatch(/excluding VAT/);
    expect(lines).toHaveLength(1 + 1 + 5 + 1 + 1);
    expect(lines.find((l) => l.startsWith("Al Waha"))).toContain("14880.00");
    expect(lines.at(-1)).toMatch(/^Lowest per line,,,,Emirates Valve & Fitting Co\.,Northern Gulf Trading,Northern Gulf Trading/);
  });
});

describe("accepting declines the others out loud (B8)", () => {
  it("tells every supplier whose quote lost, once, and names nothing that won", async () => {
    const enquiry = await board();
    const winner = await prisma.quote.findFirstOrThrow({
      where: { enquiryId: enquiry.id, businessId: suppliers[0]!.id },
      select: { id: true },
    });
    const result = await acceptQuote(buyerId, winner.id);
    expect(result.ok).toBe(true);

    const declined = await prisma.notificationDelivery.findMany({
      where: { enquiryId: enquiry.id, event: "quote_declined" },
      select: { businessId: true, channel: true, status: true },
      orderBy: [{ businessId: "asc" }, { channel: "asc" }],
    });
    const losers = suppliers.slice(1, 4).map((s) => s.id).sort();
    expect([...new Set(declined.map((d) => d.businessId))].sort()).toEqual(losers);
    // Email chosen on the matrix, in-app from the platform floor — each once.
    for (const businessId of losers) {
      expect(declined.filter((d) => d.businessId === businessId).map((d) => d.channel).sort()).toEqual(["email", "in_app"]);
    }
    // The winner and the supplier who never quoted hear nothing of this.
    expect(declined.some((d) => d.businessId === suppliers[0]!.id || d.businessId === suppliers[4]!.id)).toBe(false);

    // Nothing about the winner travels: not the supplier, not the price.
    expect(sentEmail).toHaveLength(3);
    for (const mail of sentEmail) {
      expect(mail.body).not.toContain("Al Waha");
      expect(mail.body).not.toMatch(/14,?880/);
    }
  });

  it("says nothing to a supplier who declined the enquiry themselves", async () => {
    const enquiry = await board();
    await prisma.enquiryRecipient.update({
      where: { enquiryId_businessId: { enquiryId: enquiry.id, businessId: suppliers[3]!.id } },
      // Quoted, then walked away: the state a supplier's own decline writes.
      data: { state: "declined", declinedAt: new Date(), declineReason: `${PREFIX} out of stock` },
    });
    const winner = await prisma.quote.findFirstOrThrow({ where: { enquiryId: enquiry.id, businessId: suppliers[2]!.id }, select: { id: true } });
    expect((await acceptQuote(buyerId, winner.id)).ok).toBe(true);
    const told = await prisma.notificationDelivery.findMany({
      where: { enquiryId: enquiry.id, event: "quote_declined", channel: "in_app" },
      select: { businessId: true },
    });
    expect(told.map((row) => row.businessId).sort()).toEqual([suppliers[0]!.id, suppliers[1]!.id].sort());
  });
});

describe("the nudge (B10)", () => {
  it("reaches a supplier who opened it and went quiet, a day on — once", async () => {
    const enquiry = await board({ createdAt: new Date(Date.now() - NUDGE_AFTER_MS - HOUR) });
    const quiet = suppliers[4]!.id;
    expect(await nudge({ buyerId, ref: enquiry.ref, businessId: quiet, source: "compare" })).toEqual({ ok: true });
    expect(await nudge({ buyerId, ref: enquiry.ref, businessId: quiet, source: "compare" })).toEqual({
      ok: false,
      error: "already_nudged",
    });
    const carried = await prisma.notificationDelivery.findMany({
      where: { enquiryId: enquiry.id, event: "enquiry_nudged", businessId: quiet },
      select: { channel: true },
      orderBy: { channel: "asc" },
    });
    expect(carried.map((row) => row.channel)).toEqual(["email", "in_app"]);
    // Worded as a reminder about the enquiry they hold, not as a new one.
    expect(sentEmail[0]!.subject).toMatch(/waiting for your quote/);
  });

  it("leaves alone a supplier who has answered, in a quote or in the thread", async () => {
    const enquiry = await board({ createdAt: new Date(Date.now() - NUDGE_AFTER_MS - HOUR) });
    await prisma.enquiryRecipient.update({
      where: { enquiryId_businessId: { enquiryId: enquiry.id, businessId: suppliers[4]!.id } },
      data: { firstReplyAt: new Date() },
    });
    expect(await nudge({ buyerId, ref: enquiry.ref, businessId: suppliers[4]!.id })).toEqual({ ok: false, error: "wrong_state" });
    expect(await nudge({ buyerId, ref: enquiry.ref, businessId: suppliers[0]!.id })).toEqual({ ok: false, error: "wrong_state" });
    expect(await nudgeUnanswered({ buyerId, ref: enquiry.ref })).toEqual({ ok: false, error: "nothing_to_nudge" });
  });

  it("nudges every unanswered supplier in one press and carries it to exactly those", async () => {
    const enquiry = await board({ createdAt: new Date(Date.now() - NUDGE_AFTER_MS - HOUR), openedQuiet: false });
    expect(await nudgeUnanswered({ buyerId, ref: enquiry.ref })).toEqual({ ok: true, nudged: 1 });
    const carried = await prisma.notificationDelivery.findMany({
      where: { enquiryId: enquiry.id, event: "enquiry_nudged", channel: "in_app" },
      select: { businessId: true },
    });
    expect(carried.map((row) => row.businessId)).toEqual([suppliers[4]!.id]);
  });
});

describe("Message all", () => {
  it("writes one message into each supplier's own thread — never a group", async () => {
    const enquiry = await board();
    const result = await messageAllSuppliers({ buyerId, ref: enquiry.ref, body: `${PREFIX} Can you all hold the price to 15 Oct?` });
    expect(result).toEqual({ ok: true, sent: 5, skipped: [] });
    const messages = await prisma.message.findMany({
      where: { enquiryId: enquiry.id },
      select: { businessId: true, authorSide: true, senderId: true },
    });
    expect(messages).toHaveLength(5);
    expect(new Set(messages.map((m) => m.businessId)).size).toBe(5);
    expect(messages.every((m) => m.authorSide === "buyer" && m.senderId === buyerId)).toBe(true);
  });

  it("refuses a second press inside the cooldown, and names who could not take it", async () => {
    const enquiry = await board();
    await prisma.enquiryRecipient.update({
      where: { enquiryId_businessId: { enquiryId: enquiry.id, businessId: suppliers[4]!.id } },
      data: { declinedAt: new Date(), state: "declined" },
    });
    const first = await messageAllSuppliers({ buyerId, ref: enquiry.ref, body: `${PREFIX} first` });
    expect(first.ok && first.sent).toBe(4);
    const second = await messageAllSuppliers({ buyerId, ref: enquiry.ref, body: `${PREFIX} again` });
    expect(second).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("is refused once a quote is accepted, and on somebody else's enquiry", async () => {
    const enquiry = await board();
    expect(await messageAllSuppliers({ buyerId: otherBuyerId, ref: enquiry.ref, body: "hello" })).toEqual({ ok: false, error: "not_found" });
    const winner = await prisma.quote.findFirstOrThrow({ where: { enquiryId: enquiry.id, businessId: suppliers[0]!.id }, select: { id: true } });
    expect((await acceptQuote(buyerId, winner.id)).ok).toBe(true);
    expect(await messageAllSuppliers({ buyerId, ref: enquiry.ref, body: "hello" })).toEqual({ ok: false, error: "decided" });
  });
});

describe("the closing notice", () => {
  it("goes once to a buyer whose quotes stop being acceptable within the day", async () => {
    const closing = await board({ closesAt: new Date(Date.now() + 6 * HOUR) });
    const later = await board({ closesAt: new Date(Date.now() + 3 * DAY) });
    await sweepClosingEnquiries();
    await sweepClosingEnquiries();
    const notices = await prisma.notificationDelivery.findMany({
      where: { event: "enquiry_closing", enquiryId: { in: [closing.id, later.id] } },
      select: { enquiryId: true, channel: true },
    });
    expect(new Set(notices.map((n) => n.enquiryId))).toEqual(new Set([closing.id]));
    // One row per channel, however many times the sweep runs.
    expect(notices.filter((n) => n.channel === "in_app")).toHaveLength(1);
  });

  it("never lets an enquiry already told hold the batch", async () => {
    const sooner = await board({ closesAt: new Date(Date.now() + 2 * HOUR) });
    const after = await board({ closesAt: new Date(Date.now() + 4 * HOUR) });
    // A batch of one takes the day's closes one run at a time, whatever else the
    // database holds. Filtered after the batch, the first enquiry told would have
    // been the whole batch on every later run.
    const inWindow = await prisma.enquiry.count({ where: { closesAt: { gt: new Date(), lte: new Date(Date.now() + DAY) } } });
    for (let run = 0; run <= inWindow; run += 1) await sweepClosingEnquiries(new Date(), { batch: 1 });
    const told = await prisma.notificationDelivery.findMany({
      where: { event: "enquiry_closing", enquiryId: { in: [sooner.id, after.id] } },
      select: { enquiryId: true },
      distinct: ["enquiryId"],
      orderBy: { enquiryId: "asc" },
    });
    expect(new Set(told.map((row) => row.enquiryId))).toEqual(new Set([sooner.id, after.id]));
  });

  it("says nothing where nothing can be lost — accepted, or no quote", async () => {
    const accepted = await board({ closesAt: new Date(Date.now() + 6 * HOUR) });
    const winner = await prisma.quote.findFirstOrThrow({ where: { enquiryId: accepted.id, businessId: suppliers[1]!.id }, select: { id: true } });
    expect((await acceptQuote(buyerId, winner.id)).ok).toBe(true);
    await sweepClosingEnquiries();
    expect(await prisma.notificationDelivery.count({ where: { event: "enquiry_closing", enquiryId: accepted.id } })).toBe(0);
  });
});

describe("the row forecast agrees with the gate (B7)", () => {
  it("says Send for approval exactly where accepting would be refused for it", async () => {
    // Priya, buying for Marina Facilities (the 7b seed), on a quote of her own.
    const priya = await prisma.user.findFirst({
      where: { fullName: "Priya Menon", buyerCompanyId: { not: null } },
      select: { id: true, buyerCompanyId: true },
      orderBy: { id: "asc" },
    });
    if (!priya?.buyerCompanyId) return; // an unseeded database has no company to gate on
    const enquiry = await board({ buyer: priya.id });
    await prisma.enquiry.update({ where: { id: enquiry.id }, data: { buyerCompanyId: priya.buyerCompanyId } });

    const data = (await getQuoteComparison(priya.id, enquiry.ref))!;
    const model = buildComparison(data.input, new Date());
    const rows = model.rows.filter((row) => row.kind === "quoted");
    const outlook = await comparisonOutlook(
      priya.id,
      data.enquiry,
      rows.map((row) => ({
        id: row.kind === "quoted" ? row.quote.id : "",
        valueFils: row.kind === "quoted" ? row.totalFils : null,
        supplierVerified: isVerified(row.supplier.verificationTier),
      })),
    );
    expect(outlook.kind).toBe("company");
    if (outlook.kind !== "company") return;
    for (const row of rows) {
      if (row.kind !== "quoted") continue;
      const forecast = outlook.quotes.get(row.quote.id)!;
      const decided = await acceptQuote(priya.id, row.quote.id, new Date(), { poNumber: "PO-1N-TEST" });
      // Each attempt either accepts (and ends the loop) or is refused for approval.
      if (decided.ok) {
        expect(forecast.required).toBe(false);
        break;
      }
      expect(forecast.required).toBe(true);
      expect(decided.error).toBe("approval_required");
      expect(forecast.approverNames.length).toBeGreaterThan(0);
    }
  });
});
