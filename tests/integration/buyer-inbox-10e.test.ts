import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { callList } from "@/lib/crm/call-list";
import { getBuyerInbox } from "@/lib/enquiry/inbox";
import { nudgeUnanswered } from "@/lib/enquiry/nudge";
import { resendSource, resendSourceIdFor } from "@/lib/enquiry/resend";
import { createEnquiry } from "@/lib/enquiry/service";
import { NUDGE_AFTER_MS } from "@/lib/enquiry/tracking";
import { getInbox } from "@/lib/leads/inbox";
import {
  forgetSavedSearch,
  openSavedSearch,
  saveSearchFor,
  savedSearchesFor,
  setCadence,
  sweepSavedSearches,
} from "@/lib/saved-search/service";

/**
 * Board 10e — the buyer's inbox, nudge-all, re-send and saved searches, against
 * a real database and through the services the pages call.
 *
 * Each buyer here is the file's own, so no seeded enquiry can move a chip count
 * and no other file's rows can hide one.
 */

/*
   The sweep's email sender, captured. `resolveNotificationSenders` picks Resend
   whenever the key is configured, and a suite that mails somebody every run is
   a suite people stop running.
*/
const sent = vi.hoisted(() => [] as { to: string; subject: string }[]);
vi.mock("@/lib/notify/senders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notify/senders")>();
  return {
    ...actual,
    resolveNotificationSenders: () => ({
      email: {
        channel: "email",
        send: async (message: { to: string; subject: string }) => {
          sent.push({ to: message.to, subject: message.subject });
          return { delivered: true };
        },
      },
    }),
  };
});

const PREFIX = "inbox10e";
const DAY = 86_400_000;
const users: string[] = [];
let buyerId: string;
let otherBuyerId: string;
let categoryId: string;
let businessIds: string[] = [];

async function addBuyer(label: string) {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      fullName: `${PREFIX} ${label}`,
      email: `${PREFIX}-${label}-${id.slice(0, 8)}@example.test`,
      roles: ["buyer"],
    },
  });
  users.push(id);
  return id;
}

async function removeFixtures() {
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
  await prisma.savedSearch.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: "valves-and-fittings" }, select: { id: true } })).id;
  businessIds = (
    await prisma.business.findMany({
      where: { publishedAt: { not: null }, suspendedAt: null, claimStatus: "claimed" },
      orderBy: [{ slug: "asc" }, { id: "asc" }],
      select: { id: true },
      take: 4,
    })
  ).map((b) => b.id);
  buyerId = await addBuyer("buyer");
  otherBuyerId = await addBuyer("other");
});

afterAll(async () => {
  await removeFixtures();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

let seq = 0;
async function enquiry(over: {
  buyer?: string;
  createdAt?: Date;
  closesAt: Date;
  recipients?: number;
  deliveredAgo?: number;
  quotedBy?: number[];
  firstQuoteAfter?: number;
  accepted?: boolean;
  lines?: number;
  label?: string;
}) {
  seq += 1;
  const createdAt = over.createdAt ?? new Date(Date.now() - 2 * DAY);
  const deliveredAt = new Date(Date.now() - (over.deliveredAgo ?? 2 * DAY));
  const recipients = businessIds.slice(0, over.recipients ?? 3);
  const row = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${Date.now().toString(36)}-${seq}`,
      buyerId: over.buyer ?? buyerId,
      requirement: `${PREFIX} ${over.label ?? "gate valves"} ${seq}`,
      createdAt,
      closesAt: over.closesAt,
      emirate: "dubai",
      deliverToArea: "Al Quoz Industrial 1",
      lines: {
        create: Array.from({ length: over.lines ?? 1 }, (_, i) => ({
          description: `Gate valve DN${100 + i * 50}`,
          qty: 4,
          sortOrder: i,
        })),
      },
      recipients: { create: recipients.map((businessId) => ({ businessId, createdAt: deliveredAt })) },
    },
    select: { id: true, ref: true },
  });
  for (const index of over.quotedBy ?? []) {
    await prisma.quote.create({
      data: {
        ref: `${row.ref}-q${index}`,
        enquiryId: row.id,
        businessId: recipients[index]!,
        status: over.accepted && index === 0 ? "accepted" : "sent",
        sentAt: new Date(createdAt.getTime() + (over.firstQuoteAfter ?? 60 * 60_000) * (index + 1)),
        ...(over.accepted && index === 0 ? { acceptedAt: new Date() } : {}),
      },
    });
  }
  if (over.accepted) {
    await prisma.enquiry.update({
      where: { id: row.id },
      data: { contactReleasedToBusinessId: recipients[0]!, contactReleasedAt: new Date() },
    });
  }
  return row;
}

describe("the inbox — every row in exactly one chip (B1, B2)", () => {
  beforeEach(removeFixtures);

  it("derives a bucket per row and counts the same rows the table shows", async () => {
    const now = new Date();
    const awaiting = await enquiry({ closesAt: new Date(now.getTime() + 5 * DAY), deliveredAgo: 60 * 60_000 });
    const quotesIn = await enquiry({ closesAt: new Date(now.getTime() + 5 * DAY), quotedBy: [0] });
    const accepted = await enquiry({ closesAt: new Date(now.getTime() + 5 * DAY), quotedBy: [0, 1], accepted: true });
    const expired = await enquiry({ closesAt: new Date(now.getTime() - DAY), quotedBy: [0] });
    // An enquiry that closed after its quote was accepted is accepted, not expired.
    const acceptedThenClosed = await enquiry({ closesAt: new Date(now.getTime() - DAY), quotedBy: [0], accepted: true });

    const inbox = await getBuyerInbox(buyerId, { now });
    const bucketOf = (ref: string) => inbox.rows.find((row) => row.ref === ref)?.bucket;

    expect(bucketOf(awaiting.ref)).toBe("awaiting");
    expect(bucketOf(quotesIn.ref)).toBe("quotes_in");
    expect(bucketOf(accepted.ref)).toBe("accepted");
    expect(bucketOf(expired.ref)).toBe("expired");
    expect(bucketOf(acceptedThenClosed.ref)).toBe("accepted");

    expect(inbox.counts).toEqual({ all: 5, awaiting: 1, quotes_in: 1, accepted: 2, expired: 1 });
    const summed = inbox.counts.awaiting + inbox.counts.quotes_in + inbox.counts.accepted + inbox.counts.expired;
    expect(summed).toBe(inbox.counts.all);

    // The chip filters the same set: two accepted rows behind a chip reading 2.
    const filtered = await getBuyerInbox(buyerId, { bucket: "accepted", now });
    expect(filtered.page.rows.map((row) => row.ref).sort()).toEqual([accepted.ref, acceptedThenClosed.ref].sort());
    expect(filtered.page.total).toBe(filtered.counts.accepted);
  });

  it("never shows one buyer's enquiries in another's inbox (B9)", async () => {
    const now = new Date();
    await enquiry({ buyer: otherBuyerId, closesAt: new Date(now.getTime() + 5 * DAY) });
    const inbox = await getBuyerInbox(buyerId, { now });
    expect(inbox.rows).toHaveLength(0);
    expect(inbox.history.sent).toBe(0);
  });

  it("reads the verb from SENT TO, QUOTED and the clock", async () => {
    const now = new Date();
    const compare = await enquiry({ closesAt: new Date(now.getTime() + 2 * DAY), quotedBy: [0, 1] });
    const partial = await enquiry({ closesAt: new Date(now.getTime() + 6 * DAY), quotedBy: [0] });
    const nudge = await enquiry({ closesAt: new Date(now.getTime() + 6 * DAY), deliveredAgo: 2 * DAY });
    const tooSoon = await enquiry({ closesAt: new Date(now.getTime() + 6 * DAY), deliveredAgo: 60 * 60_000 });
    const resend = await enquiry({ closesAt: new Date(now.getTime() - DAY) });

    const inbox = await getBuyerInbox(buyerId, { now });
    const verb = (ref: string) => inbox.rows.find((row) => row.ref === ref)!.verb;

    expect(verb(compare.ref)).toMatchObject({ kind: "compare" });
    expect(verb(partial.ref)).toMatchObject({ kind: "partial", quoted: 1, sentTo: 3 });
    expect(verb(nudge.ref)).toMatchObject({ kind: "nudge" });
    expect(verb(tooSoon.ref)).toMatchObject({ kind: "awaiting" });
    expect(verb(resend.ref)).toMatchObject({ kind: "resend" });

    // NEEDS YOU: at most two, the quotes about to lapse first (B4).
    expect(inbox.needsYou.length).toBeLessThanOrEqual(2);
    expect(inbox.needsYou[0]).toMatchObject({ kind: "compare" });
    expect(inbox.needsYou[0]!.row.ref).toBe(compare.ref);
    expect(inbox.needsYou.some((card) => card.kind === "nudge" && card.row.ref === nudge.ref)).toBe(true);
  });

  it("takes the median first-quote time over answered enquiries only (B8)", async () => {
    const now = new Date();
    const hour = 60 * 60_000;
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 2));
    const inYear = (daysAgo: number) =>
      new Date(Math.max(yearStart.getTime(), now.getTime() - daysAgo * DAY));
    await enquiry({ createdAt: inYear(3), closesAt: new Date(now.getTime() + DAY), quotedBy: [0], firstQuoteAfter: hour });
    await enquiry({ createdAt: inYear(3), closesAt: new Date(now.getTime() + DAY), quotedBy: [0], firstQuoteAfter: 3 * hour });
    await enquiry({ createdAt: inYear(3), closesAt: new Date(now.getTime() + DAY), quotedBy: [0], firstQuoteAfter: 5 * hour });
    // Unanswered: counted as sent, never as a zero in the median.
    await enquiry({ createdAt: inYear(3), closesAt: new Date(now.getTime() + DAY) });

    const { history } = await getBuyerInbox(buyerId, { now });
    expect(history.sent).toBe(4);
    expect(history.answered).toBe(3);
    expect(history.medianFirstQuoteMs).toBe(3 * hour);
  });
});

describe("nudge every unanswered seller (B5)", () => {
  beforeEach(removeFixtures);

  it("nudges each delivered, un-nudged seller once, and says how many", async () => {
    const now = new Date();
    const row = await enquiry({ closesAt: new Date(now.getTime() + 3 * DAY), deliveredAgo: NUDGE_AFTER_MS + DAY, quotedBy: [0] });
    // The seller who quoted has replied, so the recipient is no longer `delivered`.
    await prisma.enquiryRecipient.updateMany({
      where: { enquiryId: row.id, businessId: businessIds[0]! },
      data: { state: "quoted", firstReplyAt: now },
    });

    expect(await nudgeUnanswered({ buyerId, ref: row.ref, now })).toEqual({ ok: true, nudged: 2 });
    expect(await nudgeUnanswered({ buyerId, ref: row.ref, now })).toEqual({ ok: false, error: "nothing_to_nudge" });

    const recipients = await prisma.enquiryRecipient.findMany({
      where: { enquiryId: row.id },
      select: { businessId: true, buyerNudgedAt: true },
    });
    expect(recipients.filter((r) => r.buyerNudgedAt !== null)).toHaveLength(2);
    expect(recipients.find((r) => r.businessId === businessIds[0])!.buyerNudgedAt).toBeNull();
  });

  it("nudges each seller once when two presses race", async () => {
    const now = new Date();
    const row = await enquiry({ closesAt: new Date(now.getTime() + 3 * DAY), deliveredAgo: NUDGE_AFTER_MS + DAY, recipients: 4 });
    const results = await Promise.all([
      nudgeUnanswered({ buyerId, ref: row.ref, now }),
      nudgeUnanswered({ buyerId, ref: row.ref, now }),
    ]);
    const nudged = results.reduce((sum, result) => sum + (result.ok ? result.nudged : 0), 0);
    expect(nudged).toBe(4);
  });

  it("waits the full day after delivery", async () => {
    const now = new Date();
    const row = await enquiry({ closesAt: new Date(now.getTime() + 3 * DAY), deliveredAgo: NUDGE_AFTER_MS - 60_000 });
    expect(await nudgeUnanswered({ buyerId, ref: row.ref, now })).toEqual({ ok: false, error: "nothing_to_nudge" });
  });

  it("refuses a closed enquiry and somebody else's", async () => {
    const now = new Date();
    const closed = await enquiry({ closesAt: new Date(now.getTime() - 60_000), deliveredAgo: 3 * DAY });
    expect(await nudgeUnanswered({ buyerId, ref: closed.ref, now })).toEqual({ ok: false, error: "closed" });

    const open = await enquiry({ closesAt: new Date(now.getTime() + DAY), deliveredAgo: 3 * DAY });
    expect(await nudgeUnanswered({ buyerId: otherBuyerId, ref: open.ref, now })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("puts the nudge on the seller's lead, where they will see it", async () => {
    const now = new Date();
    const row = await enquiry({ closesAt: new Date(now.getTime() + 3 * DAY), deliveredAgo: 3 * DAY, recipients: 1 });
    await nudgeUnanswered({ buyerId, ref: row.ref, now });

    // Walk the open tab: the lead sits wherever oldest-unanswered puts it.
    let cursor: string | null = null;
    let lead: Awaited<ReturnType<typeof getInbox>>["rows"][number] | undefined;
    for (let pages = 0; pages < 50 && !lead; pages += 1) {
      const page = await getInbox({ businessId: businessIds[0]!, tab: "open", scope: { kind: "all" }, cursor, now });
      lead = page.rows.find((r) => r.ref === row.ref);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(lead?.nudgedAt?.getTime()).toBe(now.getTime());
  });
});

describe("re-send (B3)", () => {
  beforeEach(removeFixtures);

  it("refuses an open enquiry, an accepted one and somebody else's", async () => {
    const now = new Date();
    const open = await enquiry({ closesAt: new Date(now.getTime() + DAY) });
    const accepted = await enquiry({ closesAt: new Date(now.getTime() - DAY), quotedBy: [0], accepted: true });
    const expired = await enquiry({ closesAt: new Date(now.getTime() - DAY) });

    expect(await resendSource(buyerId, open.ref, now)).toMatchObject({ ok: false, reason: "open" });
    expect(await resendSource(buyerId, accepted.ref, now)).toMatchObject({ ok: false, reason: "accepted" });
    expect(await resendSource(otherBuyerId, expired.ref, now)).toEqual({ ok: false, reason: "not_found" });
    expect(await resendSourceIdFor(otherBuyerId, expired.ref, now)).toBeNull();
    expect(await resendSourceIdFor(null, expired.ref, now)).toBeNull();
  });

  it("carries the requirement and lines as free text, and records the link once", async () => {
    const now = new Date();
    const expired = await enquiry({ closesAt: new Date(now.getTime() - DAY), lines: 2 });

    const source = await resendSource(buyerId, expired.ref, now);
    expect(source.ok).toBe(true);
    if (!source.ok) throw new Error("unreachable");
    expect(source.lines).toEqual([
      { description: "Gate valve DN100", qty: 4 },
      { description: "Gate valve DN150", qty: 4 },
    ]);
    expect(source.emirate).toBe("dubai");
    expect(source.deliverToArea).toBe("Al Quoz Industrial 1");

    const result = await createEnquiry({
      buyerId,
      requirement: `${PREFIX} re-sent`,
      lines: source.lines.map((line) => ({ ...line, unit: "pcs" })),
      categoryId,
      emirate: "dubai",
      deliverToArea: "Al Quoz Industrial 1",
      fanoutTo: 3,
      resentFromId: await resendSourceIdFor(buyerId, expired.ref, now),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const created = await prisma.enquiry.findUniqueOrThrow({ where: { id: result.enquiryId }, select: { resentFromId: true } });
    expect(created.resentFromId).toBe(expired.id);

    // The old row is untouched and terminal; a second re-send is refused and names the first.
    expect(await resendSource(buyerId, expired.ref, now)).toMatchObject({
      ok: false,
      reason: "resent",
      resentAsRef: result.ref,
    });
    const inbox = await getBuyerInbox(buyerId, { now });
    expect(inbox.rows.find((row) => row.ref === expired.ref)).toMatchObject({
      bucket: "expired",
      verb: { kind: "resent", ref: result.ref },
    });
  });

  it("cannot point an enquiry at itself", async () => {
    const now = new Date();
    const row = await enquiry({ closesAt: new Date(now.getTime() - DAY) });
    await expect(prisma.enquiry.update({ where: { id: row.id }, data: { resentFromId: row.id } })).rejects.toThrow();
  });
});

describe("saved searches (B6, B7)", () => {
  beforeEach(async () => {
    await removeFixtures();
    sent.length = 0;
  });

  it("decides zero-result by counting, and saving twice keeps one row", async () => {
    const found = await saveSearchFor({ userId: buyerId, name: `${PREFIX} valves`, query: "", categoryId });
    expect(found).toMatchObject({ ok: true, zeroResult: false, created: true });

    const nothing = await saveSearchFor({
      userId: buyerId,
      name: `${PREFIX} nothing`,
      query: `q=${PREFIX}-zzqx-no-such-thing`,
      categoryId,
    });
    expect(nothing).toMatchObject({ ok: true, zeroResult: true, created: true });

    const again = await saveSearchFor({ userId: buyerId, name: `${PREFIX} valves renamed`, query: "", categoryId });
    expect(again).toMatchObject({ id: found.id, created: false });

    const rows = await savedSearchesFor(buyerId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === nothing.id)).toMatchObject({ cadence: "when_listed", stillEmpty: true });
    expect(rows.find((row) => row.id === found.id)).toMatchObject({ cadence: "weekly", name: `${PREFIX} valves renamed` });
  });

  it("counts new matches since the last look, emails once per rise, and opening clears it", async () => {
    const { id } = await saveSearchFor({ userId: buyerId, name: `${PREFIX} valves`, query: "", categoryId });
    // Saved long ago, so everything listed in the trade is new to this buyer.
    await prisma.savedSearch.update({ where: { id }, data: { createdAt: new Date("2000-01-01T00:00:00Z") } });
    await setCadence(buyerId, id, "when_listed");

    const now = new Date();
    await sweepSavedSearches(now);
    const first = await prisma.savedSearch.findUniqueOrThrow({ where: { id } });
    expect(first.newCount).toBeGreaterThan(0);
    expect(first.alertedCount).toBe(first.newCount);
    expect(first.lastMatchAt).not.toBeNull();
    expect(sent.filter((mail) => mail.to.startsWith(`${PREFIX}-buyer`))).toHaveLength(1);

    // The same matches again: the count stands, and nobody is emailed about it twice.
    await sweepSavedSearches(new Date(now.getTime() + 60_000));
    expect((await prisma.savedSearch.findUniqueOrThrow({ where: { id } })).newCount).toBe(first.newCount);
    expect(sent.filter((mail) => mail.to.startsWith(`${PREFIX}-buyer`))).toHaveLength(1);

    // B7: the email did not clear it; opening does, and the count restarts from now.
    const href = await openSavedSearch(buyerId, id, new Date(now.getTime() + 120_000));
    expect(href).toMatch(/^\/c\/valves-and-fittings/);
    const opened = await prisma.savedSearch.findUniqueOrThrow({ where: { id } });
    expect(opened).toMatchObject({ newCount: 0, alertedCount: 0 });

    await sweepSavedSearches(new Date(now.getTime() + 180_000));
    expect((await prisma.savedSearch.findUniqueOrThrow({ where: { id } })).newCount).toBe(0);
  });

  it("waits out its cadence", async () => {
    const { id } = await saveSearchFor({ userId: buyerId, name: `${PREFIX} weekly`, query: "", categoryId });
    const now = new Date();
    await sweepSavedSearches(now);
    const ran = (await prisma.savedSearch.findUniqueOrThrow({ where: { id } })).lastRunAt;
    expect(ran?.getTime()).toBe(now.getTime());

    await sweepSavedSearches(new Date(now.getTime() + 2 * DAY));
    expect((await prisma.savedSearch.findUniqueOrThrow({ where: { id } })).lastRunAt?.getTime()).toBe(now.getTime());

    await sweepSavedSearches(new Date(now.getTime() + 7 * DAY));
    expect((await prisma.savedSearch.findUniqueOrThrow({ where: { id } })).lastRunAt?.getTime()).toBe(
      now.getTime() + 7 * DAY,
    );
  });

  it("is the buyer's own to change and remove", async () => {
    const { id } = await saveSearchFor({ userId: buyerId, name: `${PREFIX} mine`, query: "", categoryId });
    expect(await setCadence(otherBuyerId, id, "daily")).toBe(false);
    expect(await openSavedSearch(otherBuyerId, id)).toBeNull();
    expect(await forgetSavedSearch(otherBuyerId, id)).toBe(false);
    expect(await forgetSavedSearch(buyerId, id)).toBe(true);
    expect(await prisma.savedSearch.count({ where: { id } })).toBe(0);
  });

  it("feeds a search that found nothing into the call list's demand for that trade (B6)", async () => {
    const before = await callList(500);
    const business = await prisma.business.findFirst({
      where: {
        claimStatus: "claimed",
        planId: "free",
        suspendedAt: null,
        mergedIntoId: null,
        id: {
          notIn: before.prospects.filter((p) => p.signal !== "zero_result_in_their_trade").map((p) => p.businessId),
        },
      },
      orderBy: [{ slug: "asc" }, { id: "asc" }],
      select: { id: true, primaryCategoryId: true },
    });
    expect(business, "a claimed Free business whose strongest signal is not something else").not.toBeNull();
    if (!business) return;
    const valueBefore = before.prospects.find((p) => p.businessId === business.id)?.value ?? 0;

    const saved = await saveSearchFor({
      userId: buyerId,
      name: `${PREFIX} standing`,
      query: `q=${PREFIX}-zzqx-no-such-thing`,
      categoryId: business.primaryCategoryId,
    });
    expect(saved.zeroResult).toBe(true);

    const after = await callList(500);
    expect(after.prospects.find((p) => p.businessId === business.id)).toMatchObject({
      signal: "zero_result_in_their_trade",
      value: valueBefore + 1,
    });
  });
});
