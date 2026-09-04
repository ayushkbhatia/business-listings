import { parseUaePhone, toE164 } from "@/lib/format/phone";
import type { LocationType } from "@/lib/db/generated/enums";

/**
 * Board 2d's field rules, with no database and no `server-only` above them.
 *
 * Split out from `lib/onboarding/locations.ts` for the reason board 2c's
 * `profile-fields.ts` was: the branch card runs in the browser and needs the
 * same limits, the same validators and the same readiness test the server
 * enforces. Importing them from the service would pull `server-only` — and with
 * it `pg` — into the client bundle, which surfaces as a wall of unresolved
 * `net`/`dns`/`fs` and takes an afternoon to trace back to one import.
 *
 * Types are erased at that boundary. Values are not.
 */

/* ── The five branch kinds, and the sixth ────────────────────────────────── */

/**
 * The order a seller thinks in: the place they run the business from, then the
 * places they keep or sell stock, then the office.
 *
 * The board draws five — *Head office · Workshop · Warehouse · Showroom · Yard*
 * — and the schema has carried six since handoff 1. The schema's are the ones
 * already grouped on board `1f`, already labelled in `lib/i18n/en.ts`, and
 * already written on every seeded listing; `trade_counter` is the board's
 * showroom and `depot` is its yard under names this codebase settled on before
 * the render existed. Re-cutting a public enum to change the words on five rows
 * is a migration and a rewrite of every seller's answer for nothing a buyer can
 * see.
 *
 * `sales_office` is the one that carries weight beyond a label: `isStocking`
 * excludes it, so a buyer is never sent to an office expecting a trade counter.
 */
export const BRANCH_TYPES: readonly LocationType[] = [
  "head_office",
  "workshop",
  "warehouse",
  "trade_counter",
  "depot",
  "sales_office",
];

export function isBranchType(value: string): value is LocationType {
  return (BRANCH_TYPES as readonly string[]).includes(value);
}

/* ── The service radius ──────────────────────────────────────────────────── */

/**
 * 40 km is the render's figure and a reasonable default for this market: it
 * reaches most of Dubai from Al Quoz and Sharjah's industrial areas from
 * Al Qusais, which is the trade most of these suppliers actually do.
 *
 * The floor is 1 rather than 0 because "I deliver zero kilometres" is not a
 * delivery promise, it is the absence of one — and the absence of one is `null`,
 * which the field already supports and which `coverageOf` on board `1f` reads as
 * "no card" rather than as a claim.
 *
 * The ceiling is 500 because the UAE is about 650 km at its longest and a
 * radius past 400 from anywhere inside it already covers the country. Above
 * that the number stops meaning anything, and a supplier who genuinely ships
 * beyond the border is describing export, which is a sentence for the delivery
 * note rather than a circle on a map.
 */
export const RADIUS_DEFAULT = 40;
export const RADIUS_MIN = 1;
export const RADIUS_MAX = 500;

export function clampRadius(km: number): number {
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(km)));
}

/** A typed radius, or null for "we do not deliver from here". */
export function parseRadius(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits === "") return null;
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? clampRadius(value) : null;
}

/* ── The pin ─────────────────────────────────────────────────────────────── */

/**
 * Six decimals, which is about 11 cm at this latitude.
 *
 * The map hands back a float with fifteen, and the extra nine describe the
 * floating-point representation rather than the gate. Rounding on the way in
 * means two sellers who dropped the pin on the same spot store the same number,
 * and a diff of a branch row does not churn on noise.
 */
export function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * The country, generously bounded.
 *
 * A pin outside this is a mis-drag or a bad paste, not a UAE branch, and storing
 * it would put a supplier's marker in the Gulf of Oman on board `1c`'s map. The
 * box is deliberately loose — it includes water and a margin over the Saudi and
 * Omani borders — because refusing a legitimate pin near Al Ain is worse than
 * accepting one 20 km offshore, and the seller can see where they put it.
 */
export const UAE_BOUNDS = { minLat: 22.0, maxLat: 26.6, minLng: 51.0, maxLng: 56.7 } as const;

export function withinUae(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= UAE_BOUNDS.minLat &&
    lat <= UAE_BOUNDS.maxLat &&
    lng >= UAE_BOUNDS.minLng &&
    lng <= UAE_BOUNDS.maxLng
  );
}

/* ── The two numbers ─────────────────────────────────────────────────────── */

export type PhoneProblem = "not_a_number" | "not_a_landline" | "not_a_mobile";

export type PhoneCheck =
  | { ok: true; value: string }
  | { ok: true; value: null }
  | { ok: false; problem: PhoneProblem };

/**
 * The branch landline. An area code is the point of it.
 *
 * `04 340 6688` is what a buyer dials from Deira and what tells them this
 * supplier is in Dubai rather than in Sharjah. A mobile in this field would
 * pass a naive "is it digits" check and lose that, so the kind is what is
 * tested and not the length. Toll-free is allowed: an 800 number is a real
 * switchboard for a business that has one.
 *
 * Stored as the seller typed it, formatted for display by `formatPhone`. The
 * WhatsApp number is the one stored canonically, because it is the one an API
 * has to dial.
 */
export function checkLandline(raw: string): PhoneCheck {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  const parsed = parseUaePhone(trimmed);
  if (!parsed) return { ok: false, problem: "not_a_number" };
  if (parsed.kind === "mobile" || parsed.kind === "unknown") {
    return { ok: false, problem: "not_a_landline" };
  }
  return { ok: true, value: trimmed };
}

/**
 * WhatsApp, in E.164.
 *
 * A mobile, because that is what WhatsApp reaches — the button on `1f` opens
 * `wa.me/<number>` and a landline there is a dead link the seller never finds
 * out about. Stored with the country code because the link needs it and because
 * `0501234567` is ambiguous the moment anything reads it from outside the UAE.
 */
export function checkWhatsApp(raw: string): PhoneCheck {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  const parsed = parseUaePhone(trimmed);
  if (!parsed) return { ok: false, problem: "not_a_number" };
  if (parsed.kind !== "mobile") return { ok: false, problem: "not_a_mobile" };

  const e164 = toE164(trimmed);
  return e164 ? { ok: true, value: e164 } : { ok: false, problem: "not_a_number" };
}

/* ── Whether this branch can be published ────────────────────────────────── */

/** What a branch is still missing. Ordered the way the card reads. */
export const BRANCH_GAPS = ["area", "address", "contact", "pin"] as const;
export type BranchGap = (typeof BRANCH_GAPS)[number];

export interface BranchFacts {
  areaId: string | null;
  addressLine: string;
  phone: string | null;
  whatsapp: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Criterion 3: a branch is pinned when it has both coordinates.
 *
 * Derived, never stored. A boolean column beside the two floats is a third
 * thing to keep in step with them, and it would go stale the first time a pin
 * was cleared by anything that did not know about it.
 */
export function isPinned(branch: Pick<BranchFacts, "lat" | "lng">): boolean {
  return branch.lat !== null && branch.lng !== null;
}

/**
 * Criterion 4: what `Continue to plans` checks.
 *
 * An emirate is not in the list because it is not a field — it comes off the
 * chosen area, so an area implies one and the two cannot disagree. Hours are
 * deliberately absent: criterion 5 says a branch with none renders
 * `Hours not provided` on `1f`, which is honest and fixable later, and a step
 * that refused on them would be asking for work the page itself calls optional.
 *
 * A pin *is* in the list. Without one the listing cannot appear on the area page
 * that publishing it is for, cannot be measured for the near-me sort, and is
 * filtered out of the results map by a predicate rather than by a component —
 * so an unpinned branch is not a slightly worse listing, it is an absent one.
 */
export function branchGaps(branch: BranchFacts): BranchGap[] {
  const gaps: BranchGap[] = [];
  if (!branch.areaId) gaps.push("area");
  if (branch.addressLine.trim() === "") gaps.push("address");
  if (!branch.phone?.trim() && !branch.whatsapp?.trim()) gaps.push("contact");
  if (!isPinned(branch)) gaps.push("pin");
  return gaps;
}

export function branchIsReady(branch: BranchFacts): boolean {
  return branchGaps(branch).length === 0;
}

/* ── The counter above the add button ────────────────────────────────────── */

export interface LocationAllowance {
  used: number;
  /** Null is unlimited. */
  cap: number | null;
  planName: string;
  /** Criterion 2: false on Free, where the control becomes an upgrade link. */
  canAddMore: boolean;
}

/**
 * `1 of 3 locations used on Basic`.
 *
 * The counter grammar board 2c settled on — used over allowed, plan named — and
 * the render's own second correction. It read `Branch 2 of 3 available on your
 * plan`, which can be parsed as either an allowance or a position and is
 * therefore neither.
 *
 * The cap counts every branch, unlike the category counter next door, which
 * counts extras beyond the primary. Both are right on their own screen because
 * a primary category is a thing you are given and a first branch is a thing you
 * add.
 */
export function locationAllowance(
  cap: number | null,
  planName: string,
  used: number,
): LocationAllowance {
  return {
    used,
    cap,
    planName,
    canAddMore: cap === null || used < cap,
  };
}
