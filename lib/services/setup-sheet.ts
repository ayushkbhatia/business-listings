import { completeness, REQUIRED_COUNT, type RequiredField, type RequiredFieldValues } from "./scope-sheet";

/**
 * Setup task 2 — board `8c-s`, the screen that started the service track.
 *
 * The goods task 2 asks for a spec template and ten products. A tax practice
 * has four services and will never have ten, so the task cannot be finished and
 * the largest lever on the hub is permanently out of reach. That is not a copy
 * problem: it is a different task, with a different bar, a different completion
 * rule and a different justification — and noticing it could not be patched is
 * what produced the whole variant track.
 *
 * Pure, like `scope-sheet.ts` beside it, because the counting rule leaves this
 * screen: it is the hub's task 2, the services lever on two weight tables, and
 * the nightly strength job. A rule that lived in the page would be three rules.
 */

/* ── What counts, and what merely publishes ──────────────────────────────── */

/**
 * Four of six, and the two rules are deliberately different — B4, AC3, AC4.
 *
 * **Publishing is not counting.** `mayPublish()` in `scope-sheet.ts` returns
 * `true` unconditionally and is a function precisely so that a gate has to be
 * deleted to add one: gate publishing on a score and sellers type "TBC" into
 * six fields to clear it, which destroys the comparison the fields exist to
 * create. But a hub task that counted every live row would close on three
 * services carrying nothing but a name, and the task is the one asking for a
 * *complete* list rather than a long one.
 *
 * So a thin service is live, findable, and excluded from the three — which is
 * `3f-s`'s rule stated in the seller's terms, and the screen says so in the
 * seller's terms too, naming the fields (see `thinServices`).
 *
 * Four is `8c-s` Q2's judgement rather than a finding: six of six makes the
 * task punishing, three of six makes it meaningless. If completion is poor the
 * board's own instruction is to move this number before lowering the field
 * count — which is one constant, here.
 */
export const COUNTING_BAR = 4;

/** Three counting services finish the task — `8a-s`'s `SERVICES_TARGET`. */
export { SERVICES_TARGET as SERVICE_TARGET } from "@/lib/metrics/profile-strength";

export interface CountableService extends RequiredFieldValues {
  id: string;
  live: boolean;
}

/** Live **and** at the bar. Both halves, and neither implies the other. */
export function countsTowardTask(service: CountableService): boolean {
  return service.live && completeness(service).filled >= COUNTING_BAR;
}

/**
 * The shape every reader of this rule loads, and the mapper they share.
 *
 * Four modules score the services lever — the setup hub, the setup chrome, the
 * onboarding meter and the nightly strength job — and before `8c-s` all four
 * counted `status = live` with a `_count`. Adding a completeness bar to one of
 * them and not the others would give a seller two different numbers on two
 * screens, which is the drift `normalised is two things` is a note about.
 *
 * So the select and the mapper live here, next to the rule they feed.
 */
export const COUNTABLE_SELECT = {
  id: true,
  businessId: true,
  status: true,
  name: true,
  engagementType: true,
  feeBasis: true,
  turnaround: true,
  deliveredWhere: true,
  deliverable: true,
} as const;

export interface CountableRow {
  id: string;
  status: string;
  name: string;
  engagementType: CountableService["engagementType"];
  feeBasis: string | null;
  turnaround: string | null;
  deliveredWhere: CountableService["deliveredWhere"];
  deliverable: string | null;
}

export function toCountable(row: CountableRow): CountableService {
  return { ...row, live: row.status === "live" };
}

/** How many of a firm's services are live **and** at the bar — B4. */
export function countCounting(rows: readonly CountableRow[]): number {
  return rows.filter((row) => countsTowardTask(toCountable(row))).length;
}

export interface ThinService {
  id: string;
  name: string;
  filled: number;
  total: number;
  /** In the editor's field order, so a seller reading them finds them in it. */
  missing: RequiredField[];
}

/**
 * The live services that do not count, and exactly which fields are missing —
 * B6, AC5.
 *
 * *"Turnaround and fee basis are the two missing"* rather than *"this service
 * is incomplete"*. A score without an instruction is a nag: the seller already
 * knows the row is thin, and what they do not know is which two of six fields
 * would fix it. Computing it costs nothing — `completeness` already returns the
 * list — and refusing to compute it is how a screen ends up scolding somebody
 * it could have helped.
 *
 * Drafts are absent. A draft is not thin, it is unfinished on purpose, and a
 * callout about one would be the screen nagging about work in progress.
 */
export function thinServices(services: readonly CountableService[]): ThinService[] {
  return services
    .filter((service) => service.live && !countsTowardTask(service))
    .map((service) => {
      const score = completeness(service);
      return {
        id: service.id,
        name: (service.name ?? "").trim(),
        filled: score.filled,
        total: score.total,
        missing: score.missing,
      };
    });
}

export interface TaskCount {
  /** Live and at the bar. This is the number the task is measured on. */
  counting: number;
  /** Live, whatever their completeness. What a buyer can already find. */
  live: number;
  /** How many more counting services would close the task. Never below zero. */
  toGo: number;
  done: boolean;
  thin: ThinService[];
}

export function taskCount(
  services: readonly CountableService[],
  target: number,
): TaskCount {
  const counting = services.filter(countsTowardTask).length;
  return {
    counting,
    live: services.filter((service) => service.live).length,
    toGo: Math.max(0, target - counting),
    done: counting >= target,
    thin: thinServices(services),
  };
}

/* ── Step 1 · which sheet ────────────────────────────────────────────────── */

/**
 * The shape of a sheet, as its card states it.
 *
 * The board's card reads `12 fields · 6 required · 5 filterable · used by 214
 * firms`. **Three of those four numbers are wrong against this tree** and the
 * fourth is a constant where the board itself calls for a query (B3), so every
 * one of them is counted here from the family's own rows: `CLAUDE.md` — *every
 * number is a query, not a constant*, and *if a header states a count, count
 * the elements*.
 *
 * `rows` is the public scope table's length, which is nine on every seeded
 * family. `required` is the six of `scope-sheet.ts` and is a property of the
 * model rather than of a family — every sheet asks the same six, which is what
 * makes two firms in different trades comparable at all on the hub.
 */
export interface SheetShape {
  rows: number;
  required: number;
  filterable: number;
  /** Firms on this sheet. Zero is a real answer and the card renders it as one. */
  usedBy: number;
}

export function sheetShape(
  rows: readonly { filterable: boolean }[],
  usedBy: number,
): SheetShape {
  return {
    rows: rows.length,
    required: REQUIRED_COUNT,
    filterable: rows.filter((row) => row.filterable).length,
    usedBy,
  };
}

/* ── Step 1 · which sheets match ─────────────────────────────────────────── */

/**
 * How well a family matches what the seller told us on `2c-s` — B2, AC2.
 *
 * The signal is `servicesOffered`, not `sectorsServed`, and the distinction
 * matters: sectors are the industries a firm *serves* — "Contracting",
 * "Trading" — and every trade serves them. What the firm *offers* is what
 * decides which sheet fits, and `2c-s` captures it as free text beside the
 * sectors. A matcher keyed on sectors would badge the audit sheet for a
 * cleaning company working in contracting.
 *
 * Token overlap rather than exact equality, because a seller types "Statutory
 * audit FY2025" and the list says "Statutory audit". Short tokens are dropped:
 * "and", "of", "tax" would each match half the directory, so only tokens of
 * four characters or more count, and the family's own name counts as a phrase.
 *
 * Ties break on the family id so two runs of the same data rank the same way.
 * A family with no overlap scores zero and is never badged — an arbitrary badge
 * on a sheet nothing matched is worse than no badge, because the badge is the
 * whole reason a seller trusts the first card over the third.
 */
export interface MatchCandidate {
  id: string;
  name: string;
  /** The family's common services, which is the strongest evidence available. */
  common: readonly string[];
}

export interface SheetMatch {
  id: string;
  score: number;
}

const MIN_TOKEN = 4;

/** At most two — B2, and the render shows two. */
export const MAX_BADGES = 2;

export function matchSheets(
  families: readonly MatchCandidate[],
  servicesOffered: readonly string[],
): SheetMatch[] {
  const offered = servicesOffered.map(tokens).filter((set) => set.size > 0);
  if (offered.length === 0) return [];

  return families
    .map((family) => {
      const phrases = [family.name, ...family.common].map(tokens);
      let score = 0;
      for (const one of offered) {
        // The best phrase this service matches, not the sum: a seller offering
        // "Statutory audit" has said one thing about themselves, and counting
        // it once per matching phrase would rank a family by how many near
        // synonyms somebody happened to author for it.
        score += Math.max(0, ...phrases.map((phrase) => overlap(one, phrase)));
      }
      return { id: family.id, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, MAX_BADGES);
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= MIN_TOKEN),
  );
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let hit = 0;
  for (const word of a) if (b.has(word)) hit += 1;
  return hit;
}
