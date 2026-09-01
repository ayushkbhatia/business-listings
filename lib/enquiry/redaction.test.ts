import { describe, expect, it } from "vitest";
import { detectIdentityLeak, isSafeToPublish } from "./redaction";

/**
 * Board 1a acceptance criterion 2: "a requirement containing a phone number,
 * email, IBAN or company name is suppressed — covered by a test."
 *
 * This is that test. It matters more than most: the open-requests panel is on
 * the most-crawled page the platform has, the rows on it are written by buyers
 * who have no idea they will be published, and a miss here puts somebody's
 * mobile number in front of a search engine.
 *
 * So the false-negative cases are written first and the false-positive cases
 * are written as a budget rather than a requirement — a requirement wrongly
 * suppressed costs one of four slots on a panel that is allowed to show three.
 */

describe("what must never reach the home page", () => {
  it("catches a UAE mobile in the several ways it gets written", () => {
    for (const written of [
      "Butterfly valves DN200. Call Ahmed on 0506412288.",
      "Need 40 helmets — reach me at +971 50 641 2288",
      "Ducting for a riser. 00971506412288 is the site number.",
      "Cable, 400m. Office 04 885 1122 between 9 and 5.",
      "Call 050-641-2288 for the drawings.",
    ]) {
      expect(detectIdentityLeak(written).kinds, written).toContain("phone");
    }
  });

  it("catches an email address", () => {
    const verdict = detectIdentityLeak("Send the quote to ahmed@algulfcool.ae please.");
    expect(verdict.leaks).toBe(true);
    expect(verdict.kinds).toContain("email");
  });

  it("catches an IBAN, using the same patterns as the message thread", () => {
    const verdict = detectIdentityLeak("Advance to AE07 0331 2345 6789 0123 456 before dispatch.");
    expect(verdict.kinds).toContain("iban");
  });

  it("catches a company name by its legal form", () => {
    for (const written of [
      "Fire extinguisher refills for Gulf Crest Trading LLC, 40 units.",
      "Pallets for Northbay General Trading L.L.C.",
      "Cable for Meridian Gulf FZE, Jebel Ali.",
      "Panels for Al Sahra Enterprises.",
    ]) {
      expect(detectIdentityLeak(written).kinds, written).toContain("company_name");
    }
  });

  it("catches a website and a messaging handle", () => {
    expect(detectIdentityLeak("Specs on alwaha.ae").kinds).toContain("url");
    expect(detectIdentityLeak("Ping me @alwahasupplies").kinds).toContain("handle");
  });

  it("catches a TRN, which identifies a company exactly", () => {
    expect(detectIdentityLeak("Our TRN is 100123456700003, invoice to us.").kinds).toContain("trn");
  });

  it("reports every kind that matched, so a moderator can see why", () => {
    const verdict = detectIdentityLeak("Call 0506412288 or email ops@alwaha.ae — Al Waha Trading LLC");
    expect(verdict.leaks).toBe(true);
    expect(new Set(verdict.kinds)).toEqual(new Set(["phone", "email", "url", "company_name"]));
  });
});

describe("what a buyer may write and still be shown", () => {
  /*
   * The requirements the panel exists to show. Every one of these is a real
   * shape from the seed or the board, and suppressing them would empty the
   * panel — which is the failure mode nobody notices, because an empty panel
   * looks like a quiet week rather than a broken detector.
   */
  it("passes an ordinary requirement", () => {
    for (const written of [
      "120× fire-rated ducting, Ø300 galvanised",
      "Monthly deep-clean AMC, 3 retail units",
      "Sea freight, 2× 40HQ Jebel Ali to Dammam",
      "Ramadan gift boxes, 500 units, printed",
      "Resilient seated gate valves DN150 for a pump room upgrade in Mussafah.",
      "4-core 95mm² XLPE armoured cable, 400 m, plus glands and lugs.",
      "Coveralls, helmets and safety boots for 60 site staff. Sizes to be confirmed.",
      "Cold room panels, 100mm PUF, for a 40 m² chiller room in a central kitchen.",
    ]) {
      expect(isSafeToPublish(written), written).toBe(true);
    }
  });

  it("does not read a quantity or a specification as a phone number", () => {
    // The bare-digits rule is the loose one, so it is the one worth pinning.
    // Six digits is a quantity; seven is a number to call.
    expect(isSafeToPublish("500000 units of stretch film")).toBe(true);
    expect(isSafeToPublish("Class 150 flanges, PN16, DN300, 250 off")).toBe(true);
    expect(isSafeToPublish("Lead time 45 days, MOQ 1000")).toBe(true);
  });

  it("does not fire on the word 'established'", () => {
    // `\bEst\b` would; the abbreviation carries its full stop for this reason.
    expect(isSafeToPublish("Supplier must be established in the UAE.")).toBe(true);
  });

  it("suppresses rather than masks — there is no partial answer", () => {
    // The API deliberately has no "redacted text" return. Masking leaves the
    // shape of what was removed, and enough shapes reconstruct a person.
    const verdict = detectIdentityLeak("Call 0506412288");
    expect(Object.keys(verdict).sort()).toEqual(["kinds", "leaks"]);
  });
});
