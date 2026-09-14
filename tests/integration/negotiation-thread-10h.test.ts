import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { acceptQuote } from "@/lib/enquiry/service";
import {
  buyerThreadAttachment,
  getThread,
  markThreadRead,
  postMessage,
  sellerThreadAttachment,
  signThreadAttachment,
  type ThreadStorage,
} from "@/lib/messaging/service";
import { loadNegotiation } from "@/lib/messaging/negotiation-server";
import { compareRevision, revisionPairs } from "@/lib/messaging/negotiation";
import { threadAttachmentPath } from "@/lib/messaging/attachments";
import { sendQuoteForBusiness, type SendQuoteInput } from "@/lib/quote/send-quote";
import { revisionPdf } from "@/lib/quote/revision-pdf";

/**
 * Board `10h` against a real database.
 *
 * What only Postgres can show: that `message_is_the_record` refuses an edit and
 * a delete while a cascade still clears a thread with its enquiry (`B10`); that
 * the side of a message is a column the read never re-derives (`B5`); that a
 * receipt is set once and only by the other side; that a file sent in one
 * thread cannot be reached from another supplier's; and that the buyer's rail
 * is every recipient, silence included (`B9`).
 *
 * ## Fixtures
 *
 * Three claimed sellers with owner seats and a buyer of the file's own, every
 * enquiry tagged with `PREFIX` and deleted by it — which is itself the cascade
 * the trigger has to let through.
 */

const PREFIX = "10H-NEGOTIATION-FIXTURE";
const DAY = 86_400_000;

let buyerId: string;
let strangerBuyerId: string;
let a: { id: string; slug: string; actor: Actor };
let b: { id: string; slug: string; actor: Actor };
let c: { id: string; slug: string; actor: Actor };

async function seller(slug: string) {
  const business = await prisma.business.findFirstOrThrow({ where: { slug }, select: { id: true, slug: true } });
  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId: business.id, roles: { has: "seller_owner" } },
    orderBy: { id: "asc" },
    select: { id: true, roles: true },
  });
  return { id: business.id, slug: business.slug, actor: { id: seat.id, roles: seat.roles, businessId: business.id } as Actor };
}

/** Storage that holds whatever a test says it holds. */
function fakeStorage(files: Record<string, { bytes: number; mimeType: string }>) {
  const removed: string[] = [];
  const storage: ThreadStorage = {
    sign: async (_bucket, path) => ({ path, token: "t", url: `https://storage.test/${path}` }),
    stat: async (path) => files[path] ?? null,
    remove: async (_bucket, path) => {
      removed.push(path);
    },
  };
  return { storage, removed };
}

beforeAll(async () => {
  a = await seller("al-waha-industrial-supplies");
  b = await seller("copperfield-industrial-supplies-llc");
  c = await seller("al-marwan-industrial-supplies-llc");
  const buyers = await prisma.user.findMany({
    where: { roles: { has: "buyer" } },
    orderBy: { id: "asc" },
    select: { id: true },
    take: 2,
  });
  buyerId = buyers[0]!.id;
  strangerBuyerId = buyers[1]!.id;
});

afterAll(async () => {
  // A cascade: the trigger lets it through, and the thread goes with its enquiry.
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.document.deleteMany({ where: { kind: "thread_attachment", storagePath: { contains: "10h-fixture" } } });
  await prisma.$disconnect();
});

async function enquiry(label: string, options: { closesAt?: Date; recipients?: string[] } = {}) {
  return prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}-${Date.now().toString(36)}`,
      buyerId,
      requirement: `${PREFIX} ${label} — grooved valves, couplings and gaskets.`,
      closesAt: options.closesAt ?? new Date(Date.now() + 5 * DAY),
      lines: {
        create: [
          { description: `${PREFIX} valve`, qty: 40, unit: "pcs", sortOrder: 0 },
          { description: `${PREFIX} coupling`, qty: 120, unit: "pcs", sortOrder: 1 },
          { description: `${PREFIX} gasket`, qty: 120, unit: "pcs", sortOrder: 2 },
        ],
      },
      recipients: { create: (options.recipients ?? [a.id, b.id, c.id]).map((businessId) => ({ businessId })) },
    },
    select: { id: true, ref: true, lines: { orderBy: { sortOrder: "asc" }, select: { id: true } } },
  });
}

function quoteInput(e: Awaited<ReturnType<typeof enquiry>>, prices: (string | null)[]): SendQuoteInput {
  return {
    enquiryId: e.id,
    note: "",
    validityDays: 14,
    paymentTerms: "net_30",
    delivery: "included",
    lines: prices
      .map((price, index) =>
        price === null
          ? null
          : {
              enquiryLineId: e.lines[index]!.id,
              productId: null,
              description: [`${PREFIX} valve`, `${PREFIX} coupling`, `${PREFIX} gasket`][index]!,
              qty: [40, 120, 120][index]!,
              unitPrice: price,
              leadTimeDays: 0,
            },
      )
      .filter((line): line is NonNullable<typeof line> => line !== null),
  };
}

/* ── B5 · the side is stated ───────────────────────────────────────────────── */

describe("whose words a message is (B5)", () => {
  it("is written with the message, by the service, for both sides", async () => {
    const e = await enquiry("side");
    await postMessage({ enquiryId: e.id, businessId: a.id, senderId: buyerId, sender: "buyer", body: "Can you match 190?" });
    await postMessage({ enquiryId: e.id, businessId: a.id, senderId: a.actor.id, sender: "seller", body: "191 is our floor." });
    const rows = await prisma.message.findMany({
      where: { enquiryId: e.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { authorSide: true },
    });
    expect(rows.map((row) => row.authorSide)).toEqual(["buyer", "seller"]);
  });

  it("is filled by the database for a writer that does not say — the deployed code, until this merges", async () => {
    const e = await enquiry("side-default");
    const [row] = await prisma.$queryRaw<{ author_side: string }[]>`
      INSERT INTO message (id, enquiry_id, business_id, sender_id, body)
      VALUES (${`m-${PREFIX}-${Date.now()}`}, ${e.id}, ${a.id}, ${a.actor.id}::uuid, 'written by an older build')
      RETURNING author_side::text
    `;
    expect(row!.author_side).toBe("seller");
  });
});

/* ── B10 · the record ──────────────────────────────────────────────────────── */

describe("the thread is the record (B10)", () => {
  it("refuses an edit and a delete aimed at a message, and lets its enquiry take it", async () => {
    const e = await enquiry("record");
    const sent = await postMessage({ enquiryId: e.id, businessId: a.id, senderId: buyerId, sender: "buyer", body: "On the record." });
    if (!sent.ok) throw new Error("fixture message did not send");

    await expect(prisma.message.update({ where: { id: sent.messageId }, data: { body: "Rewritten." } })).rejects.toThrow(
      /part of the record/,
    );
    await expect(prisma.message.delete({ where: { id: sent.messageId } })).rejects.toThrow(/part of the record/);

    await prisma.enquiry.delete({ where: { id: e.id } });
    expect(await prisma.message.count({ where: { id: sent.messageId } })).toBe(0);
  });

  it("sets a receipt once, and refuses to move it", async () => {
    const e = await enquiry("receipt-once");
    const sent = await postMessage({ enquiryId: e.id, businessId: a.id, senderId: a.actor.id, sender: "seller", body: "Datasheets today." });
    if (!sent.ok) throw new Error("fixture message did not send");
    await prisma.message.update({ where: { id: sent.messageId }, data: { readAt: new Date() } });
    await expect(
      prisma.message.update({ where: { id: sent.messageId }, data: { readAt: new Date(Date.now() + 60_000) } }),
    ).rejects.toThrow(/already read/);
  });
});

/* ── Receipts, both ways ───────────────────────────────────────────────────── */

describe("read receipts", () => {
  it("stamps the other side's messages only, first opening only, and nothing for a stranger", async () => {
    const e = await enquiry("receipts");
    await postMessage({ enquiryId: e.id, businessId: a.id, senderId: buyerId, sender: "buyer", body: "Northern Gulf are at 190." });
    await postMessage({ enquiryId: e.id, businessId: a.id, senderId: a.actor.id, sender: "seller", body: "191, our floor." });

    expect(await markThreadRead(e.id, a.id, { side: "buyer", buyerId: strangerBuyerId })).toEqual({ marked: 0 });
    expect(await markThreadRead(e.id, a.id, { side: "buyer", buyerId })).toEqual({ marked: 1 });
    expect(await markThreadRead(e.id, a.id, { side: "buyer", buyerId })).toEqual({ marked: 0 });

    const afterBuyer = await getThread(e.id, a.id);
    expect(afterBuyer!.map((m) => [m.fromSeller, m.readAt !== null])).toEqual([
      [false, false],
      [true, true],
    ]);

    expect(await markThreadRead(e.id, a.id, { side: "seller" })).toEqual({ marked: 1 });
    const afterSeller = await getThread(e.id, a.id);
    expect(afterSeller!.every((m) => m.readAt !== null)).toBe(true);
  });
});

/* ── Q5 · files ────────────────────────────────────────────────────────────── */

describe("files in a thread (Q5)", () => {
  it("attaches a file this side was signed for, to this thread only", async () => {
    const e = await enquiry("files");
    const path = threadAttachmentPath(e.id, a.id, "buyer", "10h-fixture riser drawing.pdf");
    const { storage } = fakeStorage({ [path]: { bytes: 240_000, mimeType: "application/pdf" } });

    const sent = await postMessage(
      { enquiryId: e.id, businessId: a.id, senderId: buyerId, sender: "buyer", body: "", attachments: [{ path, filename: "Riser drawing.pdf" }] },
      storage,
    );
    expect(sent).toMatchObject({ ok: true });

    const thread = await getThread(e.id, a.id);
    const [file] = thread!.at(-1)!.attachments;
    expect(file).toMatchObject({ filename: "Riser drawing.pdf", bytes: 240_000, mimeType: "application/pdf" });

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: file!.documentId },
      select: { kind: true, enquiryId: true, businessId: true, isPublic: true },
    });
    // Not the enquiry's attachment set, not the supplier's documents, not public.
    expect(document).toEqual({ kind: "thread_attachment", enquiryId: null, businessId: null, isPublic: false });

    expect(await buyerThreadAttachment(buyerId, e.ref, a.slug, file!.documentId)).toBe(path);
    expect(await buyerThreadAttachment(buyerId, e.ref, b.slug, file!.documentId)).toBeNull();
    expect(await buyerThreadAttachment(strangerBuyerId, e.ref, a.slug, file!.documentId)).toBeNull();
    expect(await sellerThreadAttachment(a.id, e.id, file!.documentId)).toBe(path);
    // Another supplier on the same enquiry.
    expect(await sellerThreadAttachment(b.id, e.id, file!.documentId)).toBeNull();

    // And the same path does not go twice.
    const again = await postMessage(
      { enquiryId: e.id, businessId: a.id, senderId: buyerId, sender: "buyer", body: "Again", attachments: [{ path, filename: "x.pdf" }] },
      storage,
    );
    expect(again).toEqual({ ok: false, error: "attachment_missing" });
  });

  it("refuses a path the other side, or another thread, was signed for", async () => {
    const e = await enquiry("files-wrong-path");
    const sellerPath = threadAttachmentPath(e.id, a.id, "seller", "10h-fixture datasheet.pdf");
    const otherThread = threadAttachmentPath(e.id, b.id, "buyer", "10h-fixture drawing.pdf");
    const { storage } = fakeStorage({
      [sellerPath]: { bytes: 1000, mimeType: "application/pdf" },
      [otherThread]: { bytes: 1000, mimeType: "application/pdf" },
    });
    for (const path of [sellerPath, otherThread, "enquiries/elsewhere/file.pdf"]) {
      const result = await postMessage(
        { enquiryId: e.id, businessId: a.id, senderId: buyerId, sender: "buyer", body: "See attached", attachments: [{ path, filename: "f.pdf" }] },
        storage,
      );
      expect(result).toEqual({ ok: false, error: "attachment_missing" });
    }
    expect(await prisma.message.count({ where: { enquiryId: e.id } })).toBe(0);
  });

  it("removes a file storage says is not what the bucket allows, and sends nothing", async () => {
    const e = await enquiry("files-refused");
    const path = threadAttachmentPath(e.id, a.id, "buyer", "10h-fixture boq.xlsx");
    const { storage, removed } = fakeStorage({ [path]: { bytes: 1000, mimeType: "application/vnd.ms-excel" } });
    const result = await postMessage(
      { enquiryId: e.id, businessId: a.id, senderId: buyerId, sender: "buyer", body: "BOQ", attachments: [{ path, filename: "boq.xlsx" }] },
      storage,
    );
    expect(result).toEqual({ ok: false, error: "type" });
    expect(removed).toEqual([path]);
    expect(await prisma.message.count({ where: { enquiryId: e.id } })).toBe(0);
  });

  it("signs an upload only where a message would be taken", async () => {
    const open = await enquiry("sign-open");
    const closed = await enquiry("sign-closed", { closesAt: new Date(Date.now() - 60_000) });
    const { storage } = fakeStorage({});
    const input = { businessId: a.id, senderId: buyerId, sender: "buyer" as const, filename: "drawing.pdf", type: "application/pdf", bytes: 5000 };

    const signed = await signThreadAttachment({ ...input, enquiryId: open.id }, storage);
    expect(signed).toMatchObject({ ok: true });
    if (signed.ok) expect(signed.path.startsWith(`threads/${open.id}/${a.id}/buyer/`)).toBe(true);

    expect(await signThreadAttachment({ ...input, enquiryId: closed.id }, storage)).toEqual({ ok: false, error: "closed" });
    expect(await signThreadAttachment({ ...input, enquiryId: open.id, senderId: strangerBuyerId }, storage)).toEqual({
      ok: false,
      error: "not_a_participant",
    });
    expect(await signThreadAttachment({ ...input, enquiryId: open.id, type: "text/csv" }, storage)).toEqual({ ok: false, error: "type" });
    expect(await signThreadAttachment({ ...input, enquiryId: open.id, bytes: 11 * 1024 * 1024 }, storage)).toEqual({
      ok: false,
      error: "size",
    });
  });
});

/* ── The negotiation, as the buyer reads it ────────────────────────────────── */

describe("loadNegotiation", () => {
  it("is the whole fan-out — silence included (B9) — and nothing of anybody else's", async () => {
    const e = await enquiry("rail");
    const r1 = await sendQuoteForBusiness(a.actor, a.id, quoteInput(e, ["198.00", "46.00", "12.00"]));
    const partial = await sendQuoteForBusiness(b.actor, b.id, quoteInput(e, ["189.00", "47.50", null]));
    if (!r1.ok || !partial.ok) throw new Error("fixture quotes did not send");
    await postMessage({ enquiryId: e.id, businessId: a.id, senderId: buyerId, sender: "buyer", body: "Northern Gulf are at 190 on the valve." });
    const r2 = await sendQuoteForBusiness(a.actor, a.id, quoteInput(e, ["191.00", "46.00", "12.00"]));
    if (!r2.ok) throw new Error("revision did not send");
    await postMessage({ enquiryId: e.id, businessId: a.id, senderId: a.actor.id, sender: "seller", body: "One drop makes it easier — 191 is our floor.", quoteRevisionId: r2.quoteId });

    const negotiation = await loadNegotiation(buyerId, e.ref, a.slug);
    expect(negotiation).not.toBeNull();
    const rail = new Map(negotiation!.rail.map((row) => [row.businessId, row]));
    expect(rail.size).toBe(3);
    expect(rail.get(a.id)).toMatchObject({ sellerHasWritten: true, lastMessage: { fromSeller: true } });
    expect(rail.get(a.id)!.latestQuote!.revision).toBe(2);
    expect(rail.get(c.id)).toMatchObject({ sellerHasWritten: false, lastMessage: null, latestQuote: null });

    // An acknowledgement a schedule wrote is not a reply: silence stays silence (B9).
    await postMessage({ enquiryId: e.id, businessId: c.id, senderId: c.actor.id, sender: "seller", body: "We are closed until 8am.", automatic: true });
    const acknowledged = await loadNegotiation(buyerId, e.ref, a.slug);
    expect(acknowledged!.rail.find((row) => row.businessId === c.id)).toMatchObject({ sellerHasWritten: false });

    // Every revision in full, and the table's figures derived from them.
    const pairs = revisionPairs(negotiation!.record.quotes);
    const latest = pairs.at(-1)!;
    const compared = compareRevision(latest.quote, latest.previous, negotiation!.record.requirement);
    expect(compared.totalFils).toBe(1_460_000n);
    expect(compared.previousTotalFils).toBe(1_488_000n);
    expect(compared.lines.map((line) => line.previousUnitFils)).toEqual([19_800n, null, null]);

    // The partial quote leaves the gasket unpriced, by the requirement line it did not link.
    const partialRow = rail.get(b.id)!;
    expect(compareRevision(partialRow.latestQuote!, null, negotiation!.record.requirement).notQuoted).toHaveLength(1);

    // The PDF of r2 carries the same total as the table.
    const pdf = revisionPdf({
      supplierName: negotiation!.supplier.displayName,
      enquiryRef: e.ref,
      quote: latest.quote,
      comparison: compared,
      now: new Date(),
    });
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");

    expect(await loadNegotiation(strangerBuyerId, e.ref, a.slug)).toBeNull();
    const outsider = await prisma.business.findFirstOrThrow({
      where: { recipients: { none: { enquiryId: e.id } }, claimStatus: "claimed" },
      orderBy: { id: "asc" },
      select: { slug: true },
    });
    expect(await loadNegotiation(buyerId, e.ref, outsider.slug)).toBeNull();
    // By id as well as by reference: links already sent out carry the id.
    expect((await loadNegotiation(buyerId, e.id, a.slug))?.enquiry.ref).toBe(e.ref);
  });
});

/* ── Accepting from the thread (B6) ────────────────────────────────────────── */

describe("accepting from the thread", () => {
  it("closes every other thread to both sides, and a closed enquiry cannot be accepted", async () => {
    const e = await enquiry("accept", { recipients: [a.id, b.id] });
    const fromA = await sendQuoteForBusiness(a.actor, a.id, quoteInput(e, ["191.00", "46.00", "12.00"]));
    const fromB = await sendQuoteForBusiness(b.actor, b.id, quoteInput(e, ["190.00", "48.00", "13.00"]));
    if (!fromA.ok || !fromB.ok) throw new Error("fixture quotes did not send");

    expect(await acceptQuote(buyerId, fromA.quoteId)).toMatchObject({ ok: true, declined: 1 });

    // Board 10h: accepted elsewhere, read-only — for the buyer and for the supplier not chosen.
    expect(
      await postMessage({ enquiryId: e.id, businessId: b.id, senderId: buyerId, sender: "buyer", body: "Sorry, we went elsewhere." }),
    ).toEqual({ ok: false, error: "not_chosen" });
    expect(
      await postMessage({ enquiryId: e.id, businessId: b.id, senderId: b.actor.id, sender: "seller", body: "Can we still help?" }),
    ).toEqual({ ok: false, error: "not_chosen" });
    // The accepted pair keep talking.
    expect(
      await postMessage({ enquiryId: e.id, businessId: a.id, senderId: buyerId, sender: "buyer", body: "When can we collect?" }),
    ).toMatchObject({ ok: true });

    const closed = await enquiry("accept-closed", { recipients: [a.id] });
    const late = await sendQuoteForBusiness(a.actor, a.id, quoteInput(closed, ["191.00", "46.00", "12.00"]));
    if (!late.ok) throw new Error("fixture quote did not send");
    await prisma.enquiry.update({ where: { id: closed.id }, data: { closesAt: new Date(Date.now() - 60_000) } });
    expect(await acceptQuote(buyerId, late.quoteId)).toEqual({ ok: false, error: "enquiry_closed" });
    expect(await prisma.enquiry.findUniqueOrThrow({ where: { id: closed.id }, select: { contactReleasedToBusinessId: true } })).toEqual({
      contactReleasedToBusinessId: null,
    });
  });
});
