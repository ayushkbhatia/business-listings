"use server";

import { revalidatePath } from "next/cache";
import { t } from "@/lib/i18n";
import { assignLead } from "@/lib/leads/assign";
import { clearOutcome, markOutcome, type Outcome } from "@/lib/leads/outcome";
import { saveDraft, discardDraft, type DraftLineInput } from "@/lib/quote/draft";
import { quoteFenceMessage } from "@/lib/quote/fence-words";
import {
  sendQuoteForBusiness,
  type SendQuoteInput,
  type SendQuoteResult,
} from "@/lib/quote/send-quote";
import { declineLead } from "@/lib/leads/decline";
import type { ProposalInput, ProposalRefusal } from "@/lib/quote/proposal";
import { saveProposalDraft, sendProposal } from "@/lib/quote/proposal-server";
import { getSellerSeat } from "../_shell";

export type { SendQuoteInput, SendQuoteLineInput, SendQuoteResult } from "@/lib/quote/send-quote";

/**
 * The inbox's writes.
 *
 * Thin on purpose: resolve who is acting, hand the work to the service,
 * revalidate what changed. Every invariant is in lib/leads/ and lib/quote/,
 * where a test can reach it without a request.
 *
 * All four revalidate the list as well as the lead. The rail carries counts, an
 * assignee and an outcome on every row, so a write that refreshed only the
 * detail pane would leave the tab a seller is looking at disagreeing with the
 * row they just changed.
 */

const LEAD_ERROR = {
  not_your_lead: "lead.error.not_yours",
  not_yours_to_mark: "lead.error.not_yours_to_mark",
  buyer_decided: "lead.error.buyer_decided",
  not_quoted: "lead.error.not_quoted",
  decided: "lead.error.decided",
  not_your_seat: "lead.error.not_your_seat",
  not_your_enquiry: "lead.error.not_yours",
  work_enquiry: "quote.error.work_enquiry",
  not_your_service: "proposal.error.not_your_service",
  not_work: "proposal.error.not_work",
} as const;

const DECLINE_ERROR = {
  not_your_lead: "lead.error.not_yours",
  not_yours_to_decline: "decline.error.not_yours",
  already_replied: "decline.error.already_replied",
  already_declined: "decline.error.already_declined",
  buyer_decided: "lead.error.buyer_decided",
  suspended: "quote.error.suspended",
  closed: "decline.error.closed",
  reason_too_long: "decline.error.reason_too_long",
} as const;

function leadError(code: keyof typeof LEAD_ERROR): string {
  return t(LEAD_ERROR[code]);
}

function revalidateLead(enquiryId: string): void {
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${enquiryId}`);
  revalidatePath(`/dashboard/leads/${enquiryId}/thread`);
}

export async function assignLeadAction(input: {
  enquiryId: string;
  assignedToId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("lead.error.not_yours") };

  const result = await assignLead(seat.actor, seat.businessId, input);
  if (!result.ok) return { ok: false, error: leadError(result.error) };

  revalidateLead(input.enquiryId);
  return { ok: true };
}

export async function markOutcomeAction(input: {
  enquiryId: string;
  outcome: Outcome;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("lead.error.not_yours") };

  const result = await markOutcome(seat.actor, seat.businessId, input);
  if (!result.ok) return { ok: false, error: leadError(result.error) };

  revalidateLead(input.enquiryId);
  // The overview's queue and the quotes pipeline both count outcomes.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/quotes");
  return { ok: true };
}

export async function clearOutcomeAction(
  enquiryId: string,
): Promise<{ ok: boolean; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("lead.error.not_yours") };

  const result = await clearOutcome(seat.actor, seat.businessId, { enquiryId });
  if (!result.ok) return { ok: false, error: leadError(result.error) };

  revalidateLead(enquiryId);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/quotes");
  return { ok: true };
}

/**
 * Autosave.
 *
 * Returns the instant it saved rather than a formatted label: the composer owns
 * how "Saved 20 seconds ago" reads and re-renders it as the seconds pass, and a
 * string built here would be frozen at the moment of the request.
 *
 * No revalidation. A draft changes nothing anybody else is looking at, and
 * refreshing the rail under a seller mid-keystroke is the one thing autosave
 * must not do.
 */
export async function saveDraftAction(input: {
  enquiryId: string;
  note: string;
  validityDays: number;
  paymentTerms: string | null;
  delivery: string | null;
  lines: DraftLineInput[];
}): Promise<{ ok: boolean; savedAt?: number; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("lead.error.not_yours") };

  const result = await saveDraft(seat.actor, seat.businessId, input);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "fenced"
          ? quoteFenceMessage(result.reason, result.closesAt)
          : leadError(result.error),
    };
  }

  return { ok: true, savedAt: result.savedAt.getTime() };
}

export async function discardDraftAction(
  enquiryId: string,
): Promise<{ ok: boolean; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("lead.error.not_yours") };

  await discardDraft(seat.actor, seat.businessId, enquiryId);
  revalidateLead(enquiryId);
  return { ok: true };
}

export async function sendQuote(input: SendQuoteInput): Promise<SendQuoteResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("quote.error.not_your_enquiry") };

  const result = await sendQuoteForBusiness(seat.actor, seat.businessId, input);
  if (!result.ok) return result;

  revalidateLead(input.enquiryId);
  revalidatePath("/dashboard/quotes");
  return result;
}

/* ── Board `3j-s` ─────────────────────────────────────────────────────────── */

/**
 * The proposal's autosave. Same contract as `saveDraftAction`: the instant it
 * saved, no revalidation, and a refusal in words.
 */
export async function saveProposalDraftAction(
  input: ProposalInput & { enquiryId: string },
): Promise<{ ok: boolean; savedAt?: number; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("lead.error.not_yours") };

  const result = await saveProposalDraft(seat.actor, seat.businessId, input);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "fenced"
          ? quoteFenceMessage(result.reason, result.closesAt)
          : leadError(result.error),
    };
  }
  return { ok: true, savedAt: result.savedAt.getTime() };
}

export async function sendProposalAction(
  input: ProposalInput & { enquiryId: string },
): Promise<{ ok: true; quoteRef: string } | { ok: false; error: string; refusals?: ProposalRefusal[] }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("quote.error.not_your_enquiry") };

  const result = await sendProposal(seat.actor, seat.businessId, input);
  if (!result.ok) return result;

  revalidateLead(input.enquiryId);
  revalidatePath("/dashboard/quotes");
  return { ok: true, quoteRef: result.quoteRef };
}

/** `Decline`. Final, so the screen confirms before it calls this. */
export async function declineLeadAction(input: {
  enquiryId: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("lead.error.not_yours") };

  const result = await declineLead(seat.actor, seat.businessId, input);
  if (!result.ok) return { ok: false, error: t(DECLINE_ERROR[result.error]) };

  revalidateLead(input.enquiryId);
  revalidatePath("/dashboard");
  return { ok: true };
}
