import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import {
  answerQuestion,
  askQuestion,
  questionsForSeller,
  removeQuestion,
} from "@/lib/questions/service";
import { getQuestions } from "@/lib/db/queries/product-detail";

/**
 * Board 1g's "Ask the seller" card, and the three writers behind it.
 *
 * The rule worth pinning hardest is what does *not* reach the page: an
 * unanswered question is a lead for the seller, not content for a buyer. A card
 * full of unanswered questions reads as a supplier who ignores people, and that
 * is a claim the platform would be making on their behalf out of an absence.
 */

const PREFIX = "question-test-";
let productId: string;
let businessId: string;
let opsLeadId: string;
let moderatorId: string;

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
const REASON = "Contains a competitor's phone number and a request to trade off-platform.";

async function removeFixtures() {
  await prisma.productQuestion.deleteMany({ where: { body: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();

  const product = await prisma.product.findFirstOrThrow({
    where: { status: { not: "draft" }, business: { publishedAt: { not: null }, suspendedAt: null } },
    orderBy: { slug: "asc" },
    select: { id: true, businessId: true },
  });
  productId = product.id;
  businessId = product.businessId;

  const staff = await prisma.user.findMany({
    where: { roles: { hasSome: ["staff_ops_lead", "staff_moderator"] } },
    select: { id: true, roles: true },
  });
  opsLeadId = staff.find((u) => u.roles.includes("staff_ops_lead"))!.id;
  moderatorId = staff.find((u) => u.roles.includes("staff_moderator"))!.id;
});

afterAll(async () => {
  await removeFixtures();
});

async function ask(body: string) {
  const result = await askQuestion({ productId, body: `${PREFIX}${body}` });
  if (!result.ok) throw new Error(`ask failed: ${result.error}`);
  return result.id;
}

describe("a buyer needs no account", () => {
  it("takes a question with no asker at all", async () => {
    /*
       An enquiry needs no signup and neither does this. Requiring one before
       the first question is the fastest way to have none.
    */
    const id = await ask("Is the seat EPDM?");
    const row = await prisma.productQuestion.findUniqueOrThrow({
      where: { id },
      select: { askerId: true, businessId: true },
    });
    expect(row.askerId).toBeNull();
    // The product decided the business, not the caller.
    expect(row.businessId).toBe(businessId);
  });

  it("refuses a question that is not one", async () => {
    expect(await askQuestion({ productId, body: " ? " })).toMatchObject({
      ok: false,
      error: "empty",
    });
    expect(await askQuestion({ productId, body: "x".repeat(501) })).toMatchObject({
      ok: false,
      error: "too_long",
    });
  });
});

describe("only an answered question is public", () => {
  it("keeps an unanswered one off the page and in the seller's queue", async () => {
    const id = await ask("Do you hold DN200 in this range?");

    const shown = await getQuestions(productId, 10);
    expect(shown.shown.map((q) => q.id)).not.toContain(id);

    const queue = await questionsForSeller(businessId);
    expect(queue.map((q) => q.id)).toContain(id);
  });

  it("publishes it the moment the seller answers", async () => {
    const id = await ask("Can you supply counter flanges as a set?");
    const result = await answerQuestion({
      businessId,
      questionId: id,
      answer: "Yes — name the flange standard on the enquiry and we will quote it as one line.",
      answeredBy: opsLeadId,
    });
    expect(result.ok).toBe(true);

    const shown = await getQuestions(productId, 10);
    const published = shown.shown.find((q) => q.id === id);
    expect(published?.answer).toMatch(/flange standard/);
    // Verbatim, both halves. A paraphrase would be us speaking for the supplier.
    expect(published?.body).toContain("counter flanges");
  });

  it("puts unanswered questions first in the seller's queue", async () => {
    /*
       Those are the ones costing them: a buyer who asked and got nothing went
       to the next supplier, and the question is a lead with the intent already
       written down.
    */
    const queue = await questionsForSeller(businessId);
    const mine = queue.filter((q) => q.body.startsWith(PREFIX));
    const firstAnsweredAt = mine.findIndex((q) => q.answeredAt !== null);
    const lastUnanswered = mine.map((q) => q.answeredAt).lastIndexOf(null);
    if (firstAnsweredAt !== -1 && lastUnanswered !== -1) {
      expect(lastUnanswered).toBeLessThan(firstAnsweredAt);
    }
  });
});

describe("the answer is the seller's, once", () => {
  it("refuses a second answer", async () => {
    const id = await ask("What is the face-to-face dimension?");
    await answerQuestion({ businessId, questionId: id, answer: "EN 558 series 14.", answeredBy: opsLeadId });

    const again = await answerQuestion({
      businessId,
      questionId: id,
      answer: "Actually series 13.",
      answeredBy: opsLeadId,
    });
    /*
       Answering twice would let a supplier revise what a buyer has already
       acted on, beside a question anyone can read. A correction is a new
       question, publicly.
    */
    expect(again).toMatchObject({ ok: false, error: "already_answered" });
  });

  it("refuses a seller answering somebody else's question", async () => {
    const id = await ask("Is this WRAS approved?");
    const other = await prisma.business.findFirstOrThrow({
      where: { id: { not: businessId } },
      select: { id: true },
    });
    expect(
      await answerQuestion({
        businessId: other.id,
        questionId: id,
        answer: "Yes.",
        answeredBy: opsLeadId,
      }),
    ).toMatchObject({ ok: false, error: "not_yours" });
  });

  it("refuses an empty answer, and the database refuses a half-written one", async () => {
    const id = await ask("Do you stock the handwheel separately?");
    expect(
      await answerQuestion({ businessId, questionId: id, answer: "   ", answeredBy: opsLeadId }),
    ).toMatchObject({ ok: false, error: "empty" });

    // The CHECK, from the other side: an answer without its timestamp.
    await expect(
      prisma.$executeRaw`UPDATE product_question SET answer = 'Yes' WHERE id = ${id}`,
    ).rejects.toThrow();
  });
});

describe("removal is staff-only, reasoned and audited", () => {
  it("refuses a moderator", async () => {
    /*
       A question carries a buyer's published words. Taking it down is the same
       decision as removing a review, and it is held at the same rung — §07 puts
       that one rung above the moderation queue.
    */
    const id = await ask("Who is your cheapest competitor?");
    await expect(
      removeQuestion({ actor: actor(moderatorId, "staff_moderator"), questionId: id, reason: REASON }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("refuses a removal with no written reason", async () => {
    const id = await ask("Call me on 050 000 0000 instead.");
    await expect(
      removeQuestion({ actor: actor(opsLeadId, "staff_ops_lead"), questionId: id, reason: "  " }),
    ).rejects.toThrow();
  });

  it("removes it, writes the reason on the row and an audit row beside it", async () => {
    const id = await ask("Deal off-platform and I will pay cash.");
    const result = await removeQuestion({
      actor: actor(opsLeadId, "staff_ops_lead"),
      questionId: id,
      reason: REASON,
    });
    expect(result.ok).toBe(true);

    const row = await prisma.productQuestion.findUniqueOrThrow({
      where: { id },
      select: { removedAt: true, removalReason: true },
    });
    expect(row.removedAt).not.toBeNull();
    expect(row.removalReason).toBe(REASON);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "question_removed", subject: `ProductQuestion:${id}` },
      select: { reason: true, actorId: true },
    });
    // Its own action, not `review_removed` — a log that hides what it was is
    // the thing `lib/audit/types.ts` forbids in as many words.
    expect(audit?.reason).toBe(REASON);
    expect(audit?.actorId).toBe(opsLeadId);
  });

  it("takes a removed question off the page and refuses to answer it", async () => {
    const id = await ask("Is the body ductile or grey iron?");
    await removeQuestion({ actor: actor(opsLeadId, "staff_ops_lead"), questionId: id, reason: REASON });

    expect(
      await answerQuestion({ businessId, questionId: id, answer: "Ductile.", answeredBy: opsLeadId }),
    ).toMatchObject({ ok: false, error: "removed" });

    const shown = await getQuestions(productId, 20);
    expect(shown.shown.map((q) => q.id)).not.toContain(id);
  });
});
