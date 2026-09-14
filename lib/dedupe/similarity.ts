/**
 * How alike two listings are, and why.
 *
 * Pure. The candidate generator, the screen and the tests all read this.
 *
 * Board 12b's own words are the design brief: *"the 74% band is the one that
 * matters — merging two genuinely separate companies destroys reviews."* So the
 * score is not the output. The **signals** are: which of five independent facts
 * agreed, each nameable on screen, so a person in the middle band can see that
 * two listings share a phone number and nothing else and decide accordingly.
 *
 * A single number reduces that to a feeling. This returns both.
 */

export interface Listing {
  id: string;
  tradeName: string;
  licenceNumber: string;
  licenceAuthority: string;
  emirate: string | null;
  areaId: string | null;
  addressLine: string | null;
  phones: readonly string[];
  /**
   * The area's name, for the nearby-area signal. Board `12b` draws "Same area ·
   * Adjacent" for Al Quoz Ind. 3 against Al Quoz Ind. 4; without a name the
   * signal can only say same or not.
   */
  areaName?: string | null;
  /** `activityKey` of the licence activity, where the record carries one. */
  activityKey?: string | null;
}

export type SignalKey =
  | "licence_number"
  | "licence_root"
  | "trade_name"
  | "phone"
  | "address"
  | "same_area"
  | "nearby_area"
  | "activity";

export interface Signal {
  key: SignalKey;
  /** 0..1 for this signal alone. */
  strength: number;
  /** What matched, in words, for the screen. */
  detail: string;
}

export type Band = "certain" | "probable" | "unlikely";

export interface Similarity {
  score: number;
  band: Band;
  signals: Signal[];
}

/**
 * Scoring is a rule, not a weighting, and the rule is the safety property:
 *
 * **No pair reaches the certain band without a licence number agreeing.**
 *
 * A licence number is an identifier. Two listings carrying the same one are the
 * same company, or somebody typed it wrong — and either way a person should
 * look at them. Everything else is circumstantial: a trade name is strong and
 * not conclusive ("Al Marwan Trading" and "Al Marwan General Trading" are
 * usually one company and occasionally two brothers), a phone number is shared
 * by a landlord and every tenant in a building, an address is shared by a whole
 * industrial unit, and an emirate is shared by two million companies.
 *
 * A first version of this weighted all five and summed them. It could not
 * express both "same licence, no other signal" and "same name at one address"
 * as `probable` without pushing one of them somewhere wrong — and the shape it
 * got wrong was the dangerous one, because a linear sum lets enough weak
 * signals add up to a bulk merge. Two paths, and a cap, say the thing directly.
 */
const CIRCUMSTANTIAL: Record<Exclude<SignalKey, "licence_number" | "licence_root">, number> = {
  trade_name: 0.55,
  phone: 0.2,
  address: 0.15,
  same_area: 0.1,
  // Half of a shared area, and never both: an area is one or the other.
  nearby_area: 0.05,
  // Two companies licensed for the same activity is most of a trade. Weighted
  // low for exactly that reason, and it is what separates a branch from a
  // tenant who shares the building and sells something else.
  activity: 0.05,
};

/**
 * A licence root with a different suffix: `DED-441908` and `DED-441908-01`.
 *
 * Board `12b`'s domain hint — *a suffix on the licence usually means a branch,
 * not a separate company* — is a relationship, not an identity. A branch holds
 * its own registry number (B9), so a root match is where a person starts to
 * look and never a bulk merge on its own: it opens at this floor, the
 * circumstance lifts it, and the same ceiling as every other non-identifier
 * path holds it under the certain band.
 */
const ROOT_FLOOR = 0.35;
const ROOT_LIFT = 0.55;

/**
 * The ceiling for a pair with no licence number agreeing.
 *
 * Just under `CERTAIN`, so circumstance alone always lands a person in front of
 * the decision however much of it there is.
 */
const WITHOUT_LICENCE_CEILING = 0.89;

/** Above this, bulk-merging is safe. The default; `Bands` carries the tuned value. */
export const CERTAIN = 0.9;
/** Below this, not a match. The default; `Bands` carries the tuned value. */
export const PROBABLE = 0.6;

/**
 * Where the two lines sit. Board `12b` B8: the band is configurable, and its
 * boundaries are shown — see `lib/dedupe/bands.ts` for what a tuning may set.
 */
export interface Bands {
  /** At or above: a person decides. Below: not a match, and counted (B10). */
  floor: number;
  /** At or above: safe to bulk merge. */
  certain: number;
}

export const DEFAULT_BANDS: Bands = { floor: PROBABLE, certain: CERTAIN };

export function bandFor(score: number, bands: Bands = DEFAULT_BANDS): Band {
  if (score >= bands.certain) return "certain";
  if (score >= bands.floor) return "probable";
  return "unlikely";
}

/** Digits only. `DED-123456` and `123456` are the same licence. */
export function licenceDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * A licence number's root and branch suffix.
 *
 * `DED-441908-01` is root `441908`, suffix `01`: the first run of digits is the
 * licence, and a short run after a separator is the branch. `DED-44190801`,
 * written without the separator, is read as one root — guessing where a suffix
 * starts inside a run of digits would invent a relationship.
 */
export function licenceParts(value: string): { root: string; suffix: string | null } {
  const runs = value.match(/\d+/g) ?? [];
  if (runs.length === 0) return { root: "", suffix: null };
  const last = runs[runs.length - 1]!;
  if (runs.length >= 2 && last.length <= 3) {
    return { root: runs.slice(0, -1).join(""), suffix: last };
  }
  return { root: runs.join(""), suffix: null };
}

/**
 * A trade name reduced to the words that identify it.
 *
 * The legal suffix is noise for comparison — every second company is an LLC —
 * and so is "general", "trading" and "co" on their own. What is left is the
 * name somebody would actually say.
 */
const NOISE = new Set([
  "llc",
  "fze",
  "fzc",
  "fzco",
  "l l c",
  "co",
  "company",
  "est",
  "establishment",
  "general",
  "trading",
  "traders",
  "the",
  "and",
  // A registry marks a branch in the name as often as in the licence. It says
  // how two records relate, and nothing about who either of them is.
  "branch",
]);

export function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NOISE.has(token));
}

/** Jaccard over the identifying tokens. Order-independent, which names are. */
export function nameSimilarity(a: string, b: string): number {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * A UAE number reduced to its national significant digits.
 *
 * `+971 4 347 2290` and `04 347 2290` are one number written two ways, and
 * comparing the last nine digits gets it wrong — the international form drops
 * the trunk zero the local form keeps, so the two differ by one digit at the
 * front and match on nothing. Strip the country code, then the trunk zero.
 */
export function phoneKey(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00971")) digits = digits.slice(5);
  else if (digits.startsWith("971")) digits = digits.slice(3);
  return digits.replace(/^0+/, "");
}

function addressSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

/**
 * Two area names naming one district: `Al Quoz Industrial 3` and `Al Quoz
 * Industrial 4`. The words match and only the number differs. Anything looser
 * — sharing "Industrial" — is two districts, and would put every industrial
 * area in the country next to every other.
 */
export function sameDistrict(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const words = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{Letter}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  const left = words(a);
  return left.length > 0 && left === words(b) && a.trim().toLowerCase() !== b.trim().toLowerCase();
}

export function compare(a: Listing, b: Listing, bands: Bands = DEFAULT_BANDS): Similarity {
  const signals: Signal[] = [];

  const licenceA = licenceDigits(a.licenceNumber);
  const licenceB = licenceDigits(b.licenceNumber);
  const rootA = licenceParts(a.licenceNumber);
  const rootB = licenceParts(b.licenceNumber);
  if (licenceA.length >= 4 && licenceA === licenceB) {
    signals.push({
      key: "licence_number",
      strength: 1,
      // Same digits from a different authority is a real pattern — a company
      // that moved from mainland to a free zone keeps its number style — so the
      // authority is named rather than assumed identical.
      detail:
        a.licenceAuthority === b.licenceAuthority
          ? `${a.licenceAuthority} ${licenceA}`
          : `${licenceA}, ${a.licenceAuthority} and ${b.licenceAuthority}`,
    });
  } else if (rootA.root.length >= 4 && rootA.root === rootB.root) {
    const suffix = rootA.suffix ?? rootB.suffix;
    signals.push({
      key: "licence_root",
      strength: 1,
      detail: suffix ? `${rootA.root}, suffix ${suffix}` : rootA.root,
    });
  }

  const name = nameSimilarity(a.tradeName, b.tradeName);
  if (name > 0) {
    signals.push({
      key: "trade_name",
      strength: name,
      detail: `${Math.round(name * 100)}% of the identifying words`,
    });
  }

  const phonesB = new Set(b.phones.map(phoneKey).filter((key) => key.length >= 7));
  const sharedPhone = a.phones.map(phoneKey).find((key) => key.length >= 7 && phonesB.has(key));
  if (sharedPhone) {
    signals.push({ key: "phone", strength: 1, detail: sharedPhone });
  }

  const address = addressSimilarity(a.addressLine, b.addressLine);
  if (address > 0) {
    signals.push({
      key: "address",
      strength: address,
      detail: `${Math.round(address * 100)}% of the address words`,
    });
  }

  if (a.areaId && a.areaId === b.areaId) {
    signals.push({ key: "same_area", strength: 1, detail: "same area" });
  } else if (a.emirate && a.emirate === b.emirate && sameDistrict(a.areaName, b.areaName)) {
    signals.push({
      key: "nearby_area",
      strength: 1,
      detail: `${a.areaName} and ${b.areaName}`,
    });
  }

  if (a.activityKey && a.activityKey === b.activityKey) {
    signals.push({ key: "activity", strength: 1, detail: a.activityKey });
  }

  const licenceSignal = signals.find((signal) => signal.key === "licence_number");
  const rootSignal = signals.find((signal) => signal.key === "licence_root");
  const nameSignal = signals.find((signal) => signal.key === "trade_name");

  const circumstance = signals.reduce(
    (sum, signal) =>
      signal.key === "licence_number" || signal.key === "licence_root"
        ? sum
        : sum + CIRCUMSTANTIAL[signal.key] * signal.strength,
    0,
  );

  /*
   * A licence match starts at the certain floor. The name lifts it from there,
   * so "same licence, different name" sits at 0.90 — certain, and still the
   * pair a careful person looks at first.
   *
   * The floor is the constant, not the tuned line: a licence match is an
   * identifier whatever the band is set to, and `bands.ts` refuses a certain
   * line below it, so this can never land a tuned identifier under "certain".
   */
  const score = licenceSignal
    ? CERTAIN + (1 - CERTAIN) * (nameSignal?.strength ?? 0)
    : rootSignal
      ? Math.min(WITHOUT_LICENCE_CEILING, ROOT_FLOOR + ROOT_LIFT * circumstance)
      : Math.min(WITHOUT_LICENCE_CEILING, circumstance);

  const rounded = Number(Math.min(1, score).toFixed(4));

  return { score: rounded, band: bandFor(rounded, bands), signals };
}

/**
 * A pair that shares something that identifies — a licence root, a phone or
 * most of a name — whatever it scored.
 *
 * Board `12b` Q1 / B10: a real duplicate scoring under the floor never reaches
 * a person, and nobody ever knows. These are counted, so a floor set too high
 * shows up as a number that grows.
 */
export function isNearMiss(similarity: Similarity): boolean {
  return similarity.signals.some(
    (signal) =>
      signal.key === "licence_number" ||
      signal.key === "licence_root" ||
      signal.key === "phone" ||
      (signal.key === "trade_name" && signal.strength >= 0.5),
  );
}

/**
 * The one shape that must never reach the certain band on its own.
 *
 * Two listings in one industrial unit sharing the landlord's switchboard have a
 * shared phone, a shared address and a shared area — and are two different
 * companies. Their combined weight is 0.25, which lands in `unlikely`, and this
 * asserts that rather than leaving it to arithmetic nobody checks.
 */
export function withoutIdentifiers(similarity: Similarity): boolean {
  return !similarity.signals.some(
    (signal) =>
      signal.key === "licence_number" ||
      signal.key === "licence_root" ||
      signal.key === "trade_name",
  );
}
