import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Boards 10i and 10j — one campaign landing and the four policies.
 *
 * One campaign, not several: the page is a template and a second one proves
 * nothing the first does not. The four policies are all four, because the
 * footer links to every one of them from every page on the site and three
 * working links beside a 404 is worse than none.
 *
 * The wording below is real enough to read and deliberately not legal advice —
 * it says what the product actually does, which is the only thing anybody here
 * can write honestly.
 */

const CAMPAIGN_BODY = `
Most industrial buyers in the UAE find suppliers the same way: a name from a colleague, a
number from a WhatsApp group, and a hope that whoever picks up has the part. That works until
the part is specific, the site is waiting, and the two suppliers you know are both out of
stock.

This directory exists for that afternoon. Search by what you actually need — a nominal
diameter, a pressure rating, a standard — and see which suppliers hold it, where their counter
is, and how quickly they have answered other buyers. Then send one requirement to up to eight
of them and let them come back to you.

Two things are worth knowing before you start. We never show a price, because a price that is
not against your quantity and your delivery date is a number that wastes everybody's time —
suppliers quote you directly and we never see what they charge. And the verified badge means
we checked the trade licence against the issuing authority ourselves, on a date the badge
shows you; it is not a rating, it is not sold, and it renders the same on every listing.

There is no account needed to search, and none to send an enquiry.
`.trim();

const POLICIES = [
  {
    kind: "terms" as const,
    title: "Terms of use",
    effectiveFrom: new Date(Date.UTC(2026, 0, 15)),
    body: `
These terms cover the use of Business Listings by buyers and by suppliers. They are written to
be read rather than to be survived, and they say what we actually do.

**What this platform is.** A directory of licensed UAE businesses, and a way to send one
requirement to several of them at once. Buyers find suppliers, send enquiries, and receive
quotes. That is the whole of it.

**What this platform is not.** We are not a party to any transaction between a buyer and a
supplier. There is no cart, no checkout, no order, no payment we take or hold, no delivery we
arrange and no return we process. When you accept a quote, you are agreeing something with
that supplier directly, on terms the two of you set. We hold no funds and therefore cannot
refund any.

**Prices.** No price is ever shown on a public page. Prices exist only inside a quote, which
is private to the buyer who asked and the supplier who sent it. We do not see what a supplier
charges and we take no percentage of anything.

**Contact details.** A buyer's contact details are released to exactly one supplier — the one
whose quote they accept — and to nobody else, at no earlier point.

**Accuracy.** Much of what is on an unclaimed listing comes from the public trade licence
record and has not been confirmed by the business. Where we have checked something ourselves,
the badge says what we checked and when. Everything else is the supplier's own description.

**Suspension.** We may suspend a listing that misrepresents what it sells, that cannot produce
a valid trade licence, or that abuses the enquiry system. Every suspension is recorded with a
written reason.
`.trim(),
  },
  {
    kind: "privacy" as const,
    title: "Privacy",
    effectiveFrom: new Date(Date.UTC(2026, 0, 15)),
    body: `
This says what we collect, why, and what we do not do with it. It is written against the UAE
Personal Data Protection Law.

**Buyers.** To send an enquiry we need a way for suppliers to reach you: a name and a phone
number or an email address. We keep the enquiry, the quotes sent against it, and the messages
exchanged, because that is the record of what was agreed. Your contact details go to exactly
one supplier — the one whose quote you accept.

**Suppliers.** A claimed listing carries what the business chose to publish, plus what we
checked ourselves. Response times are computed from real enquiry and reply timestamps; there
is no field a supplier can type one into.

**Attribution.** If you arrive through a tagged link we store the three values that link
declared — the source, the medium and the campaign name — in a first-party cookie for thirty
days, and attach them to an enquiry if you send one. It contains nothing about you, it is not
readable by anything in your browser, and it is not shared with anybody.

**What we do not do.** We do not sell personal data. We do not run third-party advertising
trackers on this site. We do not build profiles of buyers for suppliers to browse.

**Your rights.** You can ask what we hold about you, ask for it to be corrected, and ask for
it to be deleted. Where deleting would destroy a record another party relies on — an accepted
quote, for instance — we will say so and explain what can be removed instead.
`.trim(),
  },
  {
    kind: "verification_policy" as const,
    title: "Verification policy",
    effectiveFrom: new Date(Date.UTC(2026, 2, 1)),
    body: `
A badge that does not say what was checked is decoration. This says exactly what each rung
means and who can move one.

**Not verified.** Nothing on the listing has been checked by us. Most listings start here,
because most are imported from public licence records before anybody claims them.

**Licence on file.** A trade licence number has been recorded. Recorded is not checked.

**Licence verified.** The trade licence has been checked against the issuing authority — the
relevant DED or free zone. This is the first rung that counts as verified anywhere on the
site, in a filter, in a count, or on a curated list.

**Site visited.** Somebody from our field team has been to the premises. The badge carries the
date of the visit, not the date of the licence check.

**Audited.** Premises visited and trading history audited. The smallest group by a wide
margin.

**Expiry.** A UAE trade licence is renewed annually. On the day one expires, that supplier's
tier drops to licence verified — no grace period, no warning. It goes back up when the renewed
licence is checked.

**Who can move a tier.** Only our operations lead. There is no field in the seller dashboard,
no setting behind a subscription, and no API path. Every change writes an audit record with a
written reason against the person who made it. A supplier on a paid plan and one on the free
tier are checked identically, and the badge renders identically on both.

**What verification is not.** It is not a guarantee of quality, price or delivery, and it is
never sold.
`.trim(),
  },
  {
    kind: "review_policy" as const,
    title: "Review policy",
    effectiveFrom: new Date(Date.UTC(2026, 2, 1)),
    body: `
A review system that anybody can post to is a review system nobody can use. This says who can
write one, what happens to it, and when we remove one.

**Who can write a review.** Only a buyer who sent an enquiry through this platform, and only
about a supplier who received it. One review per enquiry. There is no way to post a review
without an enquiry behind it, which is why there is no way to buy one.

**Editing.** A buyer can edit their review for fourteen days. After that it stands.

**Supplier replies.** A supplier may reply once, publicly, and cannot edit or delete the reply
afterwards. They cannot delete the review, and they cannot ask us to.

**Removal.** We remove a review only where it identifies a person, contains contact details,
is about something other than the transaction, or is demonstrably not from the buyer it claims
to be. Every removal is recorded with a written reason, and a removed review is gone from every
public surface rather than shown struck through — it is not counted in any average or any
total.

**What a paid subscription does not buy.** It does not remove a review, hide one, reorder them,
or exclude a supplier from a list. Nobody at this company can be paid to take a review down.
`.trim(),
  },
];

export async function seedCampaignLegal(db: PrismaClient) {
  const category = await db.category.findUnique({
    where: { slug: "hvac-and-ventilation" },
    select: { id: true },
  });

  await db.campaign.upsert({
    where: { slug: "find-a-supplier" },
    create: {
      slug: "find-a-supplier",
      headline: "Find a supplier who actually has it",
      standfirst:
        "Search licensed UAE suppliers by specification, see what we have checked about each one, and send one requirement to up to eight of them.",
      body: CAMPAIGN_BODY,
      metaTitle: "Find UAE industrial suppliers by specification",
      metaDescription:
        "Search licensed UAE suppliers by nominal diameter, pressure rating or standard. No account needed, and no price until a supplier quotes you directly.",
      ctaCategoryId: category?.id ?? null,
      publishedAt: new Date(Date.UTC(2026, 6, 10)),
    },
    update: { body: CAMPAIGN_BODY, publishedAt: new Date(Date.UTC(2026, 6, 10)) },
  });

  for (const policy of POLICIES) {
    await db.legalPage.upsert({
      where: { kind: policy.kind },
      create: policy,
      update: { title: policy.title, body: policy.body, effectiveFrom: policy.effectiveFrom },
    });
  }

  console.log(`   find-a-supplier: published · ${POLICIES.length} policies`);
}
