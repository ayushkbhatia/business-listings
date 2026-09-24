import { describe, expect, it } from "vitest";
import {
  ASK_QUESTION_MAX,
  ASK_WHY_MAX,
  MAX_ASKS,
  PLURAL_MAX,
  servicesLandingProblems,
  tidy,
  writtenAsks,
} from "./services-landing-rules";

/**
 * Board `6a-s` — the rules on a services trade's page wording, which the panel
 * shows under a field and the service refuses with. The migration's CHECKs are
 * the floor under both; these are the sentences above it.
 */

const ok = { pluralHuman: "VAT consultants", credentialKind: "fta_tax_agent", asks: [] };

describe("servicesLandingProblems", () => {
  it("accepts the board's own wording", () => {
    expect(
      servicesLandingProblems({
        ...ok,
        asks: [{ question: "Are you a registered FTA tax agent?", why: "Only an agent can deal with the authority in your name." }],
      }),
    ).toEqual([]);
  });

  it("allows an empty noun, which falls back to the trade's name", () => {
    expect(servicesLandingProblems({ ...ok, pluralHuman: "   " })).toEqual([]);
  });

  it("refuses a noun too short to open an H1, and one too long to fit it", () => {
    expect(servicesLandingProblems({ ...ok, pluralHuman: "V" })).toEqual(["plural_too_short"]);
    expect(servicesLandingProblems({ ...ok, pluralHuman: "x".repeat(PLURAL_MAX + 1) })).toEqual(["plural_too_long"]);
  });

  it("refuses a credential kind the platform does not record", () => {
    expect(servicesLandingProblems({ ...ok, credentialKind: "trade_licence" })).toEqual(["credential_unknown"]);
    expect(servicesLandingProblems({ ...ok, credentialKind: null })).toEqual([]);
  });

  it("refuses a fourth question — B9 draws three", () => {
    const asks = Array.from({ length: MAX_ASKS + 1 }, (_, n) => ({ question: `Q${n}?`, why: "Because." }));
    expect(servicesLandingProblems({ ...ok, asks })).toContain("too_many_asks");
  });

  it("refuses a question without its reason, and either past its length", () => {
    expect(servicesLandingProblems({ ...ok, asks: [{ question: "Why?", why: "  " }] })).toEqual(["ask_empty"]);
    expect(
      servicesLandingProblems({ ...ok, asks: [{ question: "Q".repeat(ASK_QUESTION_MAX + 1), why: "W" }] }),
    ).toEqual(["ask_question_too_long"]);
    expect(
      servicesLandingProblems({ ...ok, asks: [{ question: "Q?", why: "W".repeat(ASK_WHY_MAX + 1) }] }),
    ).toEqual(["ask_why_too_long"]);
  });

  it("measures what the page will print — runs of whitespace collapsed", () => {
    expect(tidy("  VAT \\n  consultants  ".replace("\\n", "\n"))).toBe("VAT consultants");
  });
});

describe("writtenAsks", () => {
  it("drops a row with neither half written, and keeps half a row for the rules to refuse", () => {
    const rows = [
      { question: "  Are you an agent? ", why: "Only an agent  files for you." },
      { question: "   ", why: "" },
      { question: "Who signs?", why: "  " },
    ];
    expect(writtenAsks(rows)).toEqual([
      { question: "Are you an agent?", why: "Only an agent files for you." },
      { question: "Who signs?", why: "" },
    ]);
    expect(servicesLandingProblems({ ...ok, asks: writtenAsks(rows) })).toEqual(["ask_empty"]);
  });

  it("leaves nothing to refuse when the only row added is still blank", () => {
    expect(servicesLandingProblems({ ...ok, asks: writtenAsks([{ question: "", why: "" }]) })).toEqual([]);
  });
});
