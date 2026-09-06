import { countWords } from "@/lib/publish-threshold";

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

export type GuideBlockKind =
  | "heading"
  | "text"
  | "list"
  | "steps"
  | "quote"
  | "callout"
  | "cta";

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
  /*
     Board 6d §4: "One per article at most. It is for the one sentence a reader
     should leave with, not for decoration." Not enforced in the schema — a
     writer who wants two has an editor to argue with, and a refusal here would
     be the tool having an opinion about prose.
  */
  { kind: "quote", labelKey: "guide.block.quote", fields: [{ key: "body", type: "text" }] },
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

export interface GuideHeading {
  /** The anchor. Stable across edits to the text, because it is the block id. */
  id: string;
  text: string;
}

/**
 * The contents rail — board 6d §3, acceptance 4.
 *
 * *"Generated from the article's `h2` elements, never authored separately."*
 * The board had a hand-written list of six against an article with three: two
 * entries pointed at nothing and one pointed at a different guide entirely.
 *
 * A hand-maintained list drifts from the article on the first edit, and every
 * entry is an anchor — so drift means broken in-page navigation on the page
 * class we most want crawled. Deriving it means adding, renaming or removing a
 * heading changes the rail with no second edit and no way to disagree.
 *
 * The anchor is the **block id**, not a slug of the text. Renaming a heading
 * would otherwise change its anchor and break every link anyone had shared.
 */
export function guideHeadings(blocks: readonly GuideBlock[]): GuideHeading[] {
  return blocks
    .filter((block) => block.kind === "heading")
    .map((block) => ({ id: `s-${block.id}`, text: blockLine(block, "text") }))
    .filter((heading) => heading.text.trim() !== "");
}

/**
 * Below this there is no rail and the article column widens — §3 and §States.
 *
 * Three headings is the point at which a contents list is worth the 262px it
 * costs; two is a list of the page you can already see.
 */
export const MIN_HEADINGS_FOR_CONTENTS = 3;

/**
 * Links from the body into the directory — acceptance 10.
 *
 * *"Every guide links into the directory at least twice: the closing CTA, and
 * at least one in-body link to a relevant category or area page. The in-body
 * link is what makes the guide's earned authority flow to the pages that need
 * it — a guide that only links out from its footer passes much less."*
 *
 * So the CTA is not enough on its own, and this counts only the body. A guide
 * is written to earn links for the 84 area pages; one that keeps all of that
 * authority in its own footer has done the expensive half of the job and
 * skipped the cheap half.
 */
/*
   What counts as "into the directory".

   `/categories` is board 6c's crawlable spine and the index every area page
   hangs off, so a guide pointing there is pointing into the directory — it was
   missing from the first version of this pattern, which required a second path
   segment and therefore refused the one URL that is the directory's front door.

   `/search` is deliberately absent: it carries `noindex` and passes nothing on.
   So is `/rfq/new` — board 6d Q5 keeps the composer off guides entirely.
*/
const DIRECTORY_HREF = /^\/(categories$|categories\/|c\/|best\/|[a-z-]+\/[a-z0-9-]+)/;

export function directoryLinks(blocks: readonly GuideBlock[]): string[] {
  const found: string[] = [];
  for (const block of blocks) {
    for (const key of ["href", "ctaHref", "link"]) {
      const value = block.values[key];
      if (typeof value === "string" && DIRECTORY_HREF.test(value)) found.push(value);
    }
    /*
       Markdown-style links inside prose, which is how a writer actually puts
       one in a paragraph. Counting only a `href` field would mean the rule
       could be satisfied by a block type nobody uses and missed by the one
       everybody does.
    */
    for (const key of ["text", "body"]) {
      const value = block.values[key];
      if (typeof value !== "string") continue;
      for (const match of value.matchAll(/\]\((\/[^)\s]+)\)/g)) {
        const href = match[1] as string;
        if (DIRECTORY_HREF.test(href)) found.push(href);
      }
    }
  }
  return found;
}

/**
 * Words per minute for the `GUIDE · 6 MIN` kicker board 6a §5 draws.
 *
 * 220 is the ordinary figure for adult reading of non-technical prose, and
 * these are technical. It is deliberately not tuned: the kicker's job is to
 * tell a reader whether they have time now, and being a minute out either way
 * costs nothing while pretending to a precision we cannot have costs the same
 * as every other invented number on this template.
 */
const WORDS_PER_MINUTE = 220;

/**
 * How long a guide takes to read, from its own body. Never below one.
 *
 * Derived rather than a column, for the reason every other number on the
 * acquisition surfaces is derived: an editable `readMinutes` field is a claim
 * the article can outgrow without anybody noticing.
 */
export function readingMinutes(body: unknown): number {
  return Math.max(1, Math.round(guideWords(readGuideBlocks(body)) / WORDS_PER_MINUTE));
}

/**
 * The floor a guide publishes above — board 6d, acceptance 13.
 *
 * **1,200, not 250.** It borrowed `DEFAULT_THRESHOLDS.minIntroWords` on the
 * argument that one number is better than two, which was right about landing
 * pages and wrong here: 250 words is the floor for a *paragraph* introducing a
 * page of listings, and a guide is the page. §What-this-page-is-for is blunt
 * about the consequence — the render shows structure at about 520 words and
 * "would not rank for a query this competitive".
 *
 * The two numbers measure different things, which is why they are now two.
 */
export const GUIDE_MIN_WORDS = 1_200;
