import "server-only";
import { prisma } from "@/lib/db/client";
import { atMonthlyCap, MAX_RECIPIENTS, monthStart } from "@/lib/enquiry/fanout";
import type { ListMember } from "./read";

/**
 * Board 6b §4 — which eight, and the promise the board could not keep.
 *
 * The board read **"Send one RFQ to all 12"**. The fan-out cap is **8, hard**,
 * and `1h` states it on screen — acceptance 6, capped at 8 and floored at 1.
 * This is the same error that removed "Post an RFQ to 1,842" from `1b`'s
 * category header: a button promising what the engine cannot do.
 *
 * ## Which eight, and why the card can say so
 *
 * `1h` orders recipients by verification tier, then measured reply time, then
 * spec-match completeness. Every member of a curated list is licence verified by
 * construction — it is a required criterion — so **tier cannot discriminate**
 * and the effective order is reply time. That is why the card is allowed to name
 * the rule: on this page, and only on this page, it is the whole rule.
 *
 * Reply time from the **snapshot**, not live. Everything the reader sees on this
 * page is the snapshot (acceptance 5), and a card that ordered by a live figure
 * would name an order the metric strips above it contradict.
 *
 * ## Open question 4, answered the cheap way
 *
 * `1h` excludes a free-plan seller at their monthly cap from the recipient list
 * entirely — `selectRecipients` skips them *even if pinned*, on the grounds that
 * a seller who cannot reply costs the buyer a slot. So the eight who receive an
 * RFQ may not be the eight this card names.
 *
 * The spec offers two ways out: exempt curated members from the cap, or stop the
 * card naming a rule the engine can override. **The second**, because the first
 * is a commercial decision — it turns list membership into a plan benefit — and
 * because `fanout.ts`'s reasoning applies here too: a capped seller on this
 * enquiry is a wasted slot for the buyer, list or no list.
 *
 * So this function returns the eight fastest **who can take an enquiry this
 * month**, and `t("best.rfq_rule")` says exactly that. The card names a rule the
 * engine actually follows. If the exemption is ever wanted it is a change here
 * and one string, not a redesign.
 */

export interface RfqSelection {
  /** At most `MAX_RECIPIENTS`. Ordered as `1h` will order them. */
  recipients: ListMember[];
  /** Members who did not make the cut, offered as swaps in the composer. */
  remainder: ListMember[];
  /** How many were held back by their own monthly cap rather than by the cap of 8. */
  atCap: number;
}

/**
 * Who the RFQ shortcut sends to.
 *
 * The one live query on the reader's path, and live for a reason the spec
 * names: `1h`'s free-plan cap rule is live, so a set computed from a snapshot
 * would offer recipients the composer is about to drop.
 */
export async function rfqRecipients(
  members: readonly ListMember[],
  now = new Date(),
): Promise<RfqSelection> {
  if (members.length === 0) return { recipients: [], remainder: [], atCap: 0 };

  /*
     The cap, from `fanout.ts`'s own predicate and its own month boundary.

     Not re-derived. `atMonthlyCap` is two comparisons and it would have been
     three lines to inline them — and then the composer's definition of "at cap"
     and this card's would be two definitions, agreeing until one of them
     changed. `monthStart` matters for the same reason: it resets in Asia/Dubai,
     not UTC, and a card that counted a different month would name a different
     eight on the last day of one.
  */
  const since = monthStart(now);

  const rows = await prisma.business.findMany({
    where: { id: { in: members.map((member) => member.businessId) } },
    select: {
      id: true,
      plan: { select: { enquiriesPerMonth: true } },
      // The month's load, which is what the cap counts — the same filter
      // `findFanoutCandidates` uses.
      _count: { select: { recipients: { where: { createdAt: { gte: since } } } } },
    },
  });

  const capped = new Set<string>();
  for (const row of rows) {
    const at = atMonthlyCap({
      enquiriesPerMonth: row.plan?.enquiriesPerMonth ?? null,
      enquiriesThisMonth: row._count.recipients,
    });
    if (at) capped.add(row.id);
  }

  /*
     Fastest first, from the snapshot. Ties broken on slug so two renders of one
     page name the same eight — a card that reshuffled between requests would be
     describing a rule it does not follow.
  */
  const eligible = members
    .filter((member) => !capped.has(member.businessId))
    .sort(
      (a, b) =>
        a.responseTimeMedianMs - b.responseTimeMedianMs || a.slug.localeCompare(b.slug),
    );

  const recipients = eligible.slice(0, MAX_RECIPIENTS);
  const chosen = new Set(recipients.map((member) => member.businessId));

  return {
    recipients,
    /*
       §4: *"A member excluded by the cap must not be silently dropped — the
       composer shows the four remaining as unselected rows the buyer can swap
       in."* Everybody who is not a recipient, in editorial order, including the
       capped ones — the buyer swapping one in is the composer's decision to
       refuse, not this page's decision to hide.
    */
    remainder: members.filter((member) => !chosen.has(member.businessId)),
    atCap: capped.size,
  };
}
