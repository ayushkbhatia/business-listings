import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import {
  allPassed,
  bannedTermIn,
  checksFor,
  orderedChecks,
  rowAction,
  worstOutcome,
  type Check,
  type ClaimFacts,
} from "./checks";
import { DEFAULT_RULES, parseRules, parseTerms, RULES, rulesProblem, type CheckRules } from "./rules";
import type { RegisterFetch } from "@/lib/credentials/register-fetch";

/**
 * Board 4b — the checks, and the two derived facts the whole screen hangs on.
 *
 * `allPassed` gates bulk approve (B1) and `rowAction` decides the per-row
 * button (B6). Both are pure functions of the checks, and the checks are a
 * pure function of the facts and the rules — so tuning a rule can only move
 * eligibility by changing what these return (B2).
 */

const NOW = new Date("2026-09-14T08:00:00Z");
const DAY = 86_400_000;

const claim = (over: Partial<ClaimFacts> = {}): ClaimFacts => ({
  kind: "claim",
  route: "licence_upload",
  authority: "DED",
  registerLicenceNumber: "DED-441908",
  registerExpiry: new Date(NOW.getTime() + 200 * DAY),
  statedLicenceNumber: "441908",
  ocrLicenceNumber: "DED 441908",
  statedLicenceExpiry: null,
  ocrLicenceExpiry: null,
  ocrConfidence: 0.92,
  detectedKind: "trade_licence",
  phone: null,
  recordPhones: [],
  closing: false,
  extraCheckTrade: null,
  ...over,
});

/** Every sentence resolves in the catalogue, with its params. */
function sentence(check: Check): string {
  const labels = Object.fromEntries(
    Object.entries(check.sentence.labels ?? {}).map(([name, key]) => [name, t(key as never)]),
  );
  return t(check.sentence.key as never, { ...check.sentence.params, ...labels });
}

describe("a claim", () => {
  it("passes when the licence is current, the file is a trade licence and the number matches", () => {
    const checks = checksFor(claim(), DEFAULT_RULES, NOW);
    expect(allPassed(checks)).toBe(true);
    expect(rowAction("claim", checks)).toBe("approve");
    expect(checks.map(sentence)).toContain("Trade licence uploaded");
  });

  it("warns on a licence expiring inside the window, and says how many days", () => {
    const checks = checksFor(claim({ registerExpiry: new Date(NOW.getTime() + 21 * DAY) }), DEFAULT_RULES, NOW);
    const expiry = checks.find((check) => check.rule === "licence_current")!;
    expect(expiry.outcome).toBe("warn");
    expect(sentence(expiry)).toBe("Licence expires in 21 days");
    expect(allPassed(checks)).toBe(false);
    expect(rowAction("claim", checks)).toBe("review");
  });

  it("asks for a document when the upload reads as a different one", () => {
    const checks = checksFor(claim({ detectedKind: "health_authority" }), DEFAULT_RULES, NOW);
    expect(sentence(checks.find((check) => check.rule === "document_type")!)).toBe(
      "Wrong document type detected: health authority licence",
    );
    expect(rowAction("claim", checks)).toBe("request_doc");
  });

  it("never lets a phone claim pass: somebody has to call", () => {
    const checks = checksFor(
      claim({ route: "phone_callback", phone: "+971 4 347 2290", recordPhones: ["04 347 2290"] }),
      DEFAULT_RULES,
      NOW,
    );
    expect(checks.find((check) => check.rule === "phone_on_record")!.outcome).toBe("pass");
    expect(allPassed(checks)).toBe(false);
  });

  it("rejects a claim on a business that is closing, and that rule cannot be switched off", () => {
    const checks = checksFor(claim({ closing: true }), { ...DEFAULT_RULES }, NOW);
    expect(rowAction("claim", checks)).toBe("reject");
    expect(rulesProblem({ ...DEFAULT_RULES, disabled: ["business_closing"] })).toBe("rule_not_switchable");
  });

  it("a switched-off rule is not evaluated, which is how tuning moves the pass rate", () => {
    const facts = claim({ detectedKind: null });
    expect(allPassed(checksFor(facts, DEFAULT_RULES, NOW))).toBe(false);
    const tuned: CheckRules = { ...DEFAULT_RULES, disabled: ["document_type"] };
    expect(allPassed(checksFor(facts, tuned, NOW))).toBe(true);
  });
});

describe("a profile edit", () => {
  const rename = (after: string, taken = false) =>
    checksFor(
      {
        kind: "profile_edit",
        field: "trade_name",
        before: "Zayed Facilities Management LLC",
        after,
        authority: "DED",
        nextSlug: "zayed-facilities-management-services-llc",
        slugTaken: taken,
        duplicateOf: null,
      },
      DEFAULT_RULES,
      NOW,
    );

  it("passes a rename that keeps the licensed name and a free address", () => {
    expect(allPassed(rename("Zayed Facilities Management Services LLC"))).toBe(true);
  });

  it("rejects a banned term as a word, not a substring", () => {
    expect(rowAction("profile_edit", rename("Zayed Official Facilities LLC"))).toBe("reject");
    expect(bannedTermIn("Bestway Trading", DEFAULT_RULES.bannedTerms)).toBeNull();
    expect(bannedTermIn("The Best Trading", DEFAULT_RULES.bannedTerms)).toBe("best");
  });

  it("asks for the amendment when the new name keeps little of the licensed one", () => {
    expect(rowAction("profile_edit", rename("Northwind Cleaning LLC"))).toBe("request_doc");
  });

  it("names a duplicate licence", () => {
    const checks = checksFor(
      { kind: "profile_edit", field: "licence", before: "DED-1", after: "DED-99881", authority: "DED", nextSlug: null, slugTaken: false, duplicateOf: "Gulf Star Trading" },
      DEFAULT_RULES,
      NOW,
    );
    expect(sentence(checks.find((check) => check.rule === "no_duplicate")!)).toBe("Already on Gulf Star Trading");
  });
});

describe("the other kinds", () => {
  it("a category the licence activity does not cover is a rejection", () => {
    const checks = checksFor(
      { kind: "category_change", field: "primary_category", categoryName: "Healthcare clinics", fitsLicence: false, tradeKindBefore: "goods", tradeKindAfter: "services", extraCheckTrade: null },
      DEFAULT_RULES,
      NOW,
    );
    expect(sentence(checks[0]!)).toBe("Licence activity doesn't cover Healthcare clinics");
    expect(rowAction("category_change", checks)).toBe("reject");
    expect(checks.some((check) => check.rule === "trade_kind")).toBe(true);
  });

  /*
     Board 4d's "Requires extra licence check". Present only where the taxonomy
     says so, never a pass, and it takes the row out of bulk approve — a clean
     claim into such a trade is no longer "every check passed".
  */
  it("a trade that requires an extra licence check sends a clean submission to a person", () => {
    const clean = checksFor(claim(), DEFAULT_RULES, NOW);
    expect(allPassed(clean)).toBe(true);
    expect(clean.some((check) => check.rule === "licence_extra_check")).toBe(false);

    const flagged = checksFor(claim({ extraCheckTrade: "Explosives & blasting" }), DEFAULT_RULES, NOW);
    const extra = flagged.find((check) => check.rule === "licence_extra_check");
    expect(extra?.outcome).toBe("warn");
    expect(sentence(extra!)).toBe("Explosives & blasting requires an extra licence check");
    expect(allPassed(flagged)).toBe(false);
    expect(rowAction("claim", flagged)).toBe("review");

    const moved = checksFor(
      { kind: "category_change", field: "additional_category", categoryName: "Explosives & blasting", fitsLicence: true, tradeKindBefore: null, tradeKindAfter: null, extraCheckTrade: "Explosives & blasting" },
      DEFAULT_RULES,
      NOW,
    );
    expect(allPassed(moved)).toBe(false);
    expect(rowAction("category_change", moved)).toBe("review");
  });

  it("the extra licence check cannot be tuned away", () => {
    expect(RULES.find((rule) => rule.id === "licence_extra_check")?.switchable).toBe(false);
  });

  it("a branch outside the licensed emirate names both", () => {
    const [check] = checksFor({ kind: "locations", emirate: "ras_al_khaimah", authority: "DMCC", branchLicenceNumber: null }, DEFAULT_RULES, NOW);
    expect(sentence(check!)).toBe("Ras Al Khaimah branch not on DMCC licence");
    expect(check!.outcome).toBe("fail");
  });

  it("a branch carrying its own licence passes", () => {
    const checks = checksFor({ kind: "locations", emirate: "ras_al_khaimah", authority: "DMCC", branchLicenceNumber: "RAK-9981" }, DEFAULT_RULES, NOW);
    expect(allPassed(checks)).toBe(true);
  });

  it("a conflict is never all passed and always opens for review", () => {
    const checks = checksFor({ kind: "conflict", claims: [{ route: "licence_upload" }, { route: "licence_upload" }] }, DEFAULT_RULES, NOW);
    expect(allPassed(checks)).toBe(false);
    expect(rowAction("conflict", checks)).toBe("review");
    expect(allPassed(checksFor({ kind: "conflict", claims: [] }, { ...DEFAULT_RULES, disabled: ["claim_evidence"] }, NOW))).toBe(false);
  });

  it("an expired credential is a rejection", () => {
    const checks = checksFor({ kind: "credential", displayName: "ISO 9001:2015", validUntil: new Date(NOW.getTime() - DAY), publishable: true }, DEFAULT_RULES, NOW);
    expect(rowAction("credential", checks)).toBe("reject");
  });
});

describe("a credential against the register (board 4c-s)", () => {
  const submitted = {
    identifier: "20034512",
    name: "Nexus Tax Consultancy LLC",
    expiresOn: null,
    licenceNumber: "DED-2298417",
    licenceAuthority: "DED",
  };
  const found = (over: Partial<Extract<RegisterFetch, { outcome: "found" }>["record"]> = {}, at = NOW): RegisterFetch => ({
    v: 1,
    asked: "20034512",
    fetchedAt: at.toISOString(),
    source: "FTA tax agent register",
    outcome: "found",
    record: {
      taan: "20034512",
      name: "Nexus Tax Consultancy L.L.C.",
      status: "active",
      validUntil: "2027-12-31",
      tradeLicence: { number: "2298417", authority: "DED" },
      ...over,
    },
  });
  const row = (read: RegisterFetch | null) =>
    checksFor({ kind: "register_credential", submitted, read }, DEFAULT_RULES, NOW);

  it("passes all four sentences on a fresh match, and names each field on its own", () => {
    const checks = row(found());
    expect(allPassed(checks)).toBe(true);
    expect(checks.map((check) => check.rule)).toEqual(["register_number", "register_name", "register_status", "register_entity"]);
    expect(checks.map(sentence)).toContain("Active on the register until 2027-12-31");
  });

  it("a near-match asks for a look, a lapse asks for a rejection", () => {
    expect(rowAction("credential", row(found({ name: "Nexus Tax Consultants LLC" })))).toBe("review");
    expect(rowAction("credential", row(found({ status: "expired" })))).toBe("reject");
    expect(sentence(row(found({ status: "suspended" })).find((check) => check.rule === "register_status")!)).toBe(
      "Register status: Suspended",
    );
  });

  it("a different licence fails the join even with three matches", () => {
    const checks = row(found({ tradeLicence: { number: "7713002", authority: "DED" } }));
    expect(allPassed(checks)).toBe(false);
    expect(sentence(checks.find((check) => check.rule === "register_entity")!)).toBe(
      "Register names licence 7713002, not this listing's",
    );
  });

  it("a stale read or a register that did not answer is never all passed", () => {
    expect(allPassed(row(found({}, new Date(NOW.getTime() - 2 * 3_600_000))))).toBe(false);
    expect(
      allPassed(row({ v: 1, asked: "20034512", fetchedAt: NOW.toISOString(), source: "x", outcome: "unavailable", cause: "timeout" })),
    ).toBe(false);
    expect(allPassed(row(null))).toBe(false);
  });

  it("none of the register checks can be switched off (B3)", () => {
    for (const id of ["register_answered", "register_number", "register_name", "register_status", "register_entity"] as const) {
      expect(RULES.find((rule) => rule.id === id)!.switchable).toBe(false);
      expect(rulesProblem({ ...DEFAULT_RULES, disabled: [id] })).toBe("rule_not_switchable");
    }
  });
});

describe("derived facts", () => {
  it("no checks is not all passed", () => {
    expect(allPassed([])).toBe(false);
  });

  it("orders failures first and colours by the worst", () => {
    const checks = checksFor(claim({ detectedKind: "vat_certificate", registerExpiry: new Date(NOW.getTime() + 5 * DAY) }), DEFAULT_RULES, NOW);
    expect(orderedChecks(checks)[0]!.outcome).toBe("fail");
    expect(worstOutcome(checks)).toBe("fail");
  });
});

describe("the rules setting", () => {
  it("parses terms from lines and commas", () => {
    expect(parseTerms(" Official,\nGOVERNMENT \n\n official")).toEqual(["official", "government"]);
  });

  it("falls back to the defaults on anything malformed", () => {
    expect(parseRules(null)).toEqual(DEFAULT_RULES);
    expect(parseRules({ expiryWarnDays: 999 })).toEqual(DEFAULT_RULES);
    expect(parseRules({ ...DEFAULT_RULES, expiryWarnDays: 14 }).expiryWarnDays).toBe(14);
  });
});
