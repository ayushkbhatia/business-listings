import { en, type MessageKey } from "./en";
import { interpolate } from "./t";
import type { Params } from "./types";

/**
 * Board `12g-s` — paired strings.
 *
 * One product speaks to two kinds of business by reading a different half of
 * the same key: a firm that sells work reads *What clients said* where a
 * stockist reads *What buyers said*. This file is where a pair is declared, and
 * the only place.
 *
 * ## What a pair is here, and what it is not
 *
 * A pair is **one control on one screen that both kinds see**, whose words
 * change with the kind of business being rendered. The services track also
 * built whole screens a firm that sells work gets instead of the goods one —
 * `/dashboard/services` beside `/dashboard/products`, its own composer, its
 * own nav rail. Those fork rather than swap, their words are single-valued,
 * and they are not in here. The handoff's *214* is the design canvas's count;
 * this registry's count is this codebase's, and the board prints that.
 *
 * ## Where each half comes from
 *
 * The code default is declared below: the goods half is always a catalogue
 * key, and the services half is a catalogue key, `"missing"` or
 * `"suppressed"`. A `StringEntry` row written from `/admin/strings/paired`
 * overrides one half without a deploy, and deleting the row restores the
 * default. The registry is what keeps that honest: a row can only exist for a
 * key declared here (`B10`), a written value may only use the placeholders the
 * consumer supplies, and `surfaces` says which boards read it (`B4`) —
 * `paired.test.ts` holds every `consumers` file to actually reading the key.
 *
 * ## The two states that carry no words (`B2`)
 *
 * - **missing** — nobody has written the half. It renders the goods words and
 *   is counted against the pairing figure. Never blank.
 * - **suppressed** — a decision that the control does not exist for this kind.
 *   It resolves to `null`, and the consumer removes the control.
 */

export type TradeHalf = "goods" | "services";

/** A half's code default. */
export type HalfDefault = MessageKey | "missing" | "suppressed";

export interface PairedString {
  /** The key the store knows the pair by, and the goods half's catalogue key. */
  key: MessageKey;
  services: HalfDefault;
  /** Board ids that read it — the BOARD column. */
  surfaces: readonly string[];
  /** Files that read it, relative to the repository root. */
  consumers: readonly string[];
  /** The placeholders the consumer supplies. A written half may use no others. */
  params: readonly string[];
  /** Halves a person may decide do not exist. Suppressing the goods half is never offered. */
  suppressible: boolean;
}

export const PAIRED_STRINGS = [
  // ── 1d amendment · the contact reveal ──────────────────────────────────────
  {
    key: "contact.reveal_note",
    // Identical words today. Listed because an unpaired key is invisible to the count, not because the wording differs.
    services: "contact.reveal_note_services",
    surfaces: ["1d", "1d-s"],
    consumers: ["lib/contact/storefront.ts"],
    params: [],
    suppressible: false,
  },
  // ── 5c-s · the shared storefront sections ──────────────────────────────────
  {
    key: "section.hero.enquire",
    services: "storefront.request_quote",
    surfaces: ["5c-s"],
    consumers: ["components/storefront/Hero.tsx", "components/storefront/EnquiryForm.tsx"],
    params: [],
    suppressible: false,
  },
  {
    key: "section.enquiry.title",
    services: "storefront_services.composer.title",
    // The shared section's heading, and the same composer's heading wherever a firm that sells work is enquired of.
    surfaces: ["5c-s", "1d-s", "1e-s", "1f-s"],
    consumers: [
      "components/storefront/EnquiryForm.tsx",
      "app/(public)/b/[slug]/_services.tsx",
      "app/(public)/b/[slug]/page.tsx",
      "app/(public)/b/[slug]/services/page.tsx",
      "app/(public)/b/[slug]/s/[service]/page.tsx",
    ],
    params: [],
    suppressible: false,
  },
  {
    key: "section.enquiry.default_intro",
    services: "section.enquiry.default_intro_services",
    surfaces: ["5c-s"],
    consumers: ["components/storefront/EnquiryForm.tsx"],
    params: [],
    suppressible: false,
  },
  {
    key: "section.reviews.title",
    services: "section.reviews.title_services",
    surfaces: ["5c-s"],
    consumers: ["components/storefront/Reviews.tsx"],
    params: [],
    suppressible: false,
  },
  // ── 1c-s · blended search ──────────────────────────────────────────────────
  {
    key: "search_blended.view_storefront",
    services: "search_blended.view_firm",
    surfaces: ["1c-s"],
    consumers: ["components/domain/BlendedResultRows.tsx"],
    params: [],
    suppressible: false,
  },
  // ── 3b-s · the listing profile ─────────────────────────────────────────────
  {
    key: "listing.description",
    services: "listing.description_services",
    surfaces: ["3b", "3b-s"],
    consumers: ["app/(dashboard)/dashboard/listing/page.tsx"],
    params: [],
    suppressible: false,
  },
  // ── 8a-s · the setup hub ───────────────────────────────────────────────────
  {
    key: "setup.levers_title",
    services: "setup.weights_title",
    surfaces: ["8a", "8a-s"],
    consumers: ["app/(dashboard)/dashboard/setup/page.tsx"],
    params: [],
    suppressible: false,
  },
  {
    key: "setup.lever.identity",
    services: "setup.lever.identity_services",
    surfaces: ["8a", "8a-s"],
    consumers: ["app/(dashboard)/dashboard/setup/page.tsx"],
    params: [],
    suppressible: false,
  },
  // ── 3a · the dashboard's missed enquiries ──────────────────────────────────
  /*
     Two gaps, and real ones. A firm that sells work has no catalogue, and the
     line under its missed-enquiry panel says an enquiry "matched your
     catalogue". Declared missing rather than given a twin here: the words are
     the kind a person writes from the console, which is the point of it.
  */
  {
    key: "overview.missed_body_one",
    services: "missing",
    surfaces: ["3a"],
    consumers: ["app/(dashboard)/dashboard/page.tsx"],
    params: ["cap", "plan"],
    suppressible: false,
  },
  {
    key: "overview.missed_body",
    services: "missing",
    surfaces: ["3a"],
    consumers: ["app/(dashboard)/dashboard/page.tsx"],
    params: ["n", "cap", "plan"],
    suppressible: false,
  },
  // ── 11f · 11h · CSV import, which a firm that sells work has nothing to put through ──
  {
    key: "change.row.csv_import",
    services: "suppressed",
    surfaces: ["11f", "11d"],
    consumers: ["app/(dashboard)/dashboard/billing/change/page.tsx"],
    params: [],
    suppressible: true,
  },
  {
    key: "cancel.row.csv_import",
    services: "suppressed",
    surfaces: ["11h", "11d"],
    consumers: ["lib/billing/cancellation.ts"],
    params: [],
    suppressible: true,
  },
] as const satisfies readonly PairedString[];

export type PairedKey = (typeof PAIRED_STRINGS)[number]["key"];

/** The keys a consumer may find suppressed, and must handle as `null`. */
export type SuppressibleKey = Extract<(typeof PAIRED_STRINGS)[number], { suppressible: true }>["key"];

const BY_KEY = new Map<string, PairedString>(PAIRED_STRINGS.map((entry) => [entry.key, entry]));

export function pairedEntry(key: string): PairedString | undefined {
  return BY_KEY.get(key);
}

export const PAIRED_LOCALE = "en";

// ── Resolution ────────────────────────────────────────────────────────────────

export type HalfState = "written" | "missing" | "suppressed";

/** A `StringEntry` row as the resolver needs it. Dates may arrive as strings from a data cache. */
export interface EntryRow {
  key: string;
  kind: "single" | "goods" | "services";
  state: HalfState;
  value: string | null;
  updatedAt: Date | string;
}

export interface ResolvedHalf {
  state: HalfState;
  /** The words it renders: its own, the goods words when missing, or null when suppressed. */
  template: string | null;
  /** Where the decision came from. */
  source: "code" | "staff";
}

function catalogue(key: MessageKey): string {
  const value = en[key];
  // The registry test holds every half to a plain string; this keeps the type honest if one slips.
  return typeof value === "string" ? value : value.other;
}

function rowFor(rows: readonly EntryRow[], key: string, half: TradeHalf): EntryRow | undefined {
  return rows.find((row) => row.key === key && row.kind === half);
}

/** The goods half, which is never missing: the catalogue always holds it. */
function goodsHalf(entry: PairedString, rows: readonly EntryRow[]): ResolvedHalf {
  const row = rowFor(rows, entry.key, "goods");
  if (row?.state === "written" && row.value !== null) return { state: "written", template: row.value, source: "staff" };
  return { state: "written", template: catalogue(entry.key), source: "code" };
}

export function resolveHalf(entry: PairedString, half: TradeHalf, rows: readonly EntryRow[]): ResolvedHalf {
  const goods = goodsHalf(entry, rows);
  if (half === "goods") return goods;

  const row = rowFor(rows, entry.key, "services");
  if (row) {
    if (row.state === "written" && row.value !== null) return { state: "written", template: row.value, source: "staff" };
    if (row.state === "suppressed" && entry.suppressible) return { state: "suppressed", template: null, source: "staff" };
    if (row.state === "missing") return { state: "missing", template: goods.template, source: "staff" };
  }
  if (entry.services === "suppressed") return { state: "suppressed", template: null, source: "code" };
  if (entry.services === "missing") return { state: "missing", template: goods.template, source: "code" };
  return { state: "written", template: catalogue(entry.services), source: "code" };
}

/** One half's words for every pair, as plain data a client component can receive. */
export type PairedCopy = { readonly [K in PairedKey]: K extends SuppressibleKey ? string | null : string };

export interface PairedCopies {
  goods: PairedCopy;
  services: PairedCopy;
}

function copyFor(half: TradeHalf, rows: readonly EntryRow[]): PairedCopy {
  const copy: Record<string, string | null> = {};
  for (const entry of PAIRED_STRINGS) copy[entry.key] = resolveHalf(entry, half, rows).template;
  return copy as PairedCopy;
}

export function copiesFrom(rows: readonly EntryRow[]): PairedCopies {
  return { goods: copyFor("goods", rows), services: copyFor("services", rows) };
}

/** The code defaults alone — the gallery's and a specimen's, never a live page's. */
export const CODE_COPIES: PairedCopies = copiesFrom([]);

/** A pair's words with its placeholders filled. */
export function fill(template: string, params: Params, key: PairedKey): string {
  return interpolate(template, params, key);
}

/**
 * Which half a business reads (`B5`): its own declared kind, per `4d-s`.
 *
 * A firm that sells both leads with its catalogue, so its shared controls speak
 * goods — the same call `lib/storefront/loader.ts` makes for the storefront.
 */
export function halfFor(sellsKind: "unset" | "goods" | "services" | "both"): TradeHalf {
  return sellsKind === "services" ? "services" : "goods";
}

// ── The count (B3) ────────────────────────────────────────────────────────────

export interface PairingCount {
  total: number;
  /** Keys with no half missing — both written, or one written and one suppressed. */
  paired: number;
  /** Keys whose services half is missing. */
  unpaired: number;
  suppressed: number;
  /** Halves a person wrote or suppressed from the console. */
  staffDecisions: number;
  /** The most recent staff decision, or null when every half is the code's. */
  lastDecidedAt: Date | null;
}

/** A query over the registry and the rows, on read. Never stored. */
export function pairingCount(rows: readonly EntryRow[]): PairingCount {
  let unpaired = 0;
  let suppressed = 0;
  for (const entry of PAIRED_STRINGS) {
    const state = resolveHalf(entry, "services", rows).state;
    if (state === "missing") unpaired += 1;
    if (state === "suppressed") suppressed += 1;
  }
  const decided = rows.filter((row) => row.kind !== "single" && pairedEntry(row.key));
  const lastDecidedAt = decided.reduce<Date | null>((latest, row) => {
    const at = new Date(row.updatedAt);
    return latest === null || at > latest ? at : latest;
  }, null);
  return {
    total: PAIRED_STRINGS.length,
    paired: PAIRED_STRINGS.length - unpaired,
    unpaired,
    suppressed,
    staffDecisions: decided.length,
    lastDecidedAt,
  };
}

/** The distinct boards that read a pair — the header's SWAP BOARDS figure. */
export function pairedSurfaces(): string[] {
  return [...new Set(PAIRED_STRINGS.flatMap((entry) => entry.surfaces))].sort();
}
