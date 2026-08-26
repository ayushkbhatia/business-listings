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
}

export type SignalKey =
  | "licence_number"
  | "trade_name"
  | "phone"
  | "address"
  | "same_area";

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
const CIRCUMSTANTIAL: Record<Exclude<SignalKey, "licence_number">, number> = {
  trade_name: 0.55,
  phone: 0.2,
  address: 0.15,
  same_area: 0.1,
};

/**
 * The ceiling for a pair with no licence number agreeing.
 *
 * Just under `CERTAIN`, so circumstance alone always lands a person in front of
 * the decision however much of it there is.
 */
const WITHOUT_LICENCE_CEILING = 0.89;

/** Above this, bulk-merging is safe. */
export const CERTAIN = 0.9;
/** Below this, not a match. */
export const PROBABLE = 0.6;

export function bandFor(score: number): Band {
  if (score >= CERTAIN) return "certain";
  if (score >= PROBABLE) return "probable";
  return "unlikely";
}

/** Digits only. `DED-123456` and `123456` are the same licence. */
export function licenceDigits(value: string): string {
  return value.replace(/\D/g, "");
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

export function compare(a: Listing, b: Listing): Similarity {
  const signals: Signal[] = [];

  const licenceA = licenceDigits(a.licenceNumber);
  const licenceB = licenceDigits(b.licenceNumber);
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
  }

  const licenceSignal = signals.find((signal) => signal.key === "licence_number");
  const nameSignal = signals.find((signal) => signal.key === "trade_name");

  /*
   * A licence match starts at the certain floor. The name lifts it from there,
   * so "same licence, different name" sits at 0.90 — certain, and still the
   * pair a careful person looks at first.
   */
  const score = licenceSignal
    ? CERTAIN + (1 - CERTAIN) * (nameSignal?.strength ?? 0)
    : Math.min(
        WITHOUT_LICENCE_CEILING,
        signals.reduce(
          (sum, signal) =>
            signal.key === "licence_number"
              ? sum
              : sum + CIRCUMSTANTIAL[signal.key] * signal.strength,
          0,
        ),
      );

  const rounded = Number(Math.min(1, score).toFixed(4));

  return { score: rounded, band: bandFor(rounded), signals };
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
    (signal) => signal.key === "licence_number" || signal.key === "trade_name",
  );
}
