import { isAccountState, type AccountState } from "./health";

/**
 * Board 4f — what a filter on `/admin/businesses` can mean.
 *
 * The URL is the filter. A saved segment stores the canonical query string this
 * file writes (`B8`), the export reads the same string back (`B9`), and the
 * page, the panels' "Open the list" links and the chip all build their links
 * here — so a segment saved from the chip and the chip itself cannot describe
 * the same view two ways.
 *
 * Everything arrives from a URL somebody can edit. A value this file does not
 * recognise is dropped, never passed through; the page then shows the view it
 * actually ran, not the one the address claimed.
 *
 * Pure, and tested in `tests/unit/accounts-filter.test.ts`.
 */

export const EMIRATES = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;
export type EmirateKey = (typeof EMIRATES)[number];

export const KINDS = ["goods", "services", "both", "unset"] as const;
export type KindKey = (typeof KINDS)[number];

export const SORTS = ["name", "reply_rate"] as const;
export type SortKey = (typeof SORTS)[number];

/** `none` is the unclaimed half of `B2`: no plan, which is not Free. */
export type PlanKey = string | "none";

export const PAGE_SIZE = 50;
/** A search longer than this is a paste, not a name or a number. */
const MAX_QUERY = 80;

export interface AccountFilter {
  q?: string;
  plan?: PlanKey;
  emirate?: EmirateKey;
  sector?: string;
  tier?: 0 | 1 | 2;
  health?: AccountState;
  kind?: KindKey;
  sort?: SortKey;
}

type Raw = Record<string, string | string[] | undefined | null>;

function one(raw: Raw, key: string): string | undefined {
  const value = raw[key];
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" ? text.trim() : undefined;
}

export function normaliseAccountFilter(raw: Raw): AccountFilter {
  const filter: AccountFilter = {};

  const q = one(raw, "q")?.replace(/\s+/g, " ");
  if (q) filter.q = q.slice(0, MAX_QUERY);

  const plan = one(raw, "plan");
  if (plan && /^[a-z0-9_-]{1,40}$/.test(plan)) filter.plan = plan;

  const emirate = one(raw, "emirate");
  if (emirate && (EMIRATES as readonly string[]).includes(emirate)) filter.emirate = emirate as EmirateKey;

  const sector = one(raw, "sector");
  if (sector && /^[a-z0-9]{8,40}$/.test(sector)) filter.sector = sector;

  const tier = one(raw, "tier");
  if (tier === "0" || tier === "1" || tier === "2") filter.tier = Number(tier) as 0 | 1 | 2;

  const health = one(raw, "health");
  if (health && isAccountState(health)) filter.health = health;

  const kind = one(raw, "kind");
  if (kind && (KINDS as readonly string[]).includes(kind)) filter.kind = kind as KindKey;

  const sort = one(raw, "sort");
  if (sort && (SORTS as readonly string[]).includes(sort) && sort !== "name") filter.sort = sort as SortKey;

  return filter;
}

/** A 1-based page, or 1. */
export function pageFrom(raw: Raw): number {
  const page = Number(one(raw, "page"));
  return Number.isSafeInteger(page) && page >= 1 && page <= 100_000 ? page : 1;
}

const ORDER: readonly (keyof AccountFilter)[] = ["q", "plan", "emirate", "sector", "tier", "health", "kind", "sort"];

/**
 * The canonical query string: keys in one order, empty values gone, no page.
 * Two filters that mean the same thing write the same string, which is what
 * lets a segment be recognised as the view already on screen.
 */
export function toQueryString(filter: AccountFilter, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams();
  for (const key of ORDER) {
    const value = filter[key];
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  return params.toString();
}

export function hasAnyFilter(filter: AccountFilter): boolean {
  return ORDER.some((key) => key !== "sort" && filter[key] !== undefined);
}

// ── Search ──────────────────────────────────────────────────────────────────

export interface SearchTerms {
  /** The words, for a name match. Null when the query is only a number. */
  name: string | null;
  /** Digits, for a licence-number or TRN match. Null when there are too few to mean one. */
  digits: string | null;
  /** The query as a stored licence number — `DED-441908`, from "ded 441908". */
  licence: string | null;
  /** Fifteen digits is a TRN; nothing shorter is. */
  trn: string | null;
}

/**
 * `B7`: the three identifiers an ops call starts from — a name, a licence
 * number, a TRN. A caller says "Gulf Cool, DED four-four-one-nine-oh-eight", so
 * one box takes all three and decides what each part could be.
 */
export function parseSearch(q: string | undefined): SearchTerms | null {
  if (!q) return null;
  const text = q.trim();
  if (text.length === 0) return null;

  const digits = text.replace(/\D/g, "");
  const letters = text.replace(/[^\p{Letter}]/gu, "");
  const isNumberish = /^[\p{Letter}]{0,6}[\s-]?[\d\s-]+$/u.test(text);

  return {
    name: letters.length >= 2 ? text : null,
    // Four digits is the shortest licence fragment worth a lookup; fewer
    // matches half the directory by suffix.
    digits: digits.length >= 4 ? digits : null,
    // Stored as `DED-441908`; a caller says "DED 441908".
    licence: isNumberish && digits.length >= 4 ? text.toUpperCase().replace(/[\s-]+/g, "-") : null,
    trn: digits.length === 15 ? digits : null,
  };
}
