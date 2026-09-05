import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Boards 10b and 6d — two published guides.
 *
 * Two, not twenty-two. The rest are content and belong in the admin editor,
 * where writing one costs a revalidation instead of a deploy. These two exist
 * so `pnpm db:seed` produces a demonstrable checkpoint: articles that render,
 * carry `Article` structured data, link into the directory from the body, and
 * point at each other from the related rail.
 *
 * Two rather than one because board 6d's rail needs somewhere to point, and
 * because §6 makes that pointing load-bearing: *"A guide that covers a section
 * this article does not must appear here."* One article cannot demonstrate the
 * rule that two of our own pages never target the same query.
 *
 * Everything they claim is true of the system they describe. The rungs are
 * `components/domain/verification.ts`; the expiry rule and the staff-only write
 * are `CLAUDE.md` non-negotiable 2; the response time is measured, never
 * claimed, which is non-negotiable 6.
 *
 * The ladder said "five rungs" here over a list of four for as long as the
 * withdrawn site-visit rung had been gone. Fixed: the heading counts what the
 * list contains.
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
    values: { text: "Four rungs, and what each one means" },
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

/**
 * Board 6d's own article — `/guides/check-a-uae-trade-licence`.
 *
 * Four `h2`s, which is what the contents rail is built from. The board carried
 * a hand-written list of six against three headings; the rail is derived now,
 * so the two cannot disagree.
 *
 * The last section is the load-bearing one. It is the only place on the public
 * site where the verification badge is defined in prose rather than shown as a
 * pill, and buyers reach it from a search engine rather than from a listing —
 * so if it overstates the badge, every listing on the site inherits the
 * overstatement.
 *
 * **The board's version overstated it.** It read "any business on this site
 * carrying a green badge has had all of the above done by our team", and all of
 * the above includes step 4, the TRN. The TRN is a separate tier in the
 * verification model, and a licence-verified supplier may not be VAT-registered
 * at all. A buyer who read that and skipped step 4 would have been relying on a
 * check we never made, on the page teaching them to make it. Scoped to steps 1
 * to 3 here, with step 4 called out in its own paragraph.
 */
const LICENCE_BLOCKS = [
  {
    id: "g2-intro",
    kind: "text",
    values: {
      body: "A trade licence is the one document that tells you whether the company you are about to pay exists, what it is allowed to sell you, and who is behind it. Checking one takes about ten minutes and costs nothing. Most supplier problems in this market start with somebody skipping that ten minutes.",
    },
  },
  {
    id: "g2-h-what",
    kind: "heading",
    values: { text: "What a trade licence actually tells you" },
  },
  {
    id: "g2-what",
    kind: "text",
    values: {
      body: "Four things, and only one of them is the company name. The licence number is the identifier every authority indexes on, and it is what you search rather than the trading name. The activities are the list of things the company is licensed to do — a company licensed for general trading cannot lawfully sign you a fire-rated ducting installation, whatever the quotation says. The expiry date tells you whether any of it is current, because a UAE licence is renewed annually and an expired one is not a licence. And the legal name is what will appear on the invoice and on any contract, which is rarely the name on the website.",
    },
  },
  {
    id: "g2-what-2",
    kind: "text",
    values: {
      body: "The activities line is the one buyers skip and the one that costs most. It is written in the authority's own vocabulary rather than the trade's, so it will say something like \"building materials trading\" where the supplier calls themselves a ducting fabricator. That is normal. What is not normal is an activity list that has nothing to do with what you are buying — a company licensed only for foodstuff trading quoting you chillers is either using somebody else's licence or is about to subcontract the whole job to a company you have not checked.",
    },
  },
  {
    id: "g2-quote",
    kind: "quote",
    values: {
      body: "The name on the website, the name on the quotation and the name on the licence are three different strings surprisingly often. The one that matters is the one on the licence, because that is the one a court reads.",
    },
  },
  {
    id: "g2-what-3",
    kind: "text",
    values: {
      body: "Free zone and mainland licences are issued by different bodies and are worth telling apart, because the difference decides who may invoice you and how. A mainland licence comes from the emirate's Department of Economy and Development and lets the company trade anywhere in the country. A free zone licence comes from the zone's own authority and is normally limited to the zone and to exports, which is why a free zone supplier selling onto the mainland often invoices through a mainland branch or a local distributor. Neither is better. What matters is that the entity quoting you is licensed to sell you the thing, in the place you want it delivered.",
    },
  },
  {
    id: "g2-h-how",
    kind: "heading",
    values: { text: "How to check it, in four steps" },
  },
  {
    id: "g2-steps",
    kind: "steps",
    values: {
      items: [
        "Ask for the licence itself, not the number. A PDF or a photograph of the document takes a supplier ten seconds to send and shows you the activities and the expiry date, which a number on its own does not. A supplier who will not send it is telling you something.",
        "Check it against the issuing authority. Mainland licences are issued by the emirate's Department of Economy and Development; a free zone company is issued by its own authority — JAFZA, DMCC, SAIF and the rest each run their own register. The licence names its issuer, and each of them publishes a way to confirm a number belongs to the company claiming it.",
        "Match the legal name. The name on the licence is the entity you are contracting with, and it will often differ from the trading name on the quotation by an LLC, an FZE, or entirely. If they do not match, ask why before you ask about price — the answer is usually a group structure and occasionally something else.",
        "Check the TRN separately, if you need a VAT invoice. The tax registration number is a different register and a different check. Not every licensed company is VAT-registered, and a company that is not cannot issue you a valid VAT invoice however good its licence is.",
      ],
    },
  },
  {
    id: "g2-h-flags",
    kind: "heading",
    values: { text: "Three things worth walking away from" },
  },
  {
    id: "g2-flags",
    kind: "list",
    values: {
      items: [
        "A licence that expires inside your delivery window. A renewal is routine, but a company whose licence lapses mid-project cannot invoice you, cannot clear goods and cannot sue or be sued in the ordinary way until it is renewed.",
        "An activity list that does not cover the work. This is the one that reaches you months later, when a fire-rated installation cannot be signed off because the contractor was never licensed to do it.",
        "A bank account in a name that is not the licensed entity. There are legitimate reasons for a group treasury account, and there are illegitimate reasons that look identical from the outside. Ask for the reason in writing.",
      ],
    },
  },
  {
    id: "g2-flags-note",
    kind: "text",
    values: {
      body: "None of these is proof of anything on its own. All three are reasons to ask a question, and a supplier who answers all three plainly is usually a supplier worth having. If you would rather start from companies whose licences have already been checked, the [directory of licensed suppliers](/categories) is the shortcut — and if you know the trade and the area, an area page like [HVAC in Al Quoz](/dubai/al-quoz-industrial-1/hvac-and-ventilation) lists who is there.",
    },
  },
  {
    id: "g2-h-badge",
    kind: "heading",
    values: { text: "What our own badge covers, and what it does not" },
  },
  {
    id: "g2-badge",
    kind: "text",
    values: {
      body: "A supplier on this site carrying a verified badge has had steps 1 to 3 above done by us: we hold the licence document, we have checked the number against the issuing authority, and we have matched the legal name to the listing. The badge carries the date we did it, and that date is the point of it — a check from three years ago and a check from last month are different claims, and a badge that does not say which is decoration.",
    },
  },
  {
    id: "g2-badge-trn",
    kind: "text",
    values: {
      body: "Step 4 is not part of it. We do not verify tax registration as part of licence verification — it is a separate register and a separate rung in our verification model, and a licensed supplier may not be VAT-registered at all. If you need a valid VAT invoice, ask for the TRN and check it yourself. We would rather tell you that than let you skip a step because of a badge we put on the page.",
    },
  },
  {
    id: "g2-badge-expiry",
    kind: "text",
    values: {
      body: "The badge is also removed when the licence lapses. UAE licences renew annually, so verification is a claim with a shelf life: a nightly job reads the expiry date captured when we checked, and on the day it passes the supplier drops below the verified rung across the whole site — the badge, the filters, the counts and the curated lists all move together. It goes back up when somebody has read the renewed licence, which is a decision with a person attached to it rather than something that happens automatically.",
    },
  },
  {
    id: "g2-badge-sale",
    kind: "text",
    values: {
      body: "None of it is for sale, which is the part worth saying plainly on a page a supplier might also be reading. There is no field in the seller dashboard that changes a verification tier, no setting behind a subscription, and no API path to one. A supplier on the most expensive plan and a supplier on the free tier are checked the same way and the badge renders identically on both — and if that were not true, everything else on this page would be worth nothing. What a paid plan buys is placement in search results, which is labelled where it happens and never here.",
    },
  },
  {
    id: "g2-cta",
    kind: "cta",
    values: {
      body: "You can do all of this yourself on any supplier in the country. If you would rather start from a shorter list, this is a directory of UAE suppliers whose trade licences we have already checked.",
    },
  },
];

export async function seedGuides(db: PrismaClient) {
  const industrial = await db.category.findFirst({
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  /*
     Board 6d Q1 is unanswered — "who is the author?" — and the recommendation
     is a named person with a role, because an anonymous byline on an article
     instructing buyers about licensing and VAT is a rankings cost as well as a
     trust one. Seeded with a name and a role so the strip and the `Person`
     schema are exercised; the real name is an editorial decision.
  */
  const BYLINE = "Rana Habib";
  const BYLINE_ROLE = "Verification lead";

  const ladder = await db.guide.upsert({
    where: { slug: "what-supplier-verification-actually-proves" },
    create: {
      slug: "what-supplier-verification-actually-proves",
      title: "What supplier verification actually proves",
      summary:
        "Four rungs, what each one checks, and why a badge without a date on it is decoration.",
      standfirst:
        "Every directory in this market says its suppliers are verified. Almost none say what was checked, when, or by whom.",
      topic: "Verification",
      byline: BYLINE,
      bylineRole: BYLINE_ROLE,
      ctaCategoryId: industrial?.id ?? null,
      body: BLOCKS as unknown as object,
      publishedAt: new Date(Date.UTC(2026, 7, 20)),
      /*
         §Evergreen. This article names the rungs and the expiry rule, both of
         which are claims about our own system rather than about the world — but
         it also names DED and the free zone authorities, so it earns a cadence.
      */
      regulatoryCheckedAt: new Date(Date.UTC(2026, 7, 20)),
      reviewCadenceMonths: 6,
    },
    update: {
      summary:
        "Four rungs, what each one checks, and why a badge without a date on it is decoration.",
      standfirst:
        "Every directory in this market says its suppliers are verified. Almost none say what was checked, when, or by whom.",
      topic: "Verification",
      byline: BYLINE,
      bylineRole: BYLINE_ROLE,
      body: BLOCKS as unknown as object,
      regulatoryCheckedAt: new Date(Date.UTC(2026, 7, 20)),
      reviewCadenceMonths: 6,
    },
    select: { id: true },
  });

  const licence = await db.guide.upsert({
    where: { slug: "check-a-uae-trade-licence" },
    create: {
      slug: "check-a-uae-trade-licence",
      title: "How to check a UAE trade licence before you pay",
      summary:
        "The four things a licence tells you, how to confirm one with the issuing authority, and what our own badge does and does not cover.",
      standfirst:
        "Checking a trade licence takes about ten minutes and costs nothing. Most supplier problems in this market start with somebody skipping that ten minutes.",
      topic: "Verification",
      byline: BYLINE,
      bylineRole: BYLINE_ROLE,
      ctaCategoryId: industrial?.id ?? null,
      body: LICENCE_BLOCKS as unknown as object,
      publishedAt: new Date(Date.UTC(2026, 7, 4)),
      /*
         The article names a specific authority, a licence renewal cadence and a
         tax register. All three change, and an article with a 2026 date and
         2029 traffic is a liability on a page whose subject is trustworthiness.
      */
      regulatoryCheckedAt: new Date(Date.UTC(2026, 7, 14)),
      reviewCadenceMonths: 6,
    },
    update: {
      title: "How to check a UAE trade licence before you pay",
      standfirst:
        "Checking a trade licence takes about ten minutes and costs nothing. Most supplier problems in this market start with somebody skipping that ten minutes.",
      topic: "Verification",
      byline: BYLINE,
      bylineRole: BYLINE_ROLE,
      body: LICENCE_BLOCKS as unknown as object,
      regulatoryCheckedAt: new Date(Date.UTC(2026, 7, 14)),
      reviewCadenceMonths: 6,
    },
    select: { id: true },
  });

  /*
     §6, and the rule that makes the rail load-bearing: a guide that covers a
     section this article does not must appear here, because two of our own
     pages must never target one query.

     These two are exactly that pair. The licence article explains how to check
     one and deliberately does not re-explain the rungs; the ladder article does
     the rungs and does not repeat the how-to. Each points at the other.
  */
  await db.guideRelated.deleteMany({ where: { fromId: { in: [ladder.id, licence.id] } } });
  await db.guideRelated.create({
    data: { fromId: licence.id, toId: ladder.id, position: 0 },
  });
  await db.guideRelated.create({
    data: { fromId: ladder.id, toId: licence.id, position: 0 },
  });

  console.log("   check-a-uae-trade-licence, what-supplier-verification-actually-proves");
}
