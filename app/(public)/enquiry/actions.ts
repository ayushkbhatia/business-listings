"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { acceptQuote } from "@/lib/enquiry/service";
import { requestApproval } from "@/lib/buyer-company/approvals";
import { signInHref } from "@/lib/auth/next-path";
import { PermissionError } from "@/lib/auth/errors";
import { resolveBuyerId } from "./_buyer";

/**
 * Accepting a quote.
 *
 * The terminal state of the product. Everything it does is in
 * lib/enquiry/service.ts — this resolves who is asking and where they land.
 *
 * Two screens post here, the comparison (`1n`) and the negotiation thread
 * (`10h`), and board `10h` `B6` is why it is one action: accepting from the
 * thread does exactly what accepting from the comparison does. The only
 * difference is where a refusal is read — back on the screen it was pressed on.
 */

/** `thread:<slug>` names the thread the accept came from. Anything else is the comparison. */
function returnPath(enquiryId: string, from: FormDataEntryValue | null): string {
  const base = `/enquiry/${encodeURIComponent(enquiryId)}`;
  if (typeof from === "string") {
    const match = /^thread:([a-z0-9-]{1,120})$/.exec(from);
    if (match) return `${base}/thread/${match[1]}`;
  }
  return `${base}/compare`;
}

/**
 * Build plan 9.4: `quote.accept`, refused by the service, as the code the
 * screens already read refusals by. Anything else is still thrown.
 */
function refusedByMatrix(error: unknown): { ok: false; error: "not_permitted" } {
  if (error instanceof PermissionError) return { ok: false, error: "not_permitted" };
  throw error;
}

const COMPANY_REFUSALS: ReadonlySet<string> = new Set([
  "approval_required",
  "po_required",
  "cost_code_required",
  "reference_invalid",
  "not_member",
]);

export async function acceptQuoteAction(formData: FormData): Promise<void> {
  const quoteId = String(formData.get("quoteId") ?? "");
  const enquiryId = String(formData.get("enquiryId") ?? "");
  const token = formData.get("token");
  const back = returnPath(enquiryId, formData.get("from"));

  const buyerId = await resolveBuyerId(typeof token === "string" ? token : null);
  // Back to the screen the accept was pressed on, not the buyer account's front
  // page — board 7a `B9`, a sign-in round trip returns to what was in progress.
  if (!buyerId) redirect(signInHref(back));

  const result = await acceptQuote(buyerId, quoteId, new Date(), {
    source: typeof formData.get("from") === "string" && String(formData.get("from")).startsWith("thread:") ? "thread" : "compare",
  }).catch(refusedByMatrix);
  const carry = typeof token === "string" && token ? `?t=${token}` : "";

  /*
     Board `7b`. A company enquiry's accept controls lead to the accept screen,
     which says what the company's rule will do before anything is pressed. A
     form posted here from a page rendered before the rule applied — or before
     the enquiry's company required a PO number — lands there instead of on a
     bare refusal.
  */
  if (!result.ok && COMPANY_REFUSALS.has(result.error)) {
    redirect(`/enquiry/${encodeURIComponent(enquiryId)}/accept/${encodeURIComponent(quoteId)}`);
  }

  if (!result.ok) {
    const params = new URLSearchParams({ error: result.error });
    if (typeof token === "string" && token) params.set("t", token);
    redirect(`${back}?${params}`);
  }

  revalidatePath(`/enquiry/${enquiryId}`);
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/quotes");
  redirect(`/enquiry/${enquiryId}/accepted${carry}`);
}

/**
 * Board `7b` — accepting a quote on an enquiry raised for a company.
 *
 * One form, two outcomes, decided on the server under the company's lock: the
 * quote is accepted, or it goes to a colleague for approval. The screen said
 * which before the click; if the month moved in between — a colleague's
 * acceptance a minute ago used the limit — the server's answer stands and the
 * person lands where it put them, told why.
 */
export async function companyAcceptAction(formData: FormData): Promise<void> {
  const quoteId = String(formData.get("quoteId") ?? "");
  const enquiryId = String(formData.get("enquiryId") ?? "");
  const intent = String(formData.get("intent") ?? "accept");
  const poNumber = String(formData.get("poNumber") ?? "");
  const costCode = String(formData.get("costCode") ?? "");
  const note = String(formData.get("note") ?? "");
  const here = `/enquiry/${encodeURIComponent(enquiryId)}/accept/${encodeURIComponent(quoteId)}`;

  const buyerId = await resolveBuyerId(null);
  if (!buyerId) redirect(signInHref(here));

  const request = () => requestApproval(buyerId, quoteId, { poNumber, costCode, note }).catch(refusedByMatrix);
  const accept = () => acceptQuote(buyerId, quoteId, new Date(), { poNumber, costCode, source: "company" }).catch(refusedByMatrix);

  let outcome: "accepted" | "requested" | { error: string };
  if (intent === "request") {
    const asked = await request();
    if (asked.ok) outcome = "requested";
    else if (asked.error === "not_needed") {
      const accepted = await accept();
      outcome = accepted.ok ? "accepted" : { error: accepted.error };
    } else outcome = { error: asked.error };
  } else {
    const accepted = await accept();
    if (accepted.ok) outcome = "accepted";
    else if (accepted.error === "approval_required") {
      const asked = await request();
      outcome = asked.ok ? "requested" : { error: asked.error };
    } else outcome = { error: accepted.error };
  }

  revalidatePath("/account/company");
  revalidatePath("/account/company/approvals");
  revalidatePath(`/enquiry/${enquiryId}`);
  if (outcome === "accepted") {
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/quotes");
    redirect(`/enquiry/${encodeURIComponent(enquiryId)}/accepted`);
  }
  if (outcome === "requested") redirect(`${here}?requested=1`);
  redirect(`${here}?error=${encodeURIComponent(outcome.error)}`);
}
