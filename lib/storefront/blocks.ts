/**
 * The block vocabulary for a template page — board 5d.
 *
 * Smaller than the section catalogue on purpose. A storefront home is data and
 * a page is prose, so this is eight kinds of paragraph rather than fourteen
 * kinds of query. Nothing here reads from the seller's catalogue: a page that
 * pulled live products would be a worse storefront home, not a better About.
 */

export type BlockKind =
  | "heading"
  | "text"
  | "image_text"
  | "numbers"
  | "timeline"
  | "gallery"
  | "certifications"
  | "cta";

export interface BlockSpec {
  kind: BlockKind;
  labelKey: string;
  /** Fields staff fill when composing the page. */
  fields: { key: string; type: "line" | "text" | "image" | "list" }[];
}

export const BLOCK_SPECS: readonly BlockSpec[] = [
  { kind: "heading", labelKey: "block.heading", fields: [{ key: "text", type: "line" }] },
  { kind: "text", labelKey: "block.text", fields: [{ key: "body", type: "text" }] },
  {
    kind: "image_text",
    labelKey: "block.image_text",
    fields: [
      { key: "image", type: "image" },
      { key: "alt", type: "line" },
      { key: "body", type: "text" },
    ],
  },
  { kind: "numbers", labelKey: "block.numbers", fields: [{ key: "items", type: "list" }] },
  { kind: "timeline", labelKey: "block.timeline", fields: [{ key: "items", type: "list" }] },
  {
    kind: "gallery",
    labelKey: "block.gallery",
    fields: [{ key: "images", type: "list" }],
  },
  {
    // Reads the seller's own published documents, and only the publishable
    // kinds — the same fence the storefront section carries.
    kind: "certifications",
    labelKey: "block.certifications",
    fields: [],
  },
  {
    kind: "cta",
    labelKey: "block.cta",
    fields: [
      { key: "text", type: "line" },
      { key: "label", type: "line" },
    ],
  },
];

export interface Block {
  id: string;
  kind: BlockKind;
  values: Record<string, unknown>;
}

const BY_KIND = new Map(BLOCK_SPECS.map((spec) => [spec.kind, spec]));

export function blockSpec(kind: string): BlockSpec | undefined {
  return BY_KIND.get(kind as BlockKind);
}

/**
 * Read a page's blocks out of the Json column.
 *
 * Anything unrecognised is dropped rather than thrown on. A block kind can only
 * disappear in a deploy, and a deploy that made every About page in a sector
 * return 500 is worse than one that dropped a paragraph until somebody noticed
 * — the same call `resolveSections` makes.
 */
export function readBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Block => {
    if (!entry || typeof entry !== "object") return false;
    const block = entry as Partial<Block>;
    return (
      typeof block.id === "string" &&
      typeof block.kind === "string" &&
      BY_KIND.has(block.kind as BlockKind)
    );
  });
}

/** Everything a reader would actually read, for the content check. */
export function proseOf(blocks: readonly Block[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    for (const key of ["text", "body", "label"]) {
      const value = block.values[key];
      if (typeof value === "string") parts.push(value);
    }
  }
  return parts.join(" ");
}
