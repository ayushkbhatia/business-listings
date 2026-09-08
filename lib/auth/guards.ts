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
 * `business.verification_tier.write` has no bare guard here either, though it is
 * now a plain role check: ops lead and nobody else. It was subject-dependent —
 * a field verifier held it only for a business they had been to — until site
 * visits were withdrawn took the evidence away. `lib/verification/service.ts`
 * asserts it inline beside the reason it writes, which keeps the capability and
 * the audit row in one place.
 *
 * The rule below still applies to `enquiry.respond`, `quote.send`,
 * `analytics.read` and
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


export const assertCanManageRouting = (a: Actor) => assertCan(a, "routing.manage");
export const mayManageRouting = (a: Actor) => can(a, "routing.manage");

// ── Commercial ──────────────────────────────────────────────────────────────
export const assertCanIssueSubscriptionCredit = (a: Actor) => assertCan(a, "subscription.credit");
export const mayIssueSubscriptionCredit = (a: Actor) => can(a, "subscription.credit");

export const assertCanBoostPlacement = (a: Actor) => assertCan(a, "placement.boost");
export const mayBoostPlacement = (a: Actor) => can(a, "placement.boost");

/*
   Board 7d, "See analytics": owner and manager in full, a sales seat for their
   own leads only, finance not at all. The capability answers *may this seat
   open the page*; `analyticsScopeFor` in lib/auth/subject.ts answers *how much
   of it*, and the two are separate because a boolean cannot express the middle
   row of that table.
*/
export const assertCanReadAnalytics = (a: Actor) => assertCan(a, "analytics.read");
export const mayReadAnalytics = (a: Actor) => can(a, "analytics.read");

/*
   Board 7d's three review rows, which the seller dashboard had been answering
   with `listing.edit` — a capability about editing the listing profile.

   That is over-tight in one direction and loose in the other: a sales seat
   holds "Request reviews from buyers" in the matrix and `listing.edit` denied
   it, and board 11c's `Q4` puts a dispute above a reply, which one capability
   cannot express. Three rows, three functions, named for what they permit.
*/
export const assertCanReplyToReviews = (a: Actor) => assertCan(a, "review.reply");
export const mayReplyToReviews = (a: Actor) => can(a, "review.reply");

export const assertCanRequestReviews = (a: Actor) => assertCan(a, "review.request");
export const mayRequestReviews = (a: Actor) => can(a, "review.request");

export const assertCanDisputeReviews = (a: Actor) => assertCan(a, "review.dispute");
export const mayDisputeReviews = (a: Actor) => can(a, "review.dispute");

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
