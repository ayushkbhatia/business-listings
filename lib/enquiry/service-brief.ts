import type { BriefStart, Emirate, EngagementType, ServiceCadence } from "@/lib/db/generated/enums";
import type { CoverageScope } from "@/lib/locations/coverage";
import { ENGAGEMENT_TYPES } from "@/lib/services/scope-sheet";
import { EMIRATES } from "@/lib/uae";
import { atMonthlyCap, MAX_RECIPIENTS } from "./fanout";
import {
  ENQUIRY_ATTACHMENT_BYTES,
  REQUIREMENT_MAX,
  REQUIREMENT_MIN,
  SCALE_MAX,
  checkEnquiryAttachment,
} from "./service-enquiry";

/**
 * Board `1h-s` — the brief a buyer writes for work, and who it goes to.
 *
 * Pure, so every rule is unit tested and the client composer checks the same
 * ones before it posts. The server re-checks all of them: a form can post
 * anything.
 *
 * ## Five questions, and not one asks a quantity
 *
 * The goods composer opens on `PRODUCT` / `QTY` / `TARGET PRICE`. A facilities
 * contract has no line to put there: the quantity is a building, and a target
 * price cannot be stated before the fee basis is known. So a brief is where the
 * site is, what needs doing, the engagement shape, when it starts and —
 * optionally — roughly how big it is, in the buyer's own words (B1).
 *
 * ## Who it goes to
 *
 * Four clauses, and the order is the argument (B5):
 *
 *  1. **A verified trade licence** — `8b-s` tier 1, the licence and nothing
 *     else. A claim-only credential here would turn an unchecked assertion into
 *     routed demand.
 *  2. **Sells this work** — a live service filed in the subcategory, or one
 *     of its children (`4d-s`). A listing under the trade alone is not enough:
 *     routing is per service.
 *  3. **That service covers the site** — its `effectiveCoverage`, its own rows
 *     else the firm's default (`3c-s` B8). Never the business-level union,
 *     which is the listing's headline and routes nothing.
 *  4. **Not at the monthly cap** — excluded silently (D4); the buyer is never
 *     shown a firm that cannot reply.
 *
 * Clauses 1 to 3 are filters the query loader applies. Clause 4 is here, beside
 * the ranking, because it is the part that writes a `MissedEnquiry` row.
 *
 * **No availability clause** (B12). D11 closed as *no*, so the page never has
 * to explain a brief that matched six and went to two.
 */

/* ── The five questions ──────────────────────────────────────────────────── */

/** The composer's floor and ceiling, shared with the storefront's service form. */
export const DESCRIPTION_MIN = REQUIREMENT_MIN;
export const DESCRIPTION_MAX = REQUIREMENT_MAX;
export { SCALE_MAX };
/** *Building or plot*, one line. Matches the CHECK on `service_brief.building`. */
export const BUILDING_MAX = 120;

/**
 * B3: the seller's enum, imported rather than restated. `3g-s`'s scope sheet
 * and this question read one list, so a value added on one side is offered on
 * the other the same day — the export that dropped *Call-off* is the defect
 * this line prevents.
 */
export const BRIEF_ENGAGEMENTS: readonly EngagementType[] = ENGAGEMENT_TYPES;
export const BRIEF_CADENCES = ["monthly", "quarterly", "annually"] as const satisfies readonly ServiceCadence[];
export const BRIEF_START_MODES = ["from_date", "asap"] as const satisfies readonly BriefStart[];

/**
 * Up to five files, each the storefront form's ten megabytes, from the private
 * bucket's own allow-list — an asset register exported as a PDF and a set of
 * drawings, not a data room. One set for every recipient (B8, Q3).
 */
export const MAX_BRIEF_ATTACHMENTS = 5;
export { ENQUIRY_ATTACHMENT_BYTES as BRIEF_ATTACHMENT_BYTES };

/**
 * The recipient cap — board `1h-s` Q1, **left at the goods number** and named
 * so the owner's answer is one line.
 *
 * The design side argues five: a proposal costs a site visit and a scoped fee,
 * and eight firms writing eight FM proposals to win one contract is a tax on
 * supply that returns as slower replies. The spec's criterion 5 and the render
 * both say eight, and nothing else on the page hardcodes it — every sentence
 * that states the cap reads this.
 */
export const BRIEF_MAX_RECIPIENTS = MAX_RECIPIENTS;

/** Names the rail prints before *and N more that cover this area*. */
export const BRIEF_NAMES_SHOWN = 3;

/**
 * Below this, the rail says the count is short rather than letting a lone name
 * read as a full list. Never padded: the brief goes to the real count.
 */
export const THIN_MATCH = 3;

/* ── The site ────────────────────────────────────────────────────────────── */

export interface BriefSite {
  emirate: Emirate;
  /** Null is *anywhere in the emirate* — a multi-site contract, or not sure yet. */
  areaId: string | null;
}

const EMIRATE_VALUES = new Set<string>(EMIRATES.map((e) => e.value));

export function isEmirate(value: string): value is Emirate {
  return EMIRATE_VALUES.has(value);
}

/**
 * One `<select>`, one value: `emirate:dubai` for anywhere in Dubai,
 * `area:<id>` for a place in it. A single control reads the way the question is
 * asked — *where is the site* — and a native select with an optgroup per
 * emirate is keyboard, screen-reader and phone correct without a combobox.
 */
export function siteValue(site: BriefSite | null): string {
  if (!site) return "";
  return site.areaId ? `area:${site.areaId}` : `emirate:${site.emirate}`;
}

export function parseSiteValue(
  value: string,
  areaEmirate: (areaId: string) => Emirate | null,
): BriefSite | null {
  if (value.startsWith("emirate:")) {
    const emirate = value.slice("emirate:".length);
    return isEmirate(emirate) ? { emirate, areaId: null } : null;
  }
  if (value.startsWith("area:")) {
    const areaId = value.slice("area:".length);
    const emirate = areaEmirate(areaId);
    // An area the taxonomy does not hold is refused, not guessed at.
    return emirate ? { emirate, areaId } : null;
  }
  return null;
}

/* ── The composer's value ─────────────────────────────────────────────────── */

export interface BriefValue {
  /** `emirate:<emirate>` or `area:<id>`, or empty. */
  site: string;
  building: string;
  description: string;
  engagement: string;
  cadence: string;
  startMode: string;
  startsOn: string;
  scale: string;
  contactName: string;
  contactPhone: string;
}

/**
 * Here rather than beside the composer: a constant exported from a
 * `"use client"` module reaches a server component as a client reference, and
 * spreading one yields nothing — the page's seeded answers arrived with every
 * other key missing.
 */
export const EMPTY_BRIEF: BriefValue = {
  site: "",
  building: "",
  description: "",
  engagement: "",
  cadence: "",
  startMode: "",
  startsOn: "",
  scale: "",
  contactName: "",
  contactPhone: "",
};

/* ── Checking a draft ────────────────────────────────────────────────────── */

export type BriefField =
  | "site"
  | "building"
  | "description"
  | "engagement"
  | "cadence"
  | "start"
  | "scale"
  | "attachments"
  | "contact";

export type BriefRefusal =
  | { field: "site"; reason: "missing" }
  | { field: "building"; reason: "too_long"; max: number }
  | { field: "description"; reason: "too_short"; min: number }
  | { field: "description"; reason: "too_long"; max: number }
  | { field: "engagement"; reason: "missing" }
  | { field: "cadence"; reason: "not_ongoing" }
  | { field: "start"; reason: "missing" | "invalid" | "past" }
  | { field: "scale"; reason: "too_long"; max: number }
  | { field: "attachments"; reason: "type" | "size" | "too_many"; max?: number }
  | { field: "contact"; reason: "missing" };

export interface BriefDraft {
  /** The select's value, `emirate:…` or `area:…`, or empty. */
  site: string;
  building: string;
  /** Checked on its trimmed length, **stored as typed** (B2). */
  description: string;
  engagement: string;
  cadence: string;
  startMode: string;
  /** `YYYY-MM-DD`, or empty. */
  startsOn: string;
  scale: string;
  attachments: readonly { type: string; bytes: number }[];
  /** Only asked of a buyer with no account; null otherwise. */
  contactPhone: string | null;
}

export interface BriefClean {
  site: BriefSite;
  building: string | null;
  /** Byte for byte what the buyer typed. */
  description: string;
  engagement: EngagementType;
  cadence: ServiceCadence | null;
  startMode: BriefStart;
  startsOn: Date | null;
  scale: string | null;
}

/**
 * Clean and check. Every refusal, not the first, so a buyer wrong on two
 * questions is told both.
 *
 * `areaEmirate` resolves an area id against the taxonomy the page was rendered
 * from. `today` is the UAE calendar date, passed in so a buyer at 23:30 in Dubai
 * is not refused tomorrow by a server clock in UTC.
 */
export function checkServiceBrief(
  draft: BriefDraft,
  context: { today: string; areaEmirate: (areaId: string) => Emirate | null },
): { ok: true; value: BriefClean } | { ok: false; refusals: BriefRefusal[] } {
  const refusals: BriefRefusal[] = [];

  const site = parseSiteValue(draft.site, context.areaEmirate);
  if (!site) refusals.push({ field: "site", reason: "missing" });

  const building = draft.building.trim().replace(/\s+/g, " ");
  if (building.length > BUILDING_MAX) refusals.push({ field: "building", reason: "too_long", max: BUILDING_MAX });

  /*
     B2. The length is judged on what a reader would count, and the value is
     kept exactly as typed — leading indentation in a numbered scope, a blank
     line between two towers. Suppliers see this as the buyer wrote it, and a
     trim is the first step of a rewrite.
  */
  const length = draft.description.trim().length;
  if (length < DESCRIPTION_MIN) {
    refusals.push({ field: "description", reason: "too_short", min: DESCRIPTION_MIN });
  } else if (draft.description.length > DESCRIPTION_MAX) {
    refusals.push({ field: "description", reason: "too_long", max: DESCRIPTION_MAX });
  }

  const engagement = (BRIEF_ENGAGEMENTS as readonly string[]).includes(draft.engagement)
    ? (draft.engagement as EngagementType)
    : null;
  if (!engagement) refusals.push({ field: "engagement", reason: "missing" });

  /*
     B4. A cadence on anything but an ongoing contract is refused rather than
     dropped: the composer never offers one there, so it is a stale draft or a
     hand-built post, and the database would refuse the row anyway.
  */
  let cadence: ServiceCadence | null = null;
  if (draft.cadence !== "") {
    if (engagement !== "ongoing_contract") {
      if (engagement) refusals.push({ field: "cadence", reason: "not_ongoing" });
    } else if ((BRIEF_CADENCES as readonly string[]).includes(draft.cadence)) {
      cadence = draft.cadence as ServiceCadence;
    } else {
      refusals.push({ field: "cadence", reason: "not_ongoing" });
    }
  }

  let startMode: BriefStart | null = null;
  let startsOn: Date | null = null;
  if (draft.startMode === "asap") {
    startMode = "asap";
  } else if (draft.startMode === "from_date") {
    const date = draft.startsOn.trim();
    if (date === "") {
      refusals.push({ field: "start", reason: "missing" });
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      refusals.push({ field: "start", reason: "invalid" });
    } else if (date < context.today) {
      refusals.push({ field: "start", reason: "past" });
    } else {
      startMode = "from_date";
      startsOn = new Date(`${date}T00:00:00.000Z`);
    }
  } else {
    refusals.push({ field: "start", reason: "missing" });
  }

  // D7 and B6: one line, never parsed. Whitespace is collapsed because it is a
  // single line; the words are the buyer's.
  const scale = draft.scale.trim().replace(/\s+/g, " ");
  if (scale.length > SCALE_MAX) refusals.push({ field: "scale", reason: "too_long", max: SCALE_MAX });

  if (draft.attachments.length > MAX_BRIEF_ATTACHMENTS) {
    refusals.push({ field: "attachments", reason: "too_many", max: MAX_BRIEF_ATTACHMENTS });
  } else {
    for (const file of draft.attachments) {
      const refusal = checkEnquiryAttachment(file.type, file.bytes);
      if (refusal) {
        refusals.push({ field: "attachments", reason: refusal.reason });
        break;
      }
    }
  }

  if (draft.contactPhone !== null && draft.contactPhone.trim() === "") {
    refusals.push({ field: "contact", reason: "missing" });
  }

  if (refusals.length > 0 || !site || !engagement || !startMode) {
    return { ok: false, refusals };
  }
  return {
    ok: true,
    value: {
      site,
      building: building === "" ? null : building,
      description: draft.description,
      engagement,
      cadence,
      startMode,
      startsOn,
      scale: scale === "" ? null : scale,
    },
  };
}

/* ── Coverage ────────────────────────────────────────────────────────────── */

/**
 * Whether a coverage set reaches the site, at the scope the buyer is matching.
 *
 * - **An area** is reached by a claim on that area or on its whole emirate. A
 *   firm covering Al Quoz does not reach Business Bay; one covering Dubai does.
 * - **Anywhere in an emirate** — the buyer named no area, or widened to the
 *   emirate after an area found nobody — is reached by any claim inside it. A
 *   firm that works in part of Dubai works in Dubai, and the rail says *work
 *   in Dubai* rather than *cover Business Bay* when this is the scope.
 */
export function reachesSite(
  coverage: readonly CoverageScope[],
  site: BriefSite,
  scope: "area" | "emirate",
): boolean {
  if (scope === "emirate" || site.areaId === null) {
    return coverage.some((claim) => claim.emirate === site.emirate);
  }
  return coverage.some(
    (claim) =>
      claim.areaId === site.areaId || (claim.areaId === null && claim.emirate === site.emirate),
  );
}

/* ── Ranking and the cap ─────────────────────────────────────────────────── */

export interface BriefCandidate {
  businessId: string;
  slug: string;
  displayName: string;
  /** A matching service filed in exactly the subcategory asked, not a child of it. */
  exactTrade: boolean;
  /** A matching service offered on the engagement the buyer chose. */
  offersEngagement: boolean;
  /** Measured, never claimed. Null is unmeasured. */
  responseTimeMedianMs: number | null;
  /** Null means unlimited. */
  enquiriesPerMonth: number | null;
  enquiriesThisMonth: number;
}

export interface BriefSelection {
  recipients: BriefCandidate[];
  /** At the monthly cap: never shown, recorded as a `MissedEnquiry` (D4). */
  skipped: { businessId: string; reason: "at_monthly_cap" }[];
}

/** An unmeasured reply time sorts as twelve hours — unknown, not slow. */
const UNMEASURED_MS = 12 * 3_600_000;

/**
 * Who of the eligible firms gets the brief, when more match than the cap.
 *
 * Every candidate here already holds a verified licence and covers the site,
 * so trust and locality cannot separate them. What can, in order:
 *
 *  1. **The engagement they sell.** A firm whose matching call-off service
 *     reaches the site is the better reading of a call-off brief (B3) — ranked on, never
 *     filtered on, because a firm whose sheet says *ongoing contract* can still
 *     price a one-off job and excluding it would narrow the match silently.
 *  2. **The exact trade** over a neighbouring one under the same sector.
 *  3. **Measured reply time**, unmeasured at the midpoint.
 *  4. **The id**, so two sends of the same brief pick the same firms.
 *
 * **No plan multiplier**, the goods fan-out's rule and for the same reason: the
 * page says *we pick them*, and a pick that what they pay us can move is not
 * the pick it describes.
 */
export function selectBriefRecipients(
  candidates: readonly BriefCandidate[],
  options: { cap?: number; pinned?: readonly string[] } = {},
): BriefSelection {
  const cap = Math.max(1, Math.min(BRIEF_MAX_RECIPIENTS, options.cap ?? BRIEF_MAX_RECIPIENTS));
  const pinned = new Set(options.pinned ?? []);

  const skipped: BriefSelection["skipped"] = [];
  const eligible: BriefCandidate[] = [];
  for (const candidate of candidates) {
    if (atMonthlyCap(candidate)) {
      skipped.push({ businessId: candidate.businessId, reason: "at_monthly_cap" });
      continue;
    }
    eligible.push(candidate);
  }

  const speed = (c: BriefCandidate) => c.responseTimeMedianMs ?? UNMEASURED_MS;
  eligible.sort(
    (a, b) =>
      Number(pinned.has(b.businessId)) - Number(pinned.has(a.businessId)) ||
      Number(b.offersEngagement) - Number(a.offersEngagement) ||
      Number(b.exactTrade) - Number(a.exactTrade) ||
      speed(a) - speed(b) ||
      a.businessId.localeCompare(b.businessId),
  );

  return { recipients: eligible.slice(0, cap), skipped };
}

/* ── What the page says about the match ──────────────────────────────────── */

export type MatchState =
  /** No site yet: nothing to match on, and the rail says so. */
  | { kind: "no_site" }
  /** The buyer named the firm; the brief goes to them alone. */
  | { kind: "pinned"; count: 0 | 1 }
  /** Matched at an area and nobody covers it, but firms work elsewhere in its emirate. */
  | { kind: "widen"; emirateCount: number }
  /** Nobody, at any scope the page can offer. */
  | { kind: "none" }
  | { kind: "matched"; count: number; thin: boolean };

/**
 * The rail's state, from the counts the preview returned.
 *
 * `emirateCount` is only read when the site is an area that matched nobody:
 * the same widening move `1f-s` makes, offered rather than applied, because a
 * buyer who named Business Bay has said something the page must not quietly
 * discard.
 */
export function matchState(input: {
  site: BriefSite | null;
  pinned: boolean;
  scope: "area" | "emirate";
  count: number;
  emirateCount: number | null;
}): MatchState {
  if (input.pinned) return { kind: "pinned", count: input.count > 0 ? 1 : 0 };
  if (!input.site) return { kind: "no_site" };
  if (input.count > 0) {
    return { kind: "matched", count: input.count, thin: input.count < THIN_MATCH };
  }
  if (input.site.areaId !== null && input.scope === "area" && (input.emirateCount ?? 0) > 0) {
    return { kind: "widen", emirateCount: input.emirateCount! };
  }
  return { kind: "none" };
}

/**
 * The line the enquiry writes, so a quote has something to answer.
 *
 * Named for the service where the buyer came from one, else for the trade.
 * Never quantified: `qty` is null, which every renderer omits (pull request 173).
 */
export function briefSubjectLine(
  trade: { name: string },
  service: { id: string; name: string } | null,
): { description: string; qty: null; serviceId: string | null } {
  return service
    ? { description: service.name, qty: null, serviceId: service.id }
    : { description: trade.name, qty: null, serviceId: null };
}

/**
 * The site as a supplier's notification and the free-text column read it:
 * *Business Bay, Dubai*, or *Dubai*. `Enquiry.deliverToArea` keeps the buyer's
 * words on a goods enquiry; on a brief the buyer picked, so the words are ours
 * and they name the row they picked.
 */
export function siteLabel(site: BriefSite, areaName: string | null): string {
  const emirate = EMIRATES.find((e) => e.value === site.emirate)?.label ?? site.emirate;
  return areaName ? `${areaName}, ${emirate}` : emirate;
}
