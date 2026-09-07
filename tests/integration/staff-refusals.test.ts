import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { setVerificationTier } from "@/lib/verification/service";
import { suspendBusiness, liftSuspension } from "@/lib/business/service";
import { issueSubscriptionCredit } from "@/lib/billing/service";
import { staffMutation, SubjectCheckRequiredError } from "@/lib/audit/staff-mutation";
import { PermissionError, AuditReasonError } from "@/lib/auth/errors";
import { VERIFIED_TIER } from "@/lib/verification";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Handoff 4 criterion 9, against a real database.
 *
 *   "A moderator cannot change a verification tier, issue a credit or suspend
 *    an account — rejected server-side, covered by tests."
 *
 * Written first, before any admin screen exists, for the reason
 * docs/roadmap-handoff-3.md §5 gave about its own criterion 9: it is the only
 * criterion that is a claim about what the code **refuses** to do, and those are
 * the ones that pass by accident. Until this file existed a moderator could not
 * change a tier only because nobody could — no service, no screen, nothing to
 * call. That is not the same property, and it stops being true the moment step
 * 1 ships its first mutation.
 *
 * The subject rows are the sharp part. `staffMutation` used to run a role check
 * and nothing else, so a field verifier would have passed the tier gate for any
 * business in the directory — the exact grant §07 says is "not a general grant".
 * `SubjectCheckRequiredError` is what makes that a compile-and-run failure
 * rather than a quiet yes.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let fieldOfficerId: string;
let financeId: string;
let sellerOwnerId: string;

/** The listing this file borrows and puts back, and a second one to refuse on. */
let subjectBusinessId: string;
let otherBusinessId: string;
/**
 * What the borrowed listing's tier was before this file raised it.
 *
 * It used to be left at 4. That is fine right up until the listing it borrows
 * is one another test asserts on — which happened the moment handoff 5 seeded
 * visited listings, because `findFirstOrThrow` has no ordering and the new ones
 * sort early. Own your fixtures and put them back.
 */
let originalTier: number;
let originalVerifiedAt: Date | null;
/** A business on a paid plan, so a credit has something to be a credit against. */
let payingBusinessId: string;

beforeAll(async () => {
  const staff = await prisma.user.findMany({
    where: { roles: { hasSome: ["staff_ops_lead", "staff_moderator", "staff_field", "staff_finance"] } },
    select: { id: true, roles: true },
  });
  const byRole = (role: Role) => staff.find((u) => u.roles.includes(role))!.id;
  opsLeadId = byRole("staff_ops_lead");
  moderatorId = byRole("staff_moderator");
  fieldOfficerId = byRole("staff_field");
  financeId = byRole("staff_finance");

  const owner = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "seller_owner" } },
    select: { id: true, businessId: true },
  });
  sellerOwnerId = owner.id;

  /*
   * `mergedIntoId: null` on every pick below. A merged listing keeps its row so
   * its reviews survive and the merge stays reversible — it is not a listing
   * anybody should be suspending or tiering, and the dedupe suite leaves some
   * behind in a database this suite does not reset.
   */
  /*
     A current licence, and ordered, so this picks the same business every run.
     
     `setVerificationTier` refuses a raise above `EXPIRED_LICENCE_TIER` while
     the licence has lapsed — the floor added with the licence-expiry sweep, so
     that a nightly job and an ops lead cannot fight over one column. Without
     the constraint this query returns an arbitrary row, and the run passes or
     fails on whether that row's licence happens to be current. It went red the
     first time a seed elsewhere wrote to `business` and shifted the row order.

     The rules under test presuppose a licence worth tiering. Asserting them
     against a lapsed one was testing two rules at once and pinning neither.
  */
  const subject = await prisma.business.findFirstOrThrow({
    where: {
      suspendedAt: null,
      mergedIntoId: null,
      licenceExpiry: { gt: new Date() },
    },
    orderBy: { slug: "asc" },
    select: { id: true, verificationTier: true, verifiedAt: true },
  });
  subjectBusinessId = subject.id;
  originalTier = subject.verificationTier;
  originalVerifiedAt = subject.verifiedAt;

  const other = await prisma.business.findFirstOrThrow({
    where: { suspendedAt: null, mergedIntoId: null, id: { not: subject.id } },
    select: { id: true },
  });

  otherBusinessId = other.id;

  /*
   * Chosen explicitly rather than taken from whichever business the subject
   * query happened to return. CI failed here and a local run did not: a fresh
   * database offered a business with no subscription, and the credit ceiling
   * is computed from the plan price.
   */
  const paying = await prisma.business.findFirstOrThrow({
    where: { subscription: { isNot: null }, planId: { not: "free" } },
    select: { id: true },
  });
  payingBusinessId = paying.id;
});

afterAll(async () => {
  /*
     Put the borrowed listing back.

     This file raises a tier to 4 and used to leave it there — its own comment
     above says the database is not reset. That was harmless while the listing
     it borrowed was one nobody asserted on. Handoff 5 seeded more listings
     whose slugs sort early, `findFirstOrThrow` has no ordering, and a curated
     list started reporting a supplier as "Audited" that the seed made tier 2.
  */
  await prisma.business.update({
    where: { id: subjectBusinessId },
    data: { verificationTier: originalTier, verifiedAt: originalVerifiedAt },
  });
  await prisma.$disconnect();
});

const REASON = "Checked the trade licence against the DED register and the premises photos.";

describe("a moderator is refused the three rows §07 denies them", () => {
  it("cannot set a verification tier", async () => {
    await expect(
      setVerificationTier({
        actor: actor(moderatorId, "staff_moderator"),
        businessId: subjectBusinessId,
        tier: 2,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("cannot suspend a business", async () => {
    await expect(
      suspendBusiness({
        actor: actor(moderatorId, "staff_moderator"),
        businessId: subjectBusinessId,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("cannot issue a subscription credit", async () => {
    await expect(
      issueSubscriptionCredit({
        actor: actor(moderatorId, "staff_moderator"),
        businessId: subjectBusinessId,
        fils: 10_000,
        description: "One month, service interruption",
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("writes no audit row for any of the three", async () => {
    const rows = await prisma.auditEvent.count({
      where: {
        actorId: moderatorId,
        action: { in: ["tier_change", "suspend", "credit_issued"] },
      },
    });
    expect(rows).toBe(0);
  });
});

describe("the other roles are refused what is not theirs", () => {
  it("ops lead cannot issue a credit — §07 gives them a dash on that row", async () => {
    await expect(
      issueSubscriptionCredit({
        actor: actor(opsLeadId, "staff_ops_lead"),
        businessId: subjectBusinessId,
        fils: 10_000,
        description: "One month",
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("finance cannot suspend a business", async () => {
    await expect(
      suspendBusiness({
        actor: actor(financeId, "staff_finance"),
        businessId: subjectBusinessId,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("a seller owner cannot set their own tier by any path here", async () => {
    await expect(
      setVerificationTier({
        actor: actor(sellerOwnerId, "seller_owner"),
        businessId: subjectBusinessId,
        tier: 2,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("the field verifier no longer holds the tier grant at all", () => {
  /*
     It used to hold it conditionally: a field verifier could tier a business
     they had recorded a visit to, read off `Business.visitedByStaffId`. Site
     visits were withdrawn and that evidence with them, so rather than widen the
     grant into an unconditional one the narrower half was removed. These cases
     are the same refusals as before, now for a simpler reason.
  */
  it("is refused whichever business it is asked about", async () => {
    for (const businessId of [subjectBusinessId, otherBusinessId]) {
      await expect(
        setVerificationTier({
          actor: actor(fieldOfficerId, "staff_field"),
          businessId,
          tier: 2,
          reason: REASON,
        }),
      ).rejects.toBeInstanceOf(PermissionError);
    }
  });

  it("is allowed for the ops lead, who holds it unconditionally", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: subjectBusinessId },
      select: { verificationTier: true },
    });
    /*
       Any rung but the one it is on — `setVerificationTier` refuses an
       unchanged tier, and the point here is the grant, not the number. It read
       `=== 3 ? 2 : 3` while 3 was the ceiling. The licence is current by
       construction (see the subject query), so 2 is not blocked by the
       lapsed-licence floor.
    */
    const target = business.verificationTier === VERIFIED_TIER ? 1 : VERIFIED_TIER;

    const result = await setVerificationTier({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: subjectBusinessId,
      tier: target,
      reason: REASON,
    });

    expect(result.ok).toBe(true);
    const audit = await prisma.auditEvent.findFirst({
      where: { actorId: opsLeadId, action: "tier_change", subject: `Business:${subjectBusinessId}` },
      orderBy: { createdAt: "desc" },
      select: { reason: true },
    });
    expect(audit?.reason).toBe(REASON);
  });
});

describe("the harness refuses the shapes that would fail open", () => {
  it("refuses a subject-dependent capability without the subject check", async () => {
    /*
       The example used to be `business.verification_tier.write`, where a role
       test alone passed for every field verifier — including one tiering a
       business they had never visited. Site visits were withdrawn and that row
       became a plain ops-lead check, so this uses the audited capability that
       is still subject-dependent: reading another business's enquiries.
    */
    await expect(
      staffMutation(
        {
          actor: actor(opsLeadId, "staff_ops_lead"),
          capability: "enquiry.read_other_business",
          subject: `Business:${subjectBusinessId}`,
          reason: REASON,
        },
        async () => ({ result: null }),
      ),
    ).rejects.toBeInstanceOf(SubjectCheckRequiredError);
  });

  it("refuses subjectChecked on a capability that is not subject-dependent", async () => {
    await expect(
      staffMutation(
        {
          actor: actor(opsLeadId, "staff_ops_lead"),
          capability: "business.suspend",
          subject: `Business:${subjectBusinessId}`,
          reason: REASON,
          subjectChecked: true,
        },
        async () => ({ result: null }),
      ),
    ).rejects.toThrow(/not subject-dependent/);
  });

  it("refuses a blank reason before it reads anything", async () => {
    await expect(
      suspendBusiness({
        actor: actor(opsLeadId, "staff_ops_lead"),
        businessId: subjectBusinessId,
        reason: "   ",
      }),
    ).rejects.toBeInstanceOf(AuditReasonError);
  });

  it("refuses a reason that is punctuation", async () => {
    await expect(
      suspendBusiness({
        actor: actor(opsLeadId, "staff_ops_lead"),
        businessId: subjectBusinessId,
        reason: "-----",
      }),
    ).rejects.toBeInstanceOf(AuditReasonError);
  });
});

describe("what the permitted roles can do, and what it leaves behind", () => {
  it("ops lead suspends and lifts, and each carries its own reason", async () => {
    const target = await prisma.business.findFirstOrThrow({
      where: { suspendedAt: null, mergedIntoId: null, id: { not: subjectBusinessId } },
      select: { id: true },
    });

    const suspendReason = "Off-platform payment upheld. Suspended pending a call with the licence holder.";
    const liftReason = "Owner called back and the account is now going through the platform.";

    expect(
      await suspendBusiness({
        actor: actor(opsLeadId, "staff_ops_lead"),
        businessId: target.id,
        reason: suspendReason,
      }),
    ).toMatchObject({ ok: true });

    expect(
      await liftSuspension({
        actor: actor(opsLeadId, "staff_ops_lead"),
        businessId: target.id,
        reason: liftReason,
      }),
    ).toMatchObject({ ok: true });

    /*
     * The last two rows, not all of them. The audit log is append-only and this
     * suite runs against a database it does not reset between runs, so a second
     * run finds the first run's rows still there — which is the log working.
     * What is being asserted is that the two directions carried different
     * reasons and landed in order, not that this business has ever been
     * suspended exactly once.
     */
    const rows = await prisma.auditEvent.findMany({
      where: { action: "suspend", subject: `Business:${target.id}` },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { reason: true },
    });
    expect(rows.map((r) => r.reason)).toEqual([liftReason, suspendReason]);

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: target.id },
      select: { suspendedAt: true },
    });
    expect(after.suspendedAt).toBeNull();
  });

  it("a suspension keeps the badge, the catalogue and the reviews", async () => {
    const target = await prisma.business.findFirstOrThrow({
      where: { suspendedAt: null, verificationTier: { gt: 0 }, mergedIntoId: null },
      select: { id: true, verificationTier: true },
    });
    const before = {
      products: await prisma.product.count({ where: { businessId: target.id } }),
      reviews: await prisma.review.count({ where: { businessId: target.id } }),
    };

    await suspendBusiness({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: target.id,
      reason: "Supplier report upheld. Suspended while we reach the licence holder.",
    });

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: target.id },
      select: { verificationTier: true },
    });
    expect(after.verificationTier).toBe(target.verificationTier);
    expect(await prisma.product.count({ where: { businessId: target.id } })).toBe(before.products);
    expect(await prisma.review.count({ where: { businessId: target.id } })).toBe(before.reviews);

    await liftSuspension({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: target.id,
      reason: "Resolved on a call. Nothing further needed.",
    });
  });

  it("finance issues a credit as a negative line, never a refund", async () => {
    const result = await issueSubscriptionCredit({
      actor: actor(financeId, "staff_finance"),
      businessId: payingBusinessId,
      fils: 34_900,
      description: "Basic plan, four days the search index was stale",
      reason: "Our index lagged for four days and their listing did not appear. Credited the days.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      select: { lines: { select: { kind: true, amountAed: true, description: true } } },
    });
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]!.kind).toBe("subscription_credit");
    expect(Number(invoice.lines[0]!.amountAed)).toBeLessThan(0);
    expect(JSON.stringify(invoice.lines)).not.toMatch(/refund/i);
  });

  it("refuses a credit larger than a year of the plan", async () => {
    const result = await issueSubscriptionCredit({
      actor: actor(financeId, "staff_finance"),
      businessId: payingBusinessId,
      fils: 99_999_999,
      description: "Typo",
      reason: "This should not be possible to write down.",
    });
    expect(result).toMatchObject({ ok: false, error: "too_large" });
  });

  it("refuses a credit against a business with no subscription", async () => {
    const unsubscribed = await prisma.business.findFirstOrThrow({
      where: { subscription: { is: null } },
      select: { id: true },
    });

    const result = await issueSubscriptionCredit({
      actor: actor(financeId, "staff_finance"),
      businessId: unsubscribed.id,
      fils: 10_000,
      description: "One month",
      reason: "There is nothing here to credit against.",
    });

    expect(result).toMatchObject({ ok: false, error: "no_subscription" });
    // And the error names the real reason rather than a plan they do not have.
    if (result.ok) return;
    expect(result.message).not.toMatch(/more than a year/);
  });
});

describe("the ladder stops at 2", () => {
  /*
     It stopped at 4, then at 3. Tier 3 first required a recorded site visit,
     with a database CHECK enforcing it; visits were withdrawn and `audited`
     moved down from 4 to 3; then 3 became trade references, drawn `reserved`
     and built by nobody. Cutting that rung is what brings the ceiling to 2.

     What is asserted here is the same shape as it has been through all three:
     the service refuses first so the message can say what is wrong, and the
     constraint refuses underneath so a second code path cannot get around it.

     The interesting case is now 3 rather than 4. A 4 was always nonsense; a 3
     is the rung an ops lead could set last week and the one eight legacy rows
     were stored on, so it is the number a stale runbook or a half-applied
     migration would produce.
  */
  it("is refused before the write, with a message naming the range", async () => {
    const result = await setVerificationTier({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: otherBusinessId,
      tier: 3,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "out_of_range" });
    if (result.ok) return;
    expect(result.message).toMatch(/from 0 to 2/i);
  });

  it("and the database refuses it too, if a second path ever tries", async () => {
    await expect(
      prisma.business.update({
        where: { id: otherBusinessId },
        data: { verificationTier: 3 },
      }),
    ).rejects.toThrow();
  });
});
