import type { PrismaClient } from "../lib/db/generated/client.js";
import type { Authority, BillingTerm, CancelReason } from "../lib/db/generated/enums.js";
import { monthlyValueFils } from "../lib/billing/period.js";

/**
 * Board 4g — a last month the revenue board can say something true about.
 *
 * The rest of the seed writes an MRR ledger of signups, one expansion and two
 * churned accounts at random dates. On most days the last closed month holds
 * none of them, so the board would open on a waterfall of zeros, a reasons panel
 * with nothing in it, no failed payment and no placement — every state the
 * handoff draws, and only the empty one reachable.
 *
 * So eleven accounts, each doing one thing in the month before `now`, written
 * the way the services write them: the movement with its cause, the scheduled
 * change it carried out, the subscription row it left behind. The ledger has to
 * reconcile against the live subscription table when the seed ends, and
 * `assertLedgerReconciles` in seed.mts refuses to finish if it does not.
 *
 * | Account                    | Emirate  | In the month                                  |
 * |----------------------------|----------|-----------------------------------------------|
 * | Gulf Cranes Rental         | AD       | New on Pro                                    |
 * | Marina Facade Cleaning     | Dubai    | Basic to Pro, and a sponsored slot ending     |
 * | Pallet Works Ajman         | Ajman    | Scheduled downgrade, Pro to Basic             |
 * | Hatta Cold Stores          | Dubai    | Pro monthly to annual                         |
 * | Fujairah Marine Supplies   | Fujairah | Cancelled: not enough enquiries, 2 of 9 replied |
 * | Sharjah Pipe Traders       | Sharjah  | Cancelled: not enough enquiries, 1 of 7 replied |
 * | Oasis Date Packers         | AD       | Cancelled: not enough enquiries, 5 of 6 replied |
 * | RAK Stone Cutters          | RAK      | Cancelled: too expensive                      |
 * | Dubai Signage Hub          | Dubai    | Cancelled: another platform                   |
 * | Umm Al Quwain Boatyard     | UAQ      | Lapsed after 14 days of failed payments       |
 * | Jebel Ali Forwarding       | Dubai    | Card failed on the 27th, paid on the 1st, a slot |
 *
 * Two of the three *not enough enquiries* accounts were under 50% when they
 * asked, so the board's cross-reference reads 2 of 3 — measured from their
 * enquiries by `measureReplies`, not assigned.
 *
 * New businesses, never repurposed ones, not published, so no public page or
 * search result gains a row. **No slug or name starts before `al-b`:** several
 * suites take "the first claimed business by slug" as their fixture, and an
 * `ajman-…` or `al-ain-…` here became that business and failed two of them. Runs before
 * `backfillSeatChannels` so their owners get a verified channel like every
 * other claimed seller's, and before `recomputeDerived`, which measures them.
 */

type Db = PrismaClient;

const DAY = 86_400_000;

type PlanId = "basic" | "pro";

interface Fixture {
  slug: string;
  displayName: string;
  authority: Authority;
  licenceNumber: string;
}

/** Noon in Dubai on `day` of the month `monthsBack` before the one `now` is in. */
function dubai(now: Date, monthsBack: number, day: number, hour = 12): Date {
  const shifted = new Date(now.getTime() + 4 * 3_600_000);
  const base = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - monthsBack, 1));
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  return new Date(`${y}-${m}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+04:00`);
}

export async function seedRevenue(db: Db, now: Date): Promise<void> {
  console.log("→ last month's revenue, for board 4g");

  const plans = new Map(
    (await db.plan.findMany({ select: { id: true, monthlyPriceAed: true, annualMonthsCharged: true } })).map((plan) => [
      plan.id,
      { monthlyPriceAed: Number(plan.monthlyPriceAed), annualMonthsCharged: plan.annualMonthsCharged },
    ]),
  );
  const value = (planId: PlanId, term: BillingTerm = "monthly") => monthlyValueFils(plans.get(planId)!, term);

  /** Day `d` of last month, and of the months before it. */
  const last = (d: number, hour = 12) => dubai(now, 1, d, hour);
  const back = (months: number, d: number) => dubai(now, 1 + months, d);
  const thisMonthStart = dubai(now, 0, 1, 0);

  const buyer = await db.user.create({
    data: {
      id: "00000000-0000-4000-8500-000000000100",
      email: "procurement@revenue-fixture.example",
      fullName: "Revenue Fixture Buyer",
      roles: ["buyer"],
    },
    select: { id: true },
  });

  const categories = await db.category.findMany({
    where: { parentId: { not: null }, placements: { none: {} } },
    orderBy: { id: "asc" },
    take: 3,
    select: { id: true },
  });
  const category = categories[0]!;

  let seat = 0;
  let enquiryRef = 0;

  async function account(fixture: Fixture, planId: PlanId | "free", startedAt: Date) {
    seat += 1;
    const business = await db.business.create({
      data: {
        tradeName: fixture.displayName,
        displayName: fixture.displayName,
        slug: fixture.slug,
        licenceNumber: fixture.licenceNumber,
        licenceAuthority: fixture.authority,
        licenceExpiry: new Date(now.getTime() + 300 * DAY),
        primaryCategoryId: category.id,
        claimStatus: "claimed",
        verificationTier: 1,
        verifiedAt: new Date(startedAt.getTime() - 20 * DAY),
        planId,
        sellsKind: "goods",
      },
      select: { id: true },
    });
    const owner = await db.user.create({
      data: {
        id: `00000000-0000-4000-8500-${String(seat).padStart(12, "0")}`,
        email: `owner.${fixture.slug}@revenue-fixture.example`,
        fullName: `${fixture.displayName.split(" ")[0]} Owner`,
        roles: ["seller_owner"],
        businessId: business.id,
      },
      select: { id: true },
    });
    return { businessId: business.id, ownerId: owner.id };
  }

  async function signup(businessId: string, planId: PlanId, at: Date) {
    await db.mrrMovement.create({
      data: {
        businessId,
        kind: "new_business",
        cause: "plan_change",
        toPlanId: planId,
        deltaFils: value(planId),
        mrrAfterFils: value(planId),
        occurredAt: at,
        note: "Signed up",
      },
    });
  }

  async function live(businessId: string, planId: PlanId, startedAt: Date, term: BillingTerm = "monthly") {
    return db.subscription.create({
      data: {
        businessId,
        planId,
        status: "active",
        term,
        startedAt,
        periodStartedAt: new Date(now.getTime() - 18 * DAY),
        renewsAt: new Date(now.getTime() + 12 * DAY),
      },
      select: { id: true },
    });
  }

  /**
   * Enquiries delivered in the 90 days before `askedAt`, every one closed
   * before it, the first `answered` of them replied to.
   */
  async function replyHistory(businessId: string, ownerId: string, askedAt: Date, total: number, answered: number) {
    for (let j = 0; j < total; j += 1) {
      const deliveredAt = new Date(askedAt.getTime() - (80 - j * 8) * DAY);
      enquiryRef += 1;
      const enquiry = await db.enquiry.create({
        data: {
          ref: `ENQ-4G${String(enquiryRef).padStart(3, "0")}`,
          buyerId: buyer.id,
          requirement: "Historical enquiry for the revenue fixtures.",
          closesAt: new Date(deliveredAt.getTime() + 5 * DAY),
          createdAt: deliveredAt,
          lines: { create: [{ description: "Assorted supplies", qty: 10, sortOrder: 0 }] },
        },
        select: { id: true },
      });
      const repliedAt = j < answered ? new Date(deliveredAt.getTime() + 2 * 3_600_000) : null;
      await db.enquiryRecipient.create({
        data: {
          enquiryId: enquiry.id,
          businessId,
          state: repliedAt ? "quoted" : "delivered",
          createdAt: deliveredAt,
          openedAt: new Date(deliveredAt.getTime() + 30 * 60_000),
          firstReplyAt: repliedAt,
        },
      });
      if (repliedAt) {
        await db.message.create({
          data: { enquiryId: enquiry.id, businessId, senderId: ownerId, authorSide: "seller", body: "Thanks — our quote follows.", createdAt: repliedAt },
        });
      }
    }
  }

  async function cancelled(
    fixture: Fixture,
    planId: PlanId,
    startedAt: Date,
    effectiveAt: Date,
    askedDaysBefore: number,
    reason: CancelReason,
    history?: { total: number; answered: number },
  ) {
    const { businessId, ownerId } = await account(fixture, "free", startedAt);
    await signup(businessId, planId, startedAt);
    const askedAt = new Date(effectiveAt.getTime() - askedDaysBefore * DAY);
    const change = await db.subscriptionChange.create({
      data: {
        businessId,
        kind: "cancellation",
        fromPlanId: planId,
        toPlanId: "free",
        fromTerm: "monthly",
        toTerm: "monthly",
        effectiveAt,
        cancelReason: reason,
        requestedById: ownerId,
        createdAt: askedAt,
        appliedAt: effectiveAt,
      },
      select: { id: true },
    });
    // What `applyEndedCancellations` leaves: cancelled, on Free, the pair cleared.
    await db.subscription.create({
      data: {
        businessId,
        planId: "free",
        status: "cancelled",
        startedAt,
        periodStartedAt: new Date(effectiveAt.getTime() - 30 * DAY),
        renewsAt: effectiveAt,
      },
    });
    await db.mrrMovement.create({
      data: {
        businessId,
        kind: "churn",
        cause: "cancellation",
        subscriptionChangeId: change.id,
        fromPlanId: planId,
        toPlanId: "free",
        deltaFils: -value(planId),
        mrrAfterFils: 0,
        occurredAt: effectiveAt,
        note: "Cancellation reached its end date",
      },
    });
    if (history) await replyHistory(businessId, ownerId, askedAt, history.total, history.answered);
  }

  // ── Growth ────────────────────────────────────────────────────────────────

  {
    const { businessId } = await account(
      { slug: "gulf-cranes-rental", displayName: "Gulf Cranes Rental", authority: "ADDED", licenceNumber: "ADDED-770114" },
      "pro",
      last(6),
    );
    await signup(businessId, "pro", last(6));
    await live(businessId, "pro", last(6));
  }

  {
    const startedAt = back(4, 3);
    const { businessId } = await account(
      { slug: "marina-facade-cleaning", displayName: "Marina Facade Cleaning", authority: "DED", licenceNumber: "DED-612087" },
      "pro",
      startedAt,
    );
    await signup(businessId, "basic", startedAt);
    await db.mrrMovement.create({
      data: {
        businessId,
        kind: "expansion",
        cause: "plan_change",
        fromPlanId: "basic",
        toPlanId: "pro",
        deltaFils: value("pro") - value("basic"),
        mrrAfterFils: value("pro"),
        occurredAt: last(12),
        note: "Plan change to Pro",
      },
    });
    await live(businessId, "pro", startedAt);
    // Sold on the 20th of the month before for its thirty-day term, and not
    // renewed: with no live gateway, nothing renews a slot.
    const slotStart = back(1, 20);
    await db.placementSlot.create({
      data: {
        businessId,
        categoryId: category.id,
        monthlyPriceAed: 450,
        startsOn: slotStart,
        endsOn: new Date(slotStart.getTime() + 30 * DAY),
      },
    });
  }

  {
    const startedAt = back(6, 14);
    const { businessId, ownerId } = await account(
      { slug: "pallet-works-ajman", displayName: "Pallet Works Ajman", authority: "AJM", licenceNumber: "AJM-204455" },
      "basic",
      startedAt,
    );
    await signup(businessId, "pro", startedAt);
    const change = await db.subscriptionChange.create({
      data: {
        businessId,
        kind: "plan_change",
        fromPlanId: "pro",
        toPlanId: "basic",
        fromTerm: "monthly",
        toTerm: "monthly",
        effectiveAt: last(18),
        requestedById: ownerId,
        createdAt: last(2),
        appliedAt: last(18),
      },
      select: { id: true },
    });
    await db.mrrMovement.create({
      data: {
        businessId,
        kind: "contraction",
        cause: "plan_change",
        subscriptionChangeId: change.id,
        fromPlanId: "pro",
        toPlanId: "basic",
        deltaFils: value("basic") - value("pro"),
        mrrAfterFils: value("basic"),
        occurredAt: last(18),
        note: "Scheduled change to Basic reached its date",
      },
    });
    await live(businessId, "basic", startedAt);
  }

  {
    const startedAt = back(5, 9);
    const { businessId } = await account(
      { slug: "hatta-cold-stores", displayName: "Hatta Cold Stores", authority: "DED", licenceNumber: "DED-598310" },
      "pro",
      startedAt,
    );
    await signup(businessId, "pro", startedAt);
    await db.mrrMovement.create({
      data: {
        businessId,
        kind: "contraction",
        cause: "term_change",
        fromPlanId: "pro",
        toPlanId: "pro",
        deltaFils: value("pro", "annual") - value("pro"),
        mrrAfterFils: value("pro", "annual"),
        occurredAt: last(9),
        note: "Moved to annual",
      },
    });
    await live(businessId, "pro", startedAt, "annual");
  }

  // ── Cancellations ─────────────────────────────────────────────────────────

  await cancelled(
    { slug: "fujairah-marine-supplies", displayName: "Fujairah Marine Supplies", authority: "FUJ", licenceNumber: "FUJ-310772" },
    "basic",
    back(8, 5),
    last(8),
    20,
    "not_enough_enquiries",
    { total: 9, answered: 2 },
  );
  await cancelled(
    { slug: "sharjah-pipe-traders", displayName: "Sharjah Pipe Traders", authority: "SHJ", licenceNumber: "SHJ-447019" },
    "pro",
    back(10, 21),
    last(14),
    15,
    "not_enough_enquiries",
    { total: 7, answered: 1 },
  );
  await cancelled(
    { slug: "oasis-date-packers", displayName: "Oasis Date Packers", authority: "ADDED", licenceNumber: "ADDED-802356" },
    "basic",
    back(7, 2),
    last(22),
    10,
    "not_enough_enquiries",
    { total: 6, answered: 5 },
  );
  await cancelled(
    { slug: "rak-stone-cutters", displayName: "RAK Stone Cutters", authority: "RAK", licenceNumber: "RAK-118903" },
    "basic",
    back(9, 11),
    last(3),
    25,
    "too_expensive",
  );
  await cancelled(
    { slug: "dubai-signage-hub", displayName: "Dubai Signage Hub", authority: "DED", licenceNumber: "DED-735261" },
    "pro",
    back(12, 7),
    last(26),
    9,
    "another_platform",
  );

  // ── Failed payments ───────────────────────────────────────────────────────

  {
    // Failed on the 7th, and dropped to Free fourteen days later: churn, but a
    // lapse and not a cancellation, and it gives no reason.
    const startedAt = back(6, 25);
    const { businessId } = await account(
      { slug: "umm-al-quwain-boatyard", displayName: "Umm Al Quwain Boatyard", authority: "UAQ", licenceNumber: "UAQ-066481" },
      "free",
      startedAt,
    );
    await signup(businessId, "basic", startedAt);
    const subscription = await db.subscription.create({
      data: {
        businessId,
        planId: "free",
        status: "active",
        startedAt,
        periodStartedAt: last(7),
        renewsAt: new Date(now.getTime() + 20 * DAY),
        dunningStage: "dropped",
        pastDueSince: last(7),
        dunningAdvancedAt: last(21),
      },
      select: { id: true },
    });
    for (const at of [last(7), last(10), last(14)]) {
      await db.paymentAttempt.create({
        data: { subscriptionId: subscription.id, amountFils: value("basic"), succeeded: false, providerMessage: "Card declined", attemptedAt: at },
      });
    }
    await db.mrrMovement.create({
      data: {
        businessId,
        kind: "churn",
        cause: "dunning_drop",
        fromPlanId: "basic",
        toPlanId: "free",
        deltaFils: -value("basic"),
        mrrAfterFils: 0,
        occurredAt: last(21),
        note: "Dunning drop after 14 days past due",
      },
    });
  }

  {
    // Failed on the 27th and went through on the 1st: in dunning when the month
    // closed, so at risk in last month's figures, and nowhere in this month's.
    const startedAt = back(3, 16);
    const { businessId } = await account(
      { slug: "jebel-ali-forwarding", displayName: "Jebel Ali Forwarding", authority: "JAFZA", licenceNumber: "JAFZA-150338" },
      "pro",
      startedAt,
    );
    await signup(businessId, "pro", startedAt);
    const subscription = await live(businessId, "pro", startedAt);
    await db.paymentAttempt.create({
      data: { subscriptionId: subscription.id, amountFils: value("pro"), succeeded: false, providerMessage: "Insufficient funds", attemptedAt: last(27) },
    });
    await db.paymentAttempt.create({
      data: {
        subscriptionId: subscription.id,
        amountFils: value("pro"),
        succeeded: true,
        attemptedAt: new Date(thisMonthStart.getTime() + 2 * 3_600_000),
      },
    });
    await db.placementSlot.create({
      data: {
        businessId,
        categoryId: (categories[1] ?? category).id,
        monthlyPriceAed: 450,
        startsOn: last(10),
        endsOn: thisMonthStart,
      },
    });
  }

  console.log("   11 accounts: 1 new, 1 upgrade, 1 downgrade, 1 term switch, 5 cancelled, 1 lapsed, 1 card failure");
}
