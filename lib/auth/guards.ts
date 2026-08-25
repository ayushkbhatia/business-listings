import { assertCan, can } from "./can";
import type { Actor } from "./roles";

/**
 * One server-side function per capability.
 *
 * Call sites read as the thing they are doing, and `grep assertCan` finds every
 * privileged path in the codebase. A component never compares a role string; a
 * service never inlines a role list. If a check is missing, it is missing here,
 * and that is one file to review.
 *
 * Each `assert*` throws PermissionError. Each `may*` returns a boolean, for
 * deciding whether to render a control dimmed — never for deciding whether the
 * mutation is allowed.
 */

/*
 * ── Trust ───────────────────────────────────────────────────────────────────
 *
 * `business.verification_tier.write` has no bare guard here on purpose. A field
 * verifier holds it only for a visit they recorded, so the role grant is not
 * the check — see `assertCanSetVerificationTier` in lib/auth/subject.ts, which
 * takes the visit. A guard named the obvious thing and taking only an actor is
 * exactly the mistake that row exists to prevent, so it is not offered.
 *
 * The same applies to `enquiry.respond`, `quote.send`, `analytics.read` and
 * `enquiry.read_other_business`. Every subject-dependent capability is listed
 * in `SUBJECT_DEPENDENT`.
 */

export const assertCanSuspendBusiness = (a: Actor) => assertCan(a, "business.suspend");
export const maySuspendBusiness = (a: Actor) => can(a, "business.suspend");

export const assertCanMergeBusinesses = (a: Actor) => assertCan(a, "business.merge");
export const mayMergeBusinesses = (a: Actor) => can(a, "business.merge");

// ── Moderation ──────────────────────────────────────────────────────────────
export const assertCanRemoveReview = (a: Actor) => assertCan(a, "review.remove");
export const mayRemoveReview = (a: Actor) => can(a, "review.remove");

export const assertCanResolveSupplierReport = (a: Actor) => assertCan(a, "report.resolve");
export const mayResolveSupplierReport = (a: Actor) => can(a, "report.resolve");

export const assertCanDecideQueueItem = (a: Actor) => assertCan(a, "queue.decide");
export const mayDecideQueueItem = (a: Actor) => can(a, "queue.decide");

// ── Field ───────────────────────────────────────────────────────────────────
export const assertCanRecordVisit = (a: Actor) => assertCan(a, "visit.record");
export const mayRecordVisit = (a: Actor) => can(a, "visit.record");

export const assertCanResolveClaim = (a: Actor) => assertCan(a, "claim.resolve");
export const mayResolveClaim = (a: Actor) => can(a, "claim.resolve");

export const assertCanEditEntitlements = (a: Actor) => assertCan(a, "plan.entitlements.write");
export const mayEditEntitlements = (a: Actor) => can(a, "plan.entitlements.write");

export const assertCanEditRanking = (a: Actor) => assertCan(a, "search.ranking.write");
export const mayEditRanking = (a: Actor) => can(a, "search.ranking.write");

export const assertCanEditStorefrontTemplate = (a: Actor) =>
  assertCan(a, "storefront.template.write");
export const mayEditStorefrontTemplate = (a: Actor) => can(a, "storefront.template.write");

export const assertCanReplyToReview = (a: Actor) => assertCan(a, "review.reply");
export const mayReplyToReview = (a: Actor) => can(a, "review.reply");

export const assertCanRequestReview = (a: Actor) => assertCan(a, "review.request");
export const mayRequestReview = (a: Actor) => can(a, "review.request");

export const assertCanRequestVisit = (a: Actor) => assertCan(a, "visit.request");
export const mayRequestVisit = (a: Actor) => can(a, "visit.request");

export const assertCanManageRouting = (a: Actor) => assertCan(a, "routing.manage");
export const mayManageRouting = (a: Actor) => can(a, "routing.manage");

// ── Commercial ──────────────────────────────────────────────────────────────
export const assertCanIssueSubscriptionCredit = (a: Actor) => assertCan(a, "subscription.credit");
export const mayIssueSubscriptionCredit = (a: Actor) => can(a, "subscription.credit");

export const assertCanBoostPlacement = (a: Actor) => assertCan(a, "placement.boost");
export const mayBoostPlacement = (a: Actor) => can(a, "placement.boost");

export const assertCanReadRevenue = (a: Actor) => assertCan(a, "revenue.read");
export const mayReadRevenue = (a: Actor) => can(a, "revenue.read");

// ── Platform ────────────────────────────────────────────────────────────────
export const assertCanEditTaxonomy = (a: Actor) => assertCan(a, "taxonomy.write");
export const mayEditTaxonomy = (a: Actor) => can(a, "taxonomy.write");

export const assertCanManageStaff = (a: Actor) => assertCan(a, "staff.manage");
export const mayManageStaff = (a: Actor) => can(a, "staff.manage");



export const assertCanViewAs = (a: Actor) => assertCan(a, "support.view_as");
export const mayViewAs = (a: Actor) => can(a, "support.view_as");

// ── Seller ──────────────────────────────────────────────────────────────────
export const assertCanEditListing = (a: Actor) => assertCan(a, "listing.edit");
export const mayEditListing = (a: Actor) => can(a, "listing.edit");

export const assertCanEditProduct = (a: Actor) => assertCan(a, "product.edit");
export const mayEditProduct = (a: Actor) => can(a, "product.edit");


export const assertCanManageBilling = (a: Actor) => assertCan(a, "billing.manage");
export const mayManageBilling = (a: Actor) => can(a, "billing.manage");

export const assertCanManageTeam = (a: Actor) => assertCan(a, "team.manage");
export const mayManageTeam = (a: Actor) => can(a, "team.manage");

export const assertCanChangePlan = (a: Actor) => assertCan(a, "plan.change");
export const mayChangePlan = (a: Actor) => can(a, "plan.change");

export const assertCanBuyPlacement = (a: Actor) => assertCan(a, "placement.purchase");
export const mayBuyPlacement = (a: Actor) => can(a, "placement.purchase");



// ── Buyer ───────────────────────────────────────────────────────────────────
export const assertCanCreateEnquiry = (a: Actor) => assertCan(a, "enquiry.create");
export const mayCreateEnquiry = (a: Actor) => can(a, "enquiry.create");

export const assertCanAcceptQuote = (a: Actor) => assertCan(a, "quote.accept");
export const mayAcceptQuote = (a: Actor) => can(a, "quote.accept");

export const assertCanWriteReview = (a: Actor) => assertCan(a, "review.create");
export const mayWriteReview = (a: Actor) => can(a, "review.create");
