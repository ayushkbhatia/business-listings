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

// ── Trust ───────────────────────────────────────────────────────────────────
export const assertCanChangeVerificationTier = (a: Actor) =>
  assertCan(a, "business.verification_tier.write");
export const mayChangeVerificationTier = (a: Actor) => can(a, "business.verification_tier.write");

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

export const assertCanReadAuditLog = (a: Actor) => assertCan(a, "audit.read");
export const mayReadAuditLog = (a: Actor) => can(a, "audit.read");

export const assertCanViewAs = (a: Actor) => assertCan(a, "support.view_as");
export const mayViewAs = (a: Actor) => can(a, "support.view_as");

// ── Seller ──────────────────────────────────────────────────────────────────
export const assertCanEditListing = (a: Actor) => assertCan(a, "listing.edit");
export const mayEditListing = (a: Actor) => can(a, "listing.edit");

export const assertCanEditProduct = (a: Actor) => assertCan(a, "product.edit");
export const mayEditProduct = (a: Actor) => can(a, "product.edit");

export const assertCanRespondToEnquiry = (a: Actor) => assertCan(a, "enquiry.respond");
export const mayRespondToEnquiry = (a: Actor) => can(a, "enquiry.respond");

export const assertCanSendQuote = (a: Actor) => assertCan(a, "quote.send");
export const maySendQuote = (a: Actor) => can(a, "quote.send");

export const assertCanManageBilling = (a: Actor) => assertCan(a, "billing.manage");
export const mayManageBilling = (a: Actor) => can(a, "billing.manage");

export const assertCanManageTeam = (a: Actor) => assertCan(a, "team.manage");
export const mayManageTeam = (a: Actor) => can(a, "team.manage");

export const assertCanChangePlan = (a: Actor) => assertCan(a, "plan.change");
export const mayChangePlan = (a: Actor) => can(a, "plan.change");

export const assertCanBuyPlacement = (a: Actor) => assertCan(a, "placement.purchase");
export const mayBuyPlacement = (a: Actor) => can(a, "placement.purchase");

export const assertCanReadAnalytics = (a: Actor) => assertCan(a, "analytics.read");
export const mayReadAnalytics = (a: Actor) => can(a, "analytics.read");

// ── Buyer ───────────────────────────────────────────────────────────────────
export const assertCanCreateEnquiry = (a: Actor) => assertCan(a, "enquiry.create");
export const mayCreateEnquiry = (a: Actor) => can(a, "enquiry.create");

export const assertCanAcceptQuote = (a: Actor) => assertCan(a, "quote.accept");
export const mayAcceptQuote = (a: Actor) => can(a, "quote.accept");

export const assertCanWriteReview = (a: Actor) => assertCan(a, "review.create");
export const mayWriteReview = (a: Actor) => can(a, "review.create");
