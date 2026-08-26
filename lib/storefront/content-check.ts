import { proseOf, type Block } from "./blocks";

/**
 * Board 5d's content check.
 *
 * *"Advisory, not blocking, but it is what stops thin pages shipping at
 * scale."* That sentence is the whole design: a template page is authored once
 * and lands on every storefront in the sector, so a thin one is not one thin
 * page — it is 1,842 of them, all the same, which is the shape search engines
 * treat as doorway content.
 *
 * Advisory because staff know things this does not. A page that fails every
 * check may still be the right page, and a check that blocked publishing would
 * be a check somebody routes around by padding the word count.
 */

export type CheckKey = "length" | "local" | "image_alt" | "internal_link";

export interface ContentCheck {
  key: CheckKey;
  passed: boolean;
  /** What the reader sees beside it — a count, a missing thing. */
  detail?: string;
}

/** Under this and it is a stub, however good the sentences are. */
export const MIN_WORDS = 250;

export interface CheckInput {
  blocks: readonly Block[];
  /** The sector's name, so "mentions the trade" can be checked against it. */
  sectorName: string;
  /** Emirates and area names the copy could reasonably mention. */
  places: readonly string[];
}

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function contentChecks(input: CheckInput): ContentCheck[] {
  const prose = proseOf(input.blocks);
  const count = words(prose);
  const lower = prose.toLowerCase();

  /*
   * "Mentions the area and trade" is checked loosely and on purpose. The trade
   * name is "Valves & fittings" and nobody writes that in a sentence, so any
   * word of it over three letters counts — a page saying "valves" has mentioned
   * the trade as far as a reader is concerned.
   */
  const tradeWords = input.sectorName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 3);
  const mentionsTrade = tradeWords.some((word) => lower.includes(word));
  const mentionsPlace = input.places.some((place) => lower.includes(place.toLowerCase()));

  const images = input.blocks.filter(
    (block) => block.kind === "image_text" || block.kind === "gallery",
  );
  const withAlt = images.filter((block) => {
    const alt = block.values["alt"];
    return typeof alt === "string" && alt.trim().length > 0;
  });

  /*
   * An internal link is a CTA block. Not a URL somebody typed into prose: this
   * asks whether the page sends a reader onwards to the catalogue, and the CTA
   * is the block that does that.
   */
  const hasCta = input.blocks.some((block) => block.kind === "cta");

  return [
    {
      key: "length",
      passed: count >= MIN_WORDS,
      detail: String(count),
    },
    {
      key: "local",
      passed: mentionsTrade && mentionsPlace,
      detail: mentionsTrade ? (mentionsPlace ? undefined : "place") : "trade",
    },
    {
      key: "image_alt",
      passed: images.length > 0 && withAlt.length === images.length,
      detail: images.length === 0 ? "none" : `${withAlt.length}/${images.length}`,
    },
    { key: "internal_link", passed: hasCta },
  ];
}

/** How many passed, for the summary line beside the panel. */
export function passedCount(checks: readonly ContentCheck[]): number {
  return checks.filter((check) => check.passed).length;
}
