import { describe, expect, it } from "vitest";
import {
  canonicalName,
  compareCredential,
  compareNames,
  mayDecide,
  mayVerify,
  nameDiff,
  suggestedReason,
  supportedReasons,
  type Submitted,
} from "./compare";
import { fetchTaxAgent, registerMode } from "./fta";
import { FIXTURE_FIRMS } from "./fta-fixture";
import { parseRegisterFetch, REGISTER_FRESH_MS, type RegisterFetch } from "./register-fetch";

/**
 * Board `4c-s` — the comparison the whole screen hangs on.
 *
 * "Three fields that either match or do not" is only true if the three are
 * decided in one place and the entity join is never counted among them. These
 * pin both, and pin the states the board lists against the fixture register
 * the seed is built from.
 */

const NOW = new Date("2026-09-14T05:14:00Z"); // 09:14 in Dubai

const nexus: Submitted = {
  identifier: "20034512",
  name: "Nexus Tax Consultancy LLC",
  expiresOn: new Date("2027-12-31T00:00:00Z"),
  licenceNumber: "DED-2298417",
  licenceAuthority: "DED",
};

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const LOOPBACK = env({ FTA_REGISTER_URL: "fixture", DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });

async function read(number: string, at = NOW): Promise<RegisterFetch> {
  return fetchTaxAgent(number, at, LOOPBACK);
}

function firm(state: (typeof FIXTURE_FIRMS)[number]["state"]) {
  const row = FIXTURE_FIRMS.find((candidate) => candidate.state === state)!;
  return { ...nexus, identifier: row.taan, name: row.tradeName, licenceNumber: row.licence, expiresOn: null };
}

describe("names", () => {
  it("treats the spelling of the legal form and punctuation as the same name", () => {
    expect(canonicalName("Nexus Tax Consultancy L.L.C.")).toBe(canonicalName("Nexus Tax Consultancy LLC"));
    expect(canonicalName("Summit Tax & Zakat")).toBe(canonicalName("Summit Tax and Zakat"));
    expect(compareNames("Nexus Tax Consultancy LLC", "NEXUS TAX CONSULTANCY L.L.C.")).toBe("match");
  });

  it("keeps the words that make two companies two", () => {
    expect(compareNames("Al Noor Trading LLC", "Al Noor General Trading LLC")).not.toBe("match");
  });

  it("calls a shared majority a near-match and marks only the words that differ", () => {
    expect(compareNames("Al Bayan Tax Advisory LLC", "Al Bayan Tax Consultants LLC")).toBe("near");
    const diff = nameDiff("Al Bayan Tax Advisory LLC", "Al Bayan Tax Consultants LLC");
    expect(diff.a.filter((word) => word.differs).map((word) => word.text)).toEqual(["Advisory"]);
    expect(diff.b.filter((word) => word.differs).map((word) => word.text)).toEqual(["Consultants"]);
  });

  it("calls an unrelated name a mismatch", () => {
    expect(compareNames("Nexus Tax Consultancy LLC", "Northwind Cleaning LLC")).toBe("mismatch");
  });
});

describe("the register", () => {
  it("honours the fixture only against a loopback database outside production", () => {
    expect(registerMode(LOOPBACK)).toBe("fixture");
    expect(registerMode({ ...LOOPBACK, VERCEL_ENV: "production" })).toBe("off");
    expect(
      registerMode(env({ FTA_REGISTER_URL: "fixture", DATABASE_URL: "postgresql://u:p@db.example.supabase.co:5432/postgres" })),
    ).toBe("off");
    expect(registerMode(env({}))).toBe("off");
  });

  it("answers not configured, never not found, when nothing is wired up", async () => {
    const fetch = await fetchTaxAgent("20034512", NOW, env({}));
    expect(fetch).toMatchObject({ outcome: "unavailable", cause: "not_configured" });
  });

  it("refuses a body that does not parse rather than calling it a match", async () => {
    const http = env({ FTA_REGISTER_URL: "https://register.example" });
    const body = async () => new Response(JSON.stringify({ taan: "20034512" }), { status: 200 });
    expect(await fetchTaxAgent("20034512", NOW, http, body as typeof fetch)).toMatchObject({
      outcome: "unavailable",
      cause: "bad_response",
    });
    const missing = async () => new Response(null, { status: 404 });
    expect(await fetchTaxAgent("20034512", NOW, http, missing as typeof fetch)).toMatchObject({ outcome: "not_found" });
    const down = async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    };
    expect(await fetchTaxAgent("20034512", NOW, http, down as typeof fetch)).toMatchObject({ cause: "timeout" });
  });

  it("stores a read that parses back to itself", async () => {
    const fetch = await read("20034512");
    expect(parseRegisterFetch(JSON.parse(JSON.stringify(fetch)))).toEqual(fetch);
    expect(parseRegisterFetch({ outcome: "found" })).toBeNull();
  });
});

describe("the states the board lists", () => {
  it("as drawn: three fields match and the licence names the same entity", async () => {
    const comparison = compareCredential(nexus, await read("20034512"), NOW);
    expect(comparison.state).toBe("found");
    if (comparison.state !== "found") return;
    expect(comparison.matched).toBe(3);
    expect(comparison.entity).toBe("same");
    expect(mayVerify(comparison)).toBe(true);
    expect(suggestedReason(comparison)).toBeNull();
  });

  it("a stale read decides nothing until it is fetched again (B2)", async () => {
    const stale = await read("20034512", new Date(NOW.getTime() - REGISTER_FRESH_MS - 60_000));
    const comparison = compareCredential(nexus, stale, NOW);
    expect(mayVerify(comparison)).toBe(false);
    expect(mayDecide(comparison)).toBe(false);
    expect(supportedReasons(comparison, true).size).toBe(0);
  });

  it("register unreachable: no decision offered", async () => {
    const comparison = compareCredential(firm("unreachable"), await read("20000004"), NOW);
    expect(comparison.state).toBe("unavailable");
    expect(mayDecide(comparison)).toBe(false);
  });

  it("number does not resolve: verify unavailable, not-on-register pre-selected", async () => {
    const comparison = compareCredential(firm("not_found"), await read("20099881"), NOW);
    expect(comparison.state).toBe("not_found");
    expect(mayVerify(comparison)).toBe(false);
    expect(suggestedReason(comparison)).toBe("not_on_register");
    expect([...supportedReasons(comparison, false)]).toEqual(["not_on_register"]);
  });

  it("name near-match: two of three, no verify, and no rejection pre-selected — the judgement case", async () => {
    const comparison = compareCredential(firm("near_match"), await read("20051877"), NOW);
    if (comparison.state !== "found") throw new Error("expected a record");
    expect(comparison.name.verdict).toBe("near");
    expect(comparison.matched).toBe(2);
    expect(mayVerify(comparison)).toBe(false);
    expect(mayDecide(comparison)).toBe(true);
    expect(suggestedReason(comparison)).toBeNull();
    expect(supportedReasons(comparison, false).has("different_entity")).toBe(true);
  });

  it("resolves to a different entity: the three matching does not save it", async () => {
    const comparison = compareCredential(firm("different_entity"), await read("20062210"), NOW);
    if (comparison.state !== "found") throw new Error("expected a record");
    expect(comparison.matched).toBe(3);
    expect(comparison.entity).toBe("different");
    expect(comparison.allMatch).toBe(false);
    expect(suggestedReason(comparison)).toBe("different_entity");
  });

  it("lapsed on the register: reject with lapsed, and lapsed is only offered when the register says so", async () => {
    const lapsed = compareCredential(firm("lapsed"), await read("20017733"), NOW);
    expect(suggestedReason(lapsed)).toBe("lapsed");
    expect(supportedReasons(lapsed, false).has("lapsed")).toBe(true);
    const active = compareCredential(nexus, await read("20034512"), NOW);
    expect(supportedReasons(active, true).has("lapsed")).toBe(false);
  });

  it("a certificate that contradicts an active register entry is not a match", async () => {
    const summit = { ...firm("more_info"), expiresOn: new Date("2027-12-31T00:00:00Z") };
    const comparison = compareCredential(summit, await read("20040619"), NOW);
    if (comparison.state !== "found") throw new Error("expected a record");
    expect(comparison.status.verdict).toBe("contradicts");
    expect(mayVerify(comparison)).toBe(false);
  });

  it("a read of a number the seller has since changed is no read of this credential", async () => {
    const comparison = compareCredential({ ...nexus, identifier: "20051877" }, await read("20034512"), NOW);
    expect(comparison.state).toBe("no_read");
  });

  it("no agent number is nothing to ask about", () => {
    expect(compareCredential({ ...nexus, identifier: null }, null, NOW).state).toBe("no_number");
    expect(compareCredential({ ...nexus, identifier: "CN-2298417" }, null, NOW).state).toBe("no_number");
  });
});
