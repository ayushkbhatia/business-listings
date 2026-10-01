import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor, Role } from "@/lib/auth/roles";
import {
  answerQuestion,
  askQuestion,
  questionsForModeration,
  removeQuestion,
} from "@/lib/questions/service";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * `/admin/questions` — board 1g's staff side. Build plan 9.7 names it as a
 * route with zero tests; `product-questions.test.ts` covers the three writers
 * one at a time, and nothing covered the list the screen reads or two writers
 * arriving together.
 *
 * Two races, both the shape `staffMutation`'s note describes — a check, then an
 * unconditional write:
 *
 * - **Two removals** both passed the "already removed?" check. The second
 *   reason overwrote the first on the row and the log recorded two removals of
 *   one question, one of them a decision that took effect on nothing.
 * - **Two answers** both passed "already answered?", and the second replaced
 *   the first — the revision the once-only rule exists to forbid.
 *
 * Questions of this file's own, on a seeded product, removed afterwards with
 * their audit rows. The product is shared with `product-questions.test.ts` and
 * this file only ever adds rows to it.
 */

const PREFIX = "admin-questions-test-";
let productId = "";
let businessId = "";
let opsLeads: string[] = [];
const subjects: string[] = [];

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
const REASON_A = "Asks the seller to move the conversation to a personal phone number.";
const REASON_B = "Names a competitor and invites the seller to undercut them off-platform.";

async function ask(body: string): Promise<string> {
  const result = await askQuestion({ productId, body: `${PREFIX}${body}` });
  if (!result.ok) throw new Error(`ask failed: ${result.error}`);
  subjects.push(`ProductQuestion:${result.id}`);
  return result.id;
}

beforeAll(async () => {
  const product = await prisma.product.findFirstOrThrow({
    where: { status: { not: "draft" }, business: { publishedAt: { not: null }, suspendedAt: null } },
    orderBy: { slug: "asc" },
    select: { id: true, businessId: true },
  });
  productId = product.id;
  businessId = product.businessId;

  // Two ops leads, because the race is between two people.
  opsLeads = (
    await prisma.user.findMany({
      where: { roles: { has: "staff_ops_lead" } },
      orderBy: { id: "asc" },
      take: 2,
      select: { id: true },
    })
  ).map((u) => u.id);
  if (opsLeads.length < 2) throw new Error("the seed carries two ops leads, for dual control");
});

afterAll(async () => {
  await purgeAuditRows({ subject: { in: subjects } });
  await prisma.productQuestion.deleteMany({ where: { body: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("what the moderation list shows", () => {
  it("is newest first, and keeps a removed question with its reason on it", async () => {
    const first = await ask("Is the seat EPDM or NBR?");
    const second = await ask("Call me on my mobile instead.");
    const third = await ask("Do you hold stock in Jebel Ali?");
    await removeQuestion({
      actor: actor(opsLeads[0]!, "staff_ops_lead"),
      questionId: second,
      reason: REASON_A,
    });

    const mine = (await questionsForModeration()).filter((q) => q.body.startsWith(PREFIX));
    const ids = mine.map((q) => q.id);
    // Newest first, and the removal did not take it out of the list: a removal
    // that leaves no trace looks like the question was never asked.
    expect(ids.indexOf(third)).toBeLessThan(ids.indexOf(second));
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first));
    const removed = mine.find((q) => q.id === second);
    expect(removed?.removedAt).not.toBeNull();
    expect(removed?.removalReason).toBe(REASON_A);
    expect(mine.find((q) => q.id === first)?.removedAt).toBeNull();
  });

  it("names the supplier by display name, and points at a product page that exists", async () => {
    const id = await ask("What is the pressure rating?");
    const row = (await questionsForModeration()).find((q) => q.id === id);
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { displayName: true, slug: true },
    });
    expect(row?.business.displayName).toBe(business.displayName);

    /*
       The screen links `/b/:slug/p/:product`. Asserted as a destination — the
       product with that slug under that business — rather than as a link
       existing, which is the test that passes while the link goes nowhere.
    */
    const product = await prisma.product.findFirst({
      where: { slug: row!.product.slug, business: { slug: row!.business.slug } },
      select: { id: true },
    });
    expect(product?.id).toBe(productId);
  });
});

describe("two ops leads removing one question at once", () => {
  it("removes it once, with one reason and one audit row", async () => {
    const id = await ask("Can we settle this outside the platform?");

    const results = await Promise.all([
      removeQuestion({ actor: actor(opsLeads[0]!, "staff_ops_lead"), questionId: id, reason: REASON_A }),
      removeQuestion({ actor: actor(opsLeads[1]!, "staff_ops_lead"), questionId: id, reason: REASON_B }),
    ]);

    const won = results.filter((r) => r.ok);
    expect(won).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "already_removed" }]);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "question_removed", subject: `ProductQuestion:${id}` },
      select: { reason: true, actorId: true },
    });
    expect(audits).toHaveLength(1);
    // The row says what the log says: whoever won, the reason is theirs.
    const row = await prisma.productQuestion.findUniqueOrThrow({
      where: { id },
      select: { removalReason: true },
    });
    expect(row.removalReason).toBe(audits[0]!.reason);
    expect(audits[0]!.actorId).toBe(results[0]!.ok ? opsLeads[0] : opsLeads[1]);
  });

  it("refuses a second removal that arrives later, and logs nothing for it", async () => {
    const id = await ask("Is there a cheaper grade?");
    await removeQuestion({ actor: actor(opsLeads[0]!, "staff_ops_lead"), questionId: id, reason: REASON_A });
    const again = await removeQuestion({
      actor: actor(opsLeads[1]!, "staff_ops_lead"),
      questionId: id,
      reason: REASON_B,
    });
    expect(again).toEqual({ ok: false, error: "already_removed" });
    expect(
      await prisma.auditEvent.count({ where: { subject: `ProductQuestion:${id}` } }),
    ).toBe(1);
  });
});

describe("two answers to one question", () => {
  it("keeps the first, and refuses the one that arrived second", async () => {
    const id = await ask("Do you ship to Al Ain?");
    const seats = await prisma.user.findMany({
      where: { businessId },
      orderBy: { id: "asc" },
      take: 1,
      select: { id: true },
    });
    const by = seats[0]?.id ?? opsLeads[0]!;

    const results = await Promise.all([
      answerQuestion({ businessId, questionId: id, answer: "Yes, twice a week.", answeredBy: by }),
      answerQuestion({ businessId, questionId: id, answer: "No, collection only.", answeredBy: by }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "already_answered" }]);
    const row = await prisma.productQuestion.findUniqueOrThrow({
      where: { id },
      select: { answer: true },
    });
    // The answer on the page is the one that was accepted, not the one that
    // was refused and wrote anyway.
    expect(row.answer).toBe(results[0]!.ok ? "Yes, twice a week." : "No, collection only.");
  });

  it("never lands an answer on a question already taken down", async () => {
    for (let round = 0; round < 4; round += 1) {
      const id = await ask(`Round ${round}: what is the lead time?`);
      const [answered] = await Promise.all([
        answerQuestion({ businessId, questionId: id, answer: "Ten days.", answeredBy: opsLeads[0]! }),
        removeQuestion({ actor: actor(opsLeads[1]!, "staff_ops_lead"), questionId: id, reason: REASON_A }),
      ]);
      const row = await prisma.productQuestion.findUniqueOrThrow({
        where: { id },
        select: { answeredAt: true, removedAt: true },
      });
      if (answered.ok) {
        // It may be answered and then removed. It may not be removed and then answered.
        expect(row.answeredAt).not.toBeNull();
        if (row.removedAt) expect(row.answeredAt!.getTime()).toBeLessThanOrEqual(row.removedAt.getTime());
      } else {
        expect(answered).toEqual({ ok: false, error: "removed" });
        expect(row.answeredAt).toBeNull();
      }
    }
  });
});
