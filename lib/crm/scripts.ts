import type { SignalFacts } from "./model";

/**
 * Board 12d — which script a call opens with, and the numbers it quotes.
 *
 * *"Lead with their missed demand, not with our product."* Each script opens
 * with a figure that is this business's own: searches in its trade and emirate
 * that found nobody last week, enquiries sent to its listing, enquiries its
 * plan held back, its own reply rate. Never the scope's area-wide volume — the
 * handoff's warning is exact: a script wired to the wrong query sounds
 * impressive and is false, which on a cold call is worse than no number.
 *
 * Where the number is nought, the script is the variant with no number in it,
 * rather than a sentence claiming nought buyers wanted them.
 *
 * The id is written to `call_outcome.script_id` on every call (Q3), so whether
 * a script converts is a query over the log. The versions are code: rewording a
 * script is a new id, so outcomes before and after the rewording do not mix.
 */

export type ScriptId =
  | "held_page.claim.v1"
  | "held_page.claim_no_number.v1"
  | "held_page.verify.v1"
  | "zero_result.v1"
  | "zero_result.no_number.v1"
  | "unclaimed_demand.v1"
  | "cap_reached.enquiry.v1"
  | "cap_reached.product.v1"
  | "cap_reached.service.v1"
  | "churn_risk.v1";

export const SCRIPT_IDS: readonly ScriptId[] = [
  "held_page.claim.v1",
  "held_page.claim_no_number.v1",
  "held_page.verify.v1",
  "zero_result.v1",
  "zero_result.no_number.v1",
  "unclaimed_demand.v1",
  "cap_reached.enquiry.v1",
  "cap_reached.product.v1",
  "cap_reached.service.v1",
  "churn_risk.v1",
];

export function scriptIdFor(facts: SignalFacts, claimStatus: string): ScriptId {
  switch (facts.kind) {
    case "held_page":
      if (claimStatus === "claimed") return "held_page.verify.v1";
      return facts.tradeSearchesWeek > 0 ? "held_page.claim.v1" : "held_page.claim_no_number.v1";
    case "zero_result":
      return facts.searchesWeek > 0 ? "zero_result.v1" : "zero_result.no_number.v1";
    case "unclaimed_demand":
      return "unclaimed_demand.v1";
    case "cap_reached":
      return facts.cap === "enquiry_cap" ? "cap_reached.enquiry.v1" : facts.cap === "service_cap" ? "cap_reached.service.v1" : "cap_reached.product.v1";
    case "churn_risk":
      return "churn_risk.v1";
  }
}
