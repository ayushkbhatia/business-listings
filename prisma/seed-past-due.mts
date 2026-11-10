import type { PrismaClient } from "../lib/db/generated/client.js";
import { snapshotOf } from "../lib/plan/entitlements.js";
import { vatOn } from "../lib/billing/proration.js";

/**
 * A seller whose card failed nine days ago — task T9.7, the money path.
 *
 * Its own business and its own seat (`bl.e2e.pastdue.seller@gmail.com`, in
 * `tests/e2e/auth.setup.ts`), because the path the e2e walks cancels and then
 * resumes the subscription. Run against the Pro seat it would race every other
 * billing spec that reads that seat's subscription; a seat per file does not
 * race (`playwright-cross-file-races`).
 *
 * The state is the middle of the sequence, which is where every part of the
 * rail has something to say: the card tried on day 0, the first notice sent on
 * day 3, the reminder on day 7 reaching email and in-app and *not* WhatsApp —
 * nobody on the team has a number — and the final notice and the plan change
 * still to come. Seeded as the job would have left it, rather than by running
 * the job: the job needs nine days to pass.
 */

const DAY = 86_400_000;
export const PAST_DUE_SLUG = "corniche-packaging-supplies-llc";

export async function seedPastDueSeller(db: PrismaClient, now: Date): Promise<void> {
  console.log("→ a seller nine days past due, for the money-path e2e (T9.7)");
  const at = (days: number) => new Date(now.getTime() + days * DAY);

  const category = await db.category.findFirst({ where: { slug: "valves-and-fittings" }, select: { id: true } });
  const plan = await db.plan.findUnique({ where: { id: "basic" } });
  if (!category || !plan) return;

  const existing = await db.business.findUnique({ where: { slug: PAST_DUE_SLUG }, select: { id: true } });
  if (existing) {
    await db.notificationDelivery.deleteMany({ where: { businessId: existing.id } });
    await db.business.delete({ where: { id: existing.id } });
  }

  const business = await db.business.create({
    data: {
      tradeName: "Corniche Packaging Supplies LLC",
      displayName: "Corniche Packaging Supplies",
      slug: PAST_DUE_SLUG,
      licenceNumber: "DED-771904",
      licenceAuthority: "DED",
      licenceExpiry: at(240),
      primaryCategoryId: category.id,
      claimStatus: "claimed",
      publishedAt: at(-200),
      verificationTier: 2,
      verifiedAt: at(-198),
      planId: "basic",
      headline: "Stretch film, strapping and carton for warehouses in Mussafah and Jebel Ali",
    },
    select: { id: true },
  });

  const pastDueSince = at(-9);
  const monthly = Number(plan.monthlyPriceAed);
  // What the renewal asked for: one month of Basic, VAT included.
  const chargeFils = Math.round(monthly * 100) + vatOn(Math.round(monthly * 100));

  const subscription = await db.subscription.create({
    data: {
      businessId: business.id,
      planId: "basic",
      status: "past_due",
      term: "monthly",
      startedAt: at(-190),
      // The renewal that failed, which a failure never advances.
      renewsAt: pastDueSince,
      periodStartedAt: at(-39),
      anchorDay: pastDueSince.getUTCDate(),
      dunningStage: "messaged",
      pastDueSince,
      dunningAdvancedAt: at(-2),
      entitlementSnapshot: snapshotOf(
        {
          id: plan.id,
          name: plan.name,
          monthlyPriceAed: monthly,
          enquiriesPerMonth: plan.enquiriesPerMonth,
          serviceLimit: plan.serviceLimit,
          categoryLimit: plan.categoryLimit,
          productLimit: plan.productLimit,
          locationLimit: plan.locationLimit,
          photoLimit: plan.photoLimit,
          publicPhotoLimit: plan.publicPhotoLimit,
          storageMb: plan.storageMb,
          teamSeats: plan.teamSeats,
          rankingMultiplier: Number(plan.rankingMultiplier),
          customDomain: plan.customDomain,
          analytics: plan.analytics,
          csvImport: plan.csvImport,
          sponsoredEligible: plan.sponsoredEligible,
          sortOrder: plan.sortOrder,
        },
        at(-190),
      ) as unknown as object,
    },
    select: { id: true },
  });

  /*
     Its signup, in the MRR ledger. The seed refuses to finish when the ledger
     and the subscription table disagree, and a past-due account still counts:
     it is recurring revenue until it drops.
  */
  await db.mrrMovement.create({
    data: {
      businessId: business.id,
      kind: "new_business",
      fromPlanId: null,
      toPlanId: "basic",
      deltaFils: Math.round(monthly * 100),
      mrrAfterFils: Math.round(monthly * 100),
      occurredAt: at(-190),
      note: "Signed up",
      cause: "plan_change",
    },
  });

  await db.paymentAttempt.create({
    data: {
      subscriptionId: subscription.id,
      amountFils: chargeFils,
      succeeded: false,
      providerMessage: "Card expired",
      attemptedAt: pastDueSince,
    },
  });

  const row = (createdAt: Date, channel: "email" | "in_app" | "whatsapp", sent: boolean) => ({
    event: "payment_failed" as const,
    channel,
    businessId: business.id,
    status: sent ? ("sent" as const) : ("skipped" as const),
    reason: sent ? null : "recipient_has_no_address_for_this_channel",
    sentAt: sent ? createdAt : null,
    createdAt,
  });
  await db.notificationDelivery.createMany({
    data: [
      row(at(-6), "email", true),
      row(new Date(at(-6).getTime() + 1000), "in_app", true),
      row(at(-2), "email", true),
      row(new Date(at(-2).getTime() + 1000), "in_app", true),
      row(new Date(at(-2).getTime() + 2000), "whatsapp", false),
    ],
  });
}
