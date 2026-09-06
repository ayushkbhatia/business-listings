import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";

/**
 * Two claims board 3g must not make, asserted where the strings live.
 *
 * Every user-visible string in this product goes through `t()` and therefore
 * through `lib/i18n/en.ts`, which is what makes a grep over that file
 * exhaustive rather than a spot check. Board 3h asserts the same thing in an
 * e2e against one rendered page; this catches it at the layer that owns the
 * words, before a screen exists to render them.
 */

function valuesOf(prefix: string): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(en)) {
    if (!key.startsWith(prefix)) continue;
    if (typeof value === "string") out.push([key, value]);
    else if (value && typeof value === "object") {
      for (const form of Object.values(value)) {
        if (typeof form === "string") out.push([key, form]);
      }
    }
  }
  return out;
}

describe("what the product editor may not claim", () => {
  /*
     Criterion 9. The board read "products at 100% appear in 3× more filtered
     searches" — a causal claim about our own data that the data cannot support,
     and the correlation almost certainly runs the other way: sellers who fill
     every field are the organised sellers who would rank better anyway.

     What replaced it needs no statistic: a filter on a field returns products
     that have a value for it, so a product with the field empty is not in that
     result set. Not ranked lower — absent.
  */
  const CAUSAL =
    /\d+\s*×|\d+\s*x more|\d+ times more|more filtered searches|(?<!not |never )rank(s|ed|ing)? (higher|lower|better)|appear in more/i;

  /*
     Criterion 10. "Buyers filtered on Cv in 41 valve searches in Dubai last
     month" has no source. `SearchQueryLog` records the query, its normalised
     form, the result count, the category, the emirate and the tab — and not
     which filters were applied. `ZeroResultQuery.filters` does carry the spec
     facets and is written only when a search returns nothing, so counting from
     it would count failures and rise as the directory got worse.

     Board 3h reached this first and shipped the refusal in
     `template.platform_no_usage`. Two sibling seller screens must not disagree
     about whether that number exists.
  */
  const SEARCH_VOLUME = /buyers filtered on|\d+ (\w+ )?searches in|filtered on \w+ in \d+/i;

  it("claims no causal link between completeness and search volume", () => {
    // The negated form is the point, not an offence: "not ranked lower in it,
    // absent from it" is the sentence that replaced the multiplier.
    const offenders = valuesOf("product.").filter(([, value]) => CAUSAL.test(value));
    expect(offenders).toEqual([]);
  });

  it("quotes no facet-demand figure, because nothing measures one", () => {
    const offenders = valuesOf("product.").filter(([, value]) => SEARCH_VOLUME.test(value));
    expect(offenders).toEqual([]);
  });

  it("agrees with board 3h, which says the same thing about the same data", () => {
    // If this key ever stops saying it, the two screens have diverged and one
    // of them is quoting a number the other says does not exist.
    expect(en["template.platform_no_usage"]).toMatch(/records what was typed, not which filters/i);
  });

  it("states the gap in terms of absence from a filter, not of ranking", () => {
    // The replacement claim, pinned positively rather than only by what it
    // must not say.
    expect(en["product.gap_reason_filter"]).toMatch(/not in that filter/i);
    expect(en["product.gap_reason_filter"]).toMatch(/absent from it/i);
  });

  it("says the product stays live while its save is blocked", () => {
    /*
       The surprising half of board 3h's flag-not-delist model, and the one a
       seller will not assume. A requirement never delists anything; it bites at
       the next edit. If this sentence goes, the disabled Save reads as a
       takedown.
    */
    const blocked = en["product.save_blocked_count"];
    const forms = typeof blocked === "string" ? [blocked] : Object.values(blocked);
    for (const form of forms) {
      expect(form).toMatch(/stays live/i);
    }
  });

  it("uses none of the words for things that do not exist", () => {
    // `check:vocabulary` covers the whole file; this narrows it to the prefix
    // this board owns, so a failure names the board rather than the catalogue.
    const BANNED = /\b(cart|basket|checkout|payout|refund|dispatch|GMV|get quote|price on request|price: low)\b/i;
    const offenders = valuesOf("product.").filter(([, value]) => BANNED.test(value));
    expect(offenders).toEqual([]);
  });
});
