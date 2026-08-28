import { countWords, DEFAULT_THRESHOLDS } from "@/lib/publish-threshold";

/**
 * The block vocabulary for a guide — boards 10b and 6d.
 *
 * Six kinds, and deliberately not `lib/storefront/blocks.ts`. That vocabulary
 * has a `certifications` block that reads a seller's own documents and a `cta`
 * wired to a seller's catalogue, and staff edit it per storefront template — so
 * sharing it would mean an edit to the Industrial template could change an
 * article about payment terms. Same shape, same discipline, different words.
 *
 * A guide is prose with a destination. Everything here is something a person
 * writes; nothing reads the catalogue.
 */

export type GuideBlockKind = "heading" | "text" | "list" | "steps" | "callout" | "cta";

export interface GuideBlockSpec {
  kind: GuideBlockKind;
  labelKey: string;
  /**
   * `line` is one line of text, `text` is a paragraph, `items` is an ordered
   * set of them. There is no image field: a guide earns links by being read,
   * and every image is a byte budget on the page type criterion 10 measures.
   */
  fields: { key: string; type: "line" | "text" | "items" }[];
}

export const GUIDE_BLOCK_SPECS: readonly GuideBlockSpec[] = [
  { kind: "heading", labelKey: "guide.block.heading", fields: [{ key: "text", type: "line" }] },
  { kind: "text", labelKey: "guide.block.text", fields: [{ key: "body", type: "text" }] },
  { kind: "list", labelKey: "guide.block.list", fields: [{ key: "items", type: "items" }] },
  { kind: "steps", labelKey: "guide.block.steps", fields: [{ key: "items", type: "items" }] },
  {
    kind: "callout",
    labelKey: "guide.block.callout",
    fields: [
      { key: "label", type: "line" },
      { key: "body", type: "text" },
    ],
  },
  {
    // Where the article sends the reader. The guide's own row carries which
    // trade; this block carries what the sentence says.
    kind: "cta",
    labelKey: "guide.block.cta",
    fields: [
      { key: "body", type: "text" },
      { key: "label", type: "line" },
    ],
  },
];

export interface GuideBlock {
  id: string;
  kind: GuideBlockKind;
  values: Record<string, unknown>;
}

const BY_KIND = new Map(GUIDE_BLOCK_SPECS.map((spec) => [spec.kind, spec]));

export function guideBlockSpec(kind: string): GuideBlockSpec | undefined {
  return BY_KIND.get(kind as GuideBlockKind);
}

/**
 * Read a guide's body out of the Json column.
 *
 * Unrecognised kinds are dropped rather than thrown on — the same call
 * `readBlocks` and `resolveSections` make. A block kind can only disappear in a
 * deploy, and a deploy that made every published guide return 500 is worse than
 * one that dropped a paragraph until somebody noticed.
 */
export function readGuideBlocks(value: unknown): GuideBlock[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is GuideBlock => {
    if (!entry || typeof entry !== "object") return false;
    const block = entry as Partial<GuideBlock>;
    return (
      typeof block.id === "string" &&
      typeof block.kind === "string" &&
      BY_KIND.has(block.kind as GuideBlockKind)
    );
  });
}

/** One string of a block's items, whatever shape the Json column holds. */
export function blockItems(block: GuideBlock, key: string): string[] {
  const raw = block.values[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

/** One line of a block, or the empty string. */
export function blockLine(block: GuideBlock, key: string): string {
  const value = block.values[key];
  return typeof value === "string" ? value : "";
}

/**
 * Everything a reader would actually read.
 *
 * Headings and list items count. A heading is words on the page, and an article
 * that reached the floor on headings alone would be visibly thin — which is the
 * point of counting rather than trusting.
 */
export function guideProse(blocks: readonly GuideBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    for (const key of ["text", "body", "label"]) {
      const value = block.values[key];
      if (typeof value === "string") parts.push(value);
    }
    parts.push(...blockItems(block, "items"));
  }
  return parts.join(" ");
}

export function guideWords(blocks: readonly GuideBlock[]): number {
  return countWords(guideProse(blocks));
}

/**
 * The floor a guide publishes above.
 *
 * Read from `DEFAULT_THRESHOLDS` rather than restated. Guides are not governed
 * by the board 6f matrix — that gate counts listings and verified share, and a
 * guide about payment terms has neither — but the reason for the 250 is the
 * same one, and two numbers drift.
 */
export const GUIDE_MIN_WORDS = DEFAULT_THRESHOLDS.minIntroWords;
