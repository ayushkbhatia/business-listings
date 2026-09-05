import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Boards 10b and 6d — one published guide.
 *
 * One, not twenty-two. The rest are content and belong in the admin editor,
 * where writing one costs a revalidation instead of a deploy. This one exists
 * so `pnpm db:seed` produces a demonstrable checkpoint: an article that renders,
 * carries `Article` structured data, and ends in the directory.
 *
 * Everything it claims is true of the system it describes. The five rungs are
 * `components/domain/verification.ts`; the expiry rule and the staff-only write
 * are `CLAUDE.md` non-negotiable 2; the response time is measured, never
 * claimed, which is non-negotiable 6.
 */

const BLOCKS = [
  {
    id: "g1-intro",
    kind: "text",
    values: {
      body: "Every directory in this market says its suppliers are verified. Almost none of them say what was checked, when, or by whom. This page says all three, because a badge that does not is decoration.",
    },
  },
  {
    id: "g1-h-ladder",
    kind: "heading",
    values: { text: "Five rungs, and what each one means" },
  },
  {
    id: "g1-ladder",
    kind: "steps",
    values: {
      items: [
        "Not verified. Nothing on the listing has been checked by us. Most listings start here, because most are imported from public licence records before anybody claims them.",
        "Licence on file. A trade licence number has been recorded against the business. Recorded is not checked: at this rung we have a number and nothing else.",
        "Licence verified. The trade licence has been checked against the issuing authority — DED, or the relevant free zone. This is the first rung that counts as verified anywhere on the site.",
        "Audited. Trading history and buyer outcomes checked by us — enquiries answered, quotes sent, reply times. All of it measured rather than claimed, which is what a top rung has to be. The smallest group on the platform by a wide margin.",
      ],
    },
  },
  {
    id: "g1-h-expiry",
    kind: "heading",
    values: { text: "A badge can go down as well as up" },
  },
  {
    id: "g1-expiry",
    kind: "text",
    values: {
      body: "A UAE trade licence is renewed annually. On the day one expires, that supplier's tier drops to licence verified, with no grace period and no warning shot. It goes back up when the renewed licence is checked. This is the part that most directories skip, and it is the reason a badge with a date on it is worth more than a badge without one: an unchecked claim from 2019 is not a claim about today.",
    },
  },
  {
    id: "g1-h-who",
    kind: "heading",
    values: { text: "Suppliers cannot set their own tier" },
  },
  {
    id: "g1-who",
    kind: "text",
    values: {
      body: "There is no field in the seller dashboard that changes a verification tier, no setting behind a plan, and no API path to it. Only our operations lead can move one, and every move writes an audit row with a written reason attached to the person who made it. A supplier on a paid plan and a supplier on the free tier are checked the same way, and the badge renders identically on both.",
    },
  },
  {
    id: "g1-callout",
    kind: "callout",
    values: {
      label: "What verification is not",
      body: "It is not a guarantee of quality, price or delivery. It is a check that the business is licensed to trade in what it says it trades in, and in some cases that we have stood in the building. Read the reviews for the rest — they come only from buyers who sent an enquiry through the platform.",
    },
  },
  {
    id: "g1-h-use",
    kind: "heading",
    values: { text: "How to use it when you are choosing" },
  },
  {
    id: "g1-use",
    kind: "list",
    values: {
      items: [
        "Filter to verified suppliers when the order matters more than the price. It removes the listings nobody has checked.",
        "Read the date on the badge, not only its colour. A licence checked last month says more than one checked three years ago.",
        "Check the response time beside it. That number is measured from real enquiries and their first replies, and no supplier can edit it.",
        "Send the same requirement to several suppliers at once. Comparing three quotes tells you more about a fair price than any badge can.",
      ],
    },
  },
  {
    id: "g1-cta",
    kind: "cta",
    values: {
      body: "Every supplier on this directory carries a badge that says what was checked and when. Start with the trade you need, or describe the requirement and let suppliers come to you.",
    },
  },
] as const;

export async function seedGuides(db: PrismaClient) {
  const industrial = await db.category.findFirst({
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  await db.guide.create({
    data: {
      slug: "what-supplier-verification-actually-proves",
      title: "What supplier verification actually proves",
      summary:
        "Five rungs, what each one checks, and why a badge without a date on it is decoration.",
      byline: null,
      ctaCategoryId: industrial?.id ?? null,
      body: BLOCKS as unknown as object,
      publishedAt: new Date(Date.UTC(2026, 7, 20)),
    },
  });
}
