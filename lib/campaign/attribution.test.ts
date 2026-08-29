import { describe, expect, it } from "vitest";
import {
  decode,
  encode,
  EMPTY,
  fromSearchParams,
  isEmpty,
  merge,
  type Attribution,
} from "./attribution";

/**
 * Criterion 9's decisions, tested without a request.
 *
 * The cookie plumbing is three lines in `cookie.ts`. What is worth asserting is
 * the parsing — because a cookie is attacker-controlled input — and the
 * first-touch rule, because that is an argument settled in one direction.
 */

describe("reading a tagged arrival", () => {
  it("takes the three values it stores and ignores the rest", () => {
    const result = fromSearchParams({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "hvac-q3",
      utm_content: "creative-b",
      utm_term: "gate valve dn100",
      q: "something else",
    });

    expect(result).toEqual({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "hvac-q3",
      campaignSlug: null,
    });
  });

  it("returns null for an untagged arrival, so an existing cookie is left alone", () => {
    /*
       The distinction that matters. "Arrived with nothing" must not overwrite
       "arrived last week from a campaign" with blanks — which is what a
       non-null empty result would do at the merge below.
    */
    expect(fromSearchParams({})).toBeNull();
    expect(fromSearchParams({ q: "valves" })).toBeNull();
  });

  it("records the landing campaign even when the link carried no UTM at all", () => {
    // Somebody typed the campaign address, or it was printed on something.
    const result = fromSearchParams({}, "find-a-supplier");
    expect(result?.campaignSlug).toBe("find-a-supplier");
  });

  it("drops a value that is not a short label", () => {
    // A UTM value ends up in a report and in a database column. Anything with
    // markup, a newline or a novel in it is somebody probing rather than a
    // campaign name.
    const result = fromSearchParams({
      utm_source: "<script>alert(1)</script>",
      utm_medium: "x".repeat(200),
      utm_campaign: "fine-one",
    });
    expect(result).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: "fine-one",
      campaignSlug: null,
    });
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(fromSearchParams({ utm_source: ["google", "bing"] })?.utmSource).toBe("google");
  });
});

describe("the cookie is attacker-controlled input", () => {
  const real: Attribution = {
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "hvac-q3",
    campaignSlug: "find-a-supplier",
  };

  it("round-trips what it stored", () => {
    expect(decode(encode(real))).toEqual(real);
  });

  it("reads junk as no attribution rather than throwing", () => {
    /*
       An enquiry that fails to send because somebody pasted nonsense into a
       cookie is a far worse outcome than an enquiry with no source on it.
    */
    for (const junk of ["", "not json", "{}", "[1,2,3]", '"a string"', "null", "[[]]"]) {
      expect(() => decode(junk), junk).not.toThrow();
      expect(isEmpty(decode(junk)), junk).toBe(true);
    }
    expect(decode(undefined)).toEqual(EMPTY);
  });

  it("refuses a campaign slug that is not one", () => {
    const forged = JSON.stringify(["google", "cpc", "hvac", "'; drop table enquiry; --"]);
    expect(decode(forged).campaignSlug).toBeNull();
    // The rest of the row survives — one bad field is not a reason to lose the
    // attribution somebody legitimately earned.
    expect(decode(forged).utmSource).toBe("google");
  });

  it("cleans values on the way out as well as on the way in", () => {
    const forged = JSON.stringify(["<img onerror=x>", "cpc", null, null]);
    expect(decode(forged).utmSource).toBeNull();
    expect(decode(forged).utmMedium).toBe("cpc");
  });
});

describe("first touch wins", () => {
  const first: Attribution = {
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "hvac-q3",
    campaignSlug: null,
  };
  const second: Attribution = {
    utmSource: "newsletter",
    utmMedium: "email",
    utmCampaign: "august",
    campaignSlug: null,
  };

  it("keeps the earlier attribution when a second tagged visit arrives", () => {
    /*
       A buyer won by a campaign who comes back a week later through a search
       was still won by the campaign. Last-touch would credit the search engine
       for demand somebody else created — an argument every attribution model
       has, settled here in one direction and written down.
    */
    expect(merge(first, second)).toEqual(first);
  });

  it("takes the incoming one when there is nothing stored", () => {
    expect(merge(EMPTY, second)).toEqual(second);
  });

  it("leaves what is stored alone when nothing arrives", () => {
    expect(merge(first, null)).toEqual(first);
  });
});
