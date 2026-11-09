import {
  compare,
  isNearMiss,
  licenceDigits,
  licenceParts,
  nameTokens,
  phoneKey,
  type Bands,
  type Listing,
  type Similarity,
} from "./similarity";

/**
 * Finding the listing a record may duplicate, and deciding which side of a pair
 * survives. Pure: the importer, the rescan, the tuning preview and the tests
 * all call it, so a pair is the same pair wherever it is found.
 *
 * ## Blocked, not pairwise
 *
 * An 8,000-row export against 41,000 listings is 328 million comparisons. A
 * record is compared only with listings that share something that could make
 * it a duplicate at all — its licence digits or root, a phone, or an
 * identifying word of its name — which is a handful per record. A word shared
 * by a large share of the corpus ("gulf", "star") identifies nobody and is
 * dropped as a block, never as a signal: a pair it would have found still
 * shares its licence or phone, or a rarer word in the same name.
 */

/**
 * The smallest a block cap is ever set — task T4.5.
 *
 * Below a few hundred listings no word identifies nobody, because there is
 * nothing for it to fail to distinguish. The floor is what keeps the cap from
 * firing on a directory of four hundred, where two hundred rows is half of it.
 */
export const MIN_BLOCK = 200;

/**
 * The share of the corpus a word may match before it stops identifying anyone.
 *
 * One per cent. A word that appears in one listing in a hundred narrows a
 * 41,000-row directory to 410, which is a set worth comparing; a word in one in
 * ten narrows it to nothing.
 */
export const BLOCK_SHARE = 0.01;

/**
 * How many listings one word may block, for a corpus of this size — T4.5.
 *
 * `MAX_BLOCK` was a flat 200 and that was the defect: **the number did not
 * move with the directory**. At 400 listings it never fired, at 41,000 it cut
 * at half a per cent, and at 400,000 it would cut words that appear in one
 * listing in two thousand — which is a word that identifies a company
 * perfectly well. The cut was also silent and at the wrong end: a block over
 * the line was skipped by `bestMatch`, so the index still held it and nothing
 * anywhere said a word had been given up on.
 *
 * Relative, with a floor, decided once per index and carried on it.
 */
export function blockCapFor(corpus: number): number {
  return Math.max(MIN_BLOCK, Math.ceil(corpus * BLOCK_SHARE));
}

export interface MatchIndex {
  listings: ReadonlyMap<string, Listing>;
  blocks: ReadonlyMap<string, readonly string[]>;
  /** The cap this index was built with — `blockCapFor(listings.length)`. */
  blockCap: number;
  /**
   * The words that matched more listings than the cap and were left out.
   *
   * Carried rather than counted, because "which words identify nobody in this
   * directory" is a thing an ops lead tuning the bands should be able to read,
   * and because a silent cut is the defect this replaced.
   */
  droppedKeys: readonly string[];
}

/**
 * The blocking keys of one listing or record.
 *
 * Exported since T4.4, because the candidate query is built from exactly these:
 * the database is asked for the listings that share a key with this chunk of
 * records, and then the in-process index is built from what comes back. One
 * definition of "could these two be the same company at all", read by the
 * matcher and by the query that feeds it.
 */
export function keysFor(listing: Listing): string[] {
  const keys: string[] = [];
  const digits = licenceDigits(listing.licenceNumber);
  if (digits.length >= 4) keys.push(`licence:${digits}`);
  const { root } = licenceParts(listing.licenceNumber);
  if (root.length >= 4) keys.push(`root:${root}`);
  for (const phone of listing.phones) {
    const key = phoneKey(phone);
    if (key.length >= 7) keys.push(`phone:${key}`);
  }
  for (const token of nameTokens(listing.tradeName)) {
    if (token.length > 2) keys.push(`name:${token}`);
  }
  return [...new Set(keys)];
}

/**
 * The blocking index, with the useless blocks left out rather than skipped.
 *
 * T4.5 moved the cap from the lookup to the build. It is the same decision in a
 * better place: an index that holds a nine-thousand-row block is an index
 * carrying nine thousand ids it will never use, and a `bestMatch` that skips
 * the block has no way to say so. Every block that survives here is one the
 * matcher will actually read.
 *
 * `cap` is for a caller that knows the corpus is wider than the array it is
 * handing over — T4.4's candidate loader, which has already applied the same
 * rule in SQL against the whole directory and must not apply a second, tighter
 * one to the handful of rows it brought back.
 */
export function buildMatchIndex(listings: readonly Listing[], cap?: number): MatchIndex {
  const byId = new Map<string, Listing>();
  const blocks = new Map<string, string[]>();
  for (const listing of listings) {
    byId.set(listing.id, listing);
    for (const key of keysFor(listing)) {
      const block = blocks.get(key);
      if (block) block.push(listing.id);
      else blocks.set(key, [listing.id]);
    }
  }

  const blockCap = cap ?? blockCapFor(listings.length);
  const droppedKeys: string[] = [];
  for (const [key, block] of blocks) {
    if (block.length <= blockCap) continue;
    /*
       Only a name can be too common. A licence or a phone shared by four
       hundred listings is not noise, it is four hundred listings that need
       looking at — so those keys are never dropped however large they get.
    */
    if (!key.startsWith("name:")) continue;
    blocks.delete(key);
    droppedKeys.push(key.slice("name:".length));
  }

  return { listings: byId, blocks, blockCap, droppedKeys: droppedKeys.sort() };
}

export interface Match {
  listing: Listing;
  similarity: Similarity;
}

export interface MatchResult {
  /** The closest listing at or above the floor, or null. */
  match: Match | null;
  /** The closest listing below the floor shared something identifying (B10). */
  nearMiss: boolean;
}

/**
 * The closest listing to a record, excluding the ids it must not be paired
 * with — itself, and listings a person has already said it is not (B2).
 *
 * Ties go to the higher score, then to the listing with the lower id, so the
 * same file staged twice pairs the same way twice.
 */
export function bestMatch(
  record: Listing,
  index: MatchIndex,
  bands: Bands,
  exclude: ReadonlySet<string> = new Set(),
): MatchResult {
  const seen = new Set<string>([record.id]);
  let best: Match | null = null;

  for (const key of keysFor(record)) {
    // Every block the index holds is one worth reading — the cap was applied
    // when it was built, which is where it can be reported.
    const block = index.blocks.get(key);
    if (!block) continue;
    for (const id of block) {
      if (seen.has(id) || exclude.has(id)) continue;
      seen.add(id);
      const listing = index.listings.get(id)!;
      const similarity = compare(listing, record, bands);
      if (
        !best ||
        similarity.score > best.similarity.score ||
        (similarity.score === best.similarity.score && listing.id < best.listing.id)
      ) {
        best = { listing, similarity };
      }
    }
  }

  if (best && best.similarity.band !== "unlikely") return { match: best, nearMiss: false };
  return { match: null, nearMiss: best !== null && isNearMiss(best.similarity) };
}

/* ── Which side survives — B1 ────────────────────────────────────────────── */

export interface SideFacts {
  id: string;
  claimed: boolean;
  /** An active, trialling or past-due subscription: somebody is paying or was. */
  paying: boolean;
  reviews: number;
  products: number;
  enquiries: number;
  publishedAt: Date | null;
  createdAt: Date;
}

export type ParentChoice =
  | { kind: "parent"; parentId: string; childId: string; because: "claimed" | "paying" | "history" | "older" }
  | { kind: "both_claimed" };

/**
 * The claimed, paying record is always the parent — whichever side a reviewer
 * clicked (B1). Never the lower id: `a.id < b.id` kept whichever listing
 * happened to be created first, and a claimed Pro listing absorbed into an
 * unclaimed import row is exactly how a paying customer's history gets merged
 * away.
 *
 * Two claimed records (Q3) are two owners and two subscriptions, and no rule
 * here is allowed to pick between them.
 */
export function chooseParent(a: SideFacts, b: SideFacts): ParentChoice {
  if (a.claimed && b.claimed) return { kind: "both_claimed" };
  const pick = (parent: SideFacts, child: SideFacts, because: "claimed" | "paying" | "history" | "older") =>
    ({ kind: "parent", parentId: parent.id, childId: child.id, because }) as const;

  if (a.claimed !== b.claimed) return a.claimed ? pick(a, b, "claimed") : pick(b, a, "claimed");
  if (a.paying !== b.paying) return a.paying ? pick(a, b, "paying") : pick(b, a, "paying");

  const history = (side: SideFacts) => side.reviews * 3 + side.enquiries * 2 + side.products;
  if (history(a) !== history(b)) return history(a) > history(b) ? pick(a, b, "history") : pick(b, a, "history");

  const since = (side: SideFacts) => (side.publishedAt ?? side.createdAt).getTime();
  if (since(a) !== since(b)) return since(a) < since(b) ? pick(a, b, "older") : pick(b, a, "older");
  return a.id < b.id ? pick(a, b, "older") : pick(b, a, "older");
}

/**
 * The domain hint under record B — board `12b`: *"Suffix "-01" on the licence
 * usually means a branch, not a separate company."*
 */
export type PairHint = { kind: "branch_suffix"; suffix: string } | { kind: "same_licence" } | null;

export function pairHint(a: Pick<Listing, "licenceNumber">, b: Pick<Listing, "licenceNumber">): PairHint {
  if (licenceDigits(a.licenceNumber).length >= 4 && licenceDigits(a.licenceNumber) === licenceDigits(b.licenceNumber)) {
    return { kind: "same_licence" };
  }
  const left = licenceParts(a.licenceNumber);
  const right = licenceParts(b.licenceNumber);
  if (left.root.length >= 4 && left.root === right.root) {
    const suffix = right.suffix ?? left.suffix;
    if (suffix) return { kind: "branch_suffix", suffix };
  }
  return null;
}
