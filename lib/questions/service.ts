import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { assertReason, staffMutation } from "@/lib/audit";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";

/**
 * Product questions: a buyer asks, the seller answers, staff may remove.
 *
 * Three writers and three different rules, which is why they are here together
 * rather than spread across three screens:
 *
 *   1. **A buyer needs no account.** An enquiry needs none either, and
 *      requiring a signup before the first question is the fastest way to have
 *      none at all.
 *   2. **Only the seller who owns the product may answer**, and the answer is
 *      theirs verbatim — nothing rewrites it. The card's whole value is that a
 *      real supplier said this about their own goods.
 *   3. **Only staff may remove**, with a written reason, on an audit row. Same
 *      rung as removing a review, because it is the same decision: taking down
 *      something a person wrote in public.
 *
 * A seller cannot delete a question. Deliberate, and the same rule
 * `lib/reviews/service.ts` states for reviews — a question a supplier can make
 * disappear is a question nobody believes the answer to.
 */

/** Long enough to be a question, short enough not to be an enquiry. */
const MAX_QUESTION = 500;
const MAX_ANSWER = 1_000;

export type AskResult =
  | { ok: true; id: string }
  | { ok: false; error: "empty" | "too_long" | "not_found" };

export async function askQuestion(input: {
  productId: string;
  body: string;
  askerId?: string | null;
}): Promise<AskResult> {
  const body = input.body.trim();
  // Two characters, matching the database CHECK rather than guessing at it.
  if (body.length < 2) return { ok: false, error: "empty" };
  if (body.length > MAX_QUESTION) return { ok: false, error: "too_long" };

  /*
     The product decides the business, rather than the caller passing one. A
     caller supplying both could file a question about one seller's product
     into another seller's queue.
  */
  const product = await prisma.product.findFirst({
    where: { id: input.productId, status: { not: "draft" } },
    select: { id: true, businessId: true },
  });
  if (!product) return { ok: false, error: "not_found" };

  const question = await prisma.productQuestion.create({
    data: {
      productId: product.id,
      businessId: product.businessId,
      askerId: input.askerId ?? null,
      body,
    },
    select: { id: true },
  });
  return { ok: true, id: question.id };
}

export type AnswerResult =
  | { ok: true }
  | { ok: false; error: "empty" | "too_long" | "not_yours" | "removed" | "already_answered" };

/**
 * The seller's answer. Once, like a review reply.
 *
 * Answering twice would let a supplier revise what a buyer has already acted
 * on, beside a question anyone can read. A correction is a new question,
 * publicly.
 */
export async function answerQuestion(input: {
  businessId: string;
  questionId: string;
  answer: string;
  answeredBy: string;
}): Promise<AnswerResult> {
  const answer = input.answer.trim();
  if (!answer) return { ok: false, error: "empty" };
  if (answer.length > MAX_ANSWER) return { ok: false, error: "too_long" };

  const question = await prisma.productQuestion.findUnique({
    where: { id: input.questionId },
    select: { businessId: true, answeredAt: true, removedAt: true },
  });
  if (!question || question.businessId !== input.businessId) {
    return { ok: false, error: "not_yours" };
  }
  if (question.removedAt) return { ok: false, error: "removed" };
  if (question.answeredAt) return { ok: false, error: "already_answered" };

  await prisma.productQuestion.update({
    where: { id: input.questionId },
    data: {
      answer,
      // The CHECK requires both together; writing them apart is refused.
      answeredAt: new Date(),
      answeredBy: input.answeredBy,
    },
  });
  return { ok: true };
}

export type RemoveResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "already_removed" };

/**
 * Staff removal, audited, with the reason on the row and on the log.
 *
 * `assertReason` runs before anything is composed into it, for the reason
 * `removeReview` records: composing first turns a ground into the explanation,
 * and a seven-character prefix passes a length check while explaining nothing.
 */
export async function removeQuestion(input: {
  actor: Actor;
  questionId: string;
  reason: string;
}): Promise<RemoveResult> {
  assertCan(input.actor, "question.remove");
  const written = assertReason("question_removed", input.reason);

  const existing = await prisma.productQuestion.findUnique({
    where: { id: input.questionId },
    select: { id: true, businessId: true, body: true, answer: true, removedAt: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.removedAt) return { ok: false, error: "already_removed" };

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "question.remove",
        subject: `ProductQuestion:${input.questionId}`,
        reason: written,
        tx,
      },
      async () => {
        const after = await tx.productQuestion.update({
          where: { id: input.questionId },
          data: { removedAt: new Date(), removalReason: written },
          select: { id: true, removedAt: true, removalReason: true },
        });
        return { result: after, before: existing, after };
      },
    );
  });

  return { ok: true };
}

/** The seller's queue: unanswered first, because those are the ones costing them. */
export async function questionsForSeller(businessId: string, take = 50) {
  return prisma.productQuestion.findMany({
    where: { businessId, removedAt: null },
    orderBy: [{ answeredAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      body: true,
      answer: true,
      answeredAt: true,
      createdAt: true,
      product: { select: { name: true, slug: true } },
    },
  });
}

/**
 * Everything staff may need to look at, newest first.
 *
 * Removed questions stay in the list, marked and with their reason — the same
 * rule the seller's reviews screen states: a removal that leaves no trace looks
 * like the thing never existed, which is what a removal must never resemble.
 */
export async function questionsForModeration(take = 100) {
  const rows = await prisma.productQuestion.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      body: true,
      answer: true,
      answeredAt: true,
      removedAt: true,
      removalReason: true,
      createdAt: true,
      product: { select: { name: true, slug: true } },
      business: { select: { displayName: true, slug: true } },
    },
  });
  return rows;
}
