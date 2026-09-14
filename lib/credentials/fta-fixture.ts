import type { RegisterRecord } from "./register-fetch";

/**
 * A stand-in FTA register, for a loopback database only — board `4c-s`.
 *
 * There is no FTA API on this platform (see `./fta.ts`), and a review screen
 * whose right-hand column can never load is a screen nobody can click through,
 * test in a browser or render in the gallery in any state but "unreachable".
 * So `FTA_REGISTER_URL=fixture` answers from this table — and only where the
 * database is loopback, by the same gate that closes `/dev` in production. On
 * Vercel the fixture is refused and the register reads as not configured.
 *
 * Dates sit well past today so the fixture does not lapse under its own seed;
 * the one lapsed entry is lapsed by its status, not by the calendar.
 *
 * Each entry is one of the states the board lists, and `prisma/seed-credential-
 * review.mts` builds its firms from the same rows, so the seed and the register
 * cannot drift apart: the trade name on the listing and the name on the
 * register differ exactly where the state needs them to.
 */

export interface FixtureFirm {
  /** Which of the board's states this firm exists to show. */
  state: "match" | "near_match" | "different_entity" | "lapsed" | "not_found" | "unreachable" | "more_info" | "verified";
  tradeName: string;
  licence: string;
  taan: string;
  /** What the register holds. Null where the register holds nothing. */
  record: RegisterRecord | null;
}

export const FIXTURE_FIRMS: readonly FixtureFirm[] = [
  {
    state: "match",
    tradeName: "Nexus Tax Consultancy LLC",
    licence: "DED-2298417",
    taan: "20034512",
    record: {
      taan: "20034512",
      name: "Nexus Tax Consultancy L.L.C.",
      status: "active",
      validUntil: "2027-12-31",
      tradeLicence: { number: "2298417", authority: "DED" },
    },
  },
  {
    state: "near_match",
    tradeName: "Al Bayan Tax Advisory LLC",
    licence: "DED-1187204",
    taan: "20051877",
    record: {
      taan: "20051877",
      name: "Al Bayan Tax Consultants LLC",
      status: "active",
      validUntil: "2028-03-31",
      tradeLicence: { number: "1187204", authority: "DED" },
    },
  },
  {
    state: "different_entity",
    tradeName: "Crescent Accounting LLC",
    licence: "DED-7713900",
    taan: "20062210",
    record: {
      taan: "20062210",
      name: "Crescent Accounting LLC",
      status: "active",
      validUntil: "2028-06-30",
      tradeLicence: { number: "7713002", authority: "DED" },
    },
  },
  {
    state: "lapsed",
    tradeName: "Harbour Ledger Tax Services LLC",
    licence: "DED-5540187",
    taan: "20017733",
    record: {
      taan: "20017733",
      name: "Harbour Ledger Tax Services LLC",
      status: "expired",
      validUntil: "2026-06-30",
      tradeLicence: { number: "5540187", authority: "DED" },
    },
  },
  {
    state: "not_found",
    tradeName: "Oasis Books & Tax LLC",
    licence: "DED-6620931",
    taan: "20099881",
    record: null,
  },
  {
    state: "unreachable",
    tradeName: "Gulfline VAT Partners LLC",
    licence: "DED-3308812",
    taan: "20000004",
    record: null,
  },
  {
    state: "more_info",
    tradeName: "Summit Tax & Zakat Consultancy LLC",
    licence: "DED-4471260",
    taan: "20040619",
    record: {
      taan: "20040619",
      name: "Summit Tax & Zakat Consultancy LLC",
      status: "active",
      validUntil: "2028-01-31",
      tradeLicence: { number: "4471260", authority: "DED" },
    },
  },
  {
    state: "verified",
    tradeName: "Pinnacle Audit & Tax LLC",
    licence: "DED-8801543",
    taan: "20028841",
    record: {
      taan: "20028841",
      name: "Pinnacle Audit & Tax LLC",
      status: "active",
      validUntil: "2028-09-30",
      tradeLicence: { number: "8801543", authority: "DED" },
    },
  },
];

/**
 * Numbers beginning `2000000` never answer, so the unreachable state can be
 * reached on purpose — on a refetch as much as on the first read.
 */
export function fixtureUnreachable(number: string): boolean {
  return number.startsWith("2000000");
}

export function fixtureRecord(number: string): RegisterRecord | null {
  return FIXTURE_FIRMS.find((firm) => firm.record?.taan === number)?.record ?? null;
}
