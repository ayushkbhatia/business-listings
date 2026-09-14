import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board 4f — three accounts whose health the rest of the seed never reaches.
 *
 * Every historical enquiry `seedReplyHistory` writes is answered, so every
 * claimed supplier measures healthy or unmeasured and the board's two warning
 * states — churn risk and slow replies — have no row, nor does an upgrade
 * candidate, because no seeded seller has ever been refused at a cap. The
 * states table asks for all of them, and a list that can only show "Healthy" is
 * not a list anybody can check the thresholds against.
 *
 * **Measured, not assigned.** These are enquiries, recipients and replies, and
 * the rate comes out of `recomputeDerived` through `measureReplies` like every
 * other supplier's. The numbers are chosen so the arithmetic is legible:
 *
 *   - Technopump Trading — Basic, paying, 4 of 12 answered (33%): churn risk.
 *   - Dana Printing & Signage — Pro, paying, 5 of 8 answered (62%): slow replies.
 *   - Sharjah Steel Fabricators — Basic, paying, 5 of 7 answered (71%), and
 *     refused listing 12 products at its cap six days ago: upgrade candidate,
 *     which outranks slow replies as the board draws it.
 *
 * New businesses, never repurposed ones (memory: seed states are shared). All
 * enquiries closed before `now`, so each counts. Runs before `recomputeDerived`.
 */

type Db = PrismaClient;

const DAY = 86_400_000;

interface Fixture {
  slug: string;
  displayName: string;
  licenceNumber: string;
  planId: "basic" | "pro";
  sellsKind: "goods" | "services";
  answered: number;
  total: number;
  capRefusal?: { daysAgo: number; attempted: number };
}

const FIXTURES: readonly Fixture[] = [
  {
    slug: "technopump-trading-llc",
    displayName: "Technopump Trading LLC",
    licenceNumber: "DED-330218",
    planId: "basic",
    sellsKind: "goods",
    answered: 4,
    total: 12,
  },
  {
    slug: "dana-printing-signage",
    displayName: "Dana Printing & Signage",
    licenceNumber: "ADDED-551740",
    planId: "pro",
    sellsKind: "goods",
    answered: 5,
    total: 8,
  },
  {
    slug: "sharjah-steel-fabricators",
    displayName: "Sharjah Steel Fabricators",
    licenceNumber: "SHJ-118420",
    planId: "basic",
    sellsKind: "goods",
    answered: 5,
    total: 7,
    capRefusal: { daysAgo: 6, attempted: 12 },
  },
];

export async function seedAccountHealth(db: Db, now: Date): Promise<void> {
  console.log("→ account health fixtures, for board 4f");

  // Their own buyer, so no existing buyer's inbox grows by 27 enquiries under a
  // test that counts it.
  const buyer = await db.user.create({
    data: {
      id: "00000000-0000-4000-8400-000000000100",
      email: "procurement@health-fixture.example",
      fullName: "Health Fixture Buyer",
      roles: ["buyer"],
    },
    select: { id: true },
  });
  const buyerId = buyer.id;

  const category = await db.category.findFirstOrThrow({
    where: { parentId: { not: null } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const area = await db.area.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true, emirate: true } });
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  for (const [index, fixture] of FIXTURES.entries()) {
    const business = await db.business.create({
      data: {
        tradeName: fixture.displayName,
        displayName: fixture.displayName,
        slug: fixture.slug,
        licenceNumber: fixture.licenceNumber,
        licenceAuthority: fixture.licenceNumber.split("-")[0] as never,
        licenceExpiry: new Date(now.getTime() + 240 * DAY),
        primaryCategoryId: category.id,
        claimStatus: "claimed",
        publishedAt: ago(120),
        verificationTier: 2,
        verifiedAt: ago(118),
        planId: fixture.planId,
        sellsKind: fixture.sellsKind,
        locations: {
          create: [{ type: "warehouse", areaId: area.id, emirate: area.emirate, addressLine: "Warehouse 4, Industrial Area" }],
        },
      },
      select: { id: true },
    });

    const owner = await db.user.create({
      data: {
        id: `00000000-0000-4000-8400-${String(index + 1).padStart(12, "0")}`,
        email: `owner.${fixture.slug}@health-fixture.example`,
        fullName: `${fixture.displayName.split(" ")[0]} Owner`,
        roles: ["seller_owner"],
        businessId: business.id,
      },
      select: { id: true },
    });

    await db.subscription.create({
      data: {
        businessId: business.id,
        planId: fixture.planId,
        status: "active",
        startedAt: ago(110),
        periodStartedAt: ago(20),
        renewsAt: new Date(now.getTime() + 10 * DAY),
      },
    });
    /*
       The signup, in the revenue ledger. Board 4g found these three paying with
       no movement behind them: the ledger read 3,588 dirhams a month short of
       the subscription table on every seeded database, and the revenue screen's
       reconciliation warning was the first page to say so. A paying account
       that the ledger never saw start is a subscription `changePlan` did not
       write, which no real one is.
    */
    const monthlyFils = fixture.planId === "pro" ? 89_900 : 34_900;
    await db.mrrMovement.create({
      data: {
        businessId: business.id,
        kind: "new_business",
        cause: "plan_change",
        toPlanId: fixture.planId,
        deltaFils: monthlyFils,
        mrrAfterFils: monthlyFils,
        occurredAt: ago(110),
        note: "Signed up",
      },
    });

    for (let j = 0; j < fixture.total; j += 1) {
      // Spread through the window, oldest first, every one closed before now.
      const deliveredAt = ago(12 + j * 6);
      const enquiry = await db.enquiry.create({
        data: {
          ref: `ENQ-4F${index}${String(j).padStart(2, "0")}`,
          buyerId,
          requirement: "Historical enquiry for the account-health fixtures.",
          closesAt: new Date(deliveredAt.getTime() + 5 * DAY),
          createdAt: deliveredAt,
          lines: { create: [{ description: "Assorted fittings", qty: 20, sortOrder: 0 }] },
        },
        select: { id: true },
      });

      const answered = j < fixture.answered;
      // A reply inside the day for the answered ones, varied so the median moves.
      const repliedAt = answered ? new Date(deliveredAt.getTime() + (90 + j * 70) * 60_000) : null;

      await db.enquiryRecipient.create({
        data: {
          enquiryId: enquiry.id,
          businessId: business.id,
          state: answered ? "quoted" : "delivered",
          createdAt: deliveredAt,
          openedAt: new Date(deliveredAt.getTime() + 30 * 60_000),
          firstReplyAt: repliedAt,
        },
      });

      if (repliedAt) {
        // The reply that stamped `firstReplyAt` — a timestamp with no message
        // behind it is a reply nobody sent.
        await db.message.create({
          data: {
            enquiryId: enquiry.id,
            businessId: business.id,
            senderId: owner.id, authorSide: "seller",
            body: "Thanks for the enquiry. Our quote follows.",
            createdAt: repliedAt,
          },
        });
      }
    }

    if (fixture.capRefusal) {
      // Written as `recordCapRefused` writes it, on the date the seller tried.
      await db.productEvent.create({
        data: {
          name: "product_cap_refused",
          businessId: business.id,
          actorId: owner.id,
          props: {
            plan: "Basic",
            cap: 150,
            attempted: fixture.capRefusal.attempted,
            surface: "bulk_publish",
          },
          createdAt: ago(fixture.capRefusal.daysAgo),
        },
      });
    }
  }
}
