"use server";

import { revalidatePath } from "next/cache";
import { t } from "@/lib/i18n";
import { assignLead } from "@/lib/leads/assign";
import { clearOutcome, markOutcome, type Outcome } from "@/lib/leads/outcome";
import { saveDraft, discardDraft, type DraftLineInput } from "@/lib/quote/draft";
import {
  sendQuoteForBusiness,
  type SendQuoteInput,
  type SendQuoteResult,
} from "@/lib/quote/send-quote";
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
  lines: DraftLineInput[];
}): Promise<{ ok: boolean; savedAt?: number; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("lead.error.not_yours") };

  const result = await saveDraft(seat.actor, seat.businessId, input);
  if (!result.ok) return { ok: false, error: leadError(result.error) };

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
