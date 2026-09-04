import { t, type MessageKey } from "@/lib/i18n";
import { COOKIE_CATEGORIES, COOKIE_REGISTER } from "./cookie-register";
import type { LegalPageSlug } from "./pages";

/**
 * Boards 13f, 13g and 13h — three documents, one shape.
 *
 * 13f §2 carries the shared template and says the other two reference it: one
 * `LegalPage` component and one content file per page, which is what makes the
 * three parallel-buildable. This is the content half. The render half is
 * `app/(public)/(legal)/_LegalPage.tsx`, and it knows nothing about which
 * document it is drawing.
 *
 * ## Anchors are an API, not a slug
 *
 * 13f §2: "treat an id as an API". Support replies, the claim flow and the
 * acceptance checkbox on 2e all deep-link to a specific clause, so
 * `#12-our-liability` is a URL somebody else has written down. If a clause is
 * renumbered its old id stays as an alias — `aliases` on the section, rendered
 * as an empty anchor beside the real one — rather than the link breaking.
 *
 * The id is built from the number and the heading together, so the number is
 * part of the contract: renumbering *is* a rename, and the alias is how it stops
 * being a 404.
 *
 * ## Why the tables are data
 *
 * CLAUDE.md's fourth non-negotiable: the canvas draws its tables as flex divs
 * and the build must not. Describing a table as columns and rows here is what
 * lets the renderer emit `<table>`, `<th scope="col">` and a caption without
 * every page restating the markup — and it is what `documents.test.ts` counts
 * when it checks that the meta line's "9 cookies" matches nine rendered rows.
 */

/** Emphasis inside a paragraph is written `**like this**`. Nothing else. */
export type LegalBlock =
  | { kind: "paragraph"; text: string }
  /**
   * A mono eyebrow standing in for a subheading — 13g §1. §02 uses three of
   * them so that its three sources do not become three more entries in the
   * section nav, which lists twelve and must go on listing twelve.
   */
  | { kind: "eyebrow"; text: string }
  | { kind: "table"; caption: string; columns: LegalColumn[]; rows: LegalTableRow[] };

export interface LegalColumn {
  head: string;
  /** A fixed width in the drawn table; the last column takes the rest. */
  width?: string;
  /** Machine strings — cookie names — set in mono, per design-system §01. */
  mono?: boolean;
}

export type LegalTableRow =
  /** A category band spanning the register — 13h's four row groups. */
  | { kind: "band"; label: string }
  | { kind: "row"; cells: string[] };

export interface LegalSection {
  /** "01" … "16". Two digits, because it sorts and because it is in the id. */
  number: string;
  /** `04-what-we-publish`. Stable; see the note above. */
  id: string;
  heading: string;
  /** Ids this section used to answer to. Rendered as empty anchors. */
  aliases?: string[];
  blocks: LegalBlock[];
}

export interface LegalDocument {
  slug: LegalPageSlug;
  href: string;
  title: string;
  /** The mono line under the h1. Uppercased by the render, not by the copy. */
  metaLine: string;
  /** When this wording took effect. Drives the version rail and the print line. */
  effectiveFrom: Date;
  /** Six lines, hand-written per page. Never generated from the body — 13f §2. */
  glance: string[];
  sections: LegalSection[];
}

/** `04` + `What we publish` → `04-what-we-publish`. */
function anchor(number: string, heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${number}-${slug}`;
}

interface SectionInput {
  number: string;
  headingKey: MessageKey;
  blocks: LegalBlock[];
  aliases?: string[];
}

function section({ number, headingKey, blocks, aliases }: SectionInput): LegalSection {
  const heading = t(headingKey);
  return { number, id: anchor(number, heading), heading, blocks, aliases };
}

function p(key: MessageKey): LegalBlock {
  return { kind: "paragraph", text: t(key) };
}

function eyebrow(key: MessageKey): LegalBlock {
  return { kind: "eyebrow", text: t(key) };
}

function glance(prefix: string): string[] {
  return [1, 2, 3, 4, 5, 6].map((n) => t(`${prefix}.glance.${n}` as MessageKey));
}

/*
   The date all three documents took effect. One constant rather than three
   literals: the meta line, the version rail and the print footer all read it,
   and a page whose printed version date disagrees with the line under its own
   h1 is the kind of defect nobody notices until a dispute.

   Month is zero-based in `Date`, so this is 4 September 2026.
*/
const EFFECTIVE_FROM = new Date(Date.UTC(2026, 8, 4));

// ─────────────────────────────────────────────────────────────────────────────
// 13f · Terms of use — sixteen clauses
// ─────────────────────────────────────────────────────────────────────────────

export function termsDocument(): LegalDocument {
  return {
    slug: "terms",
    href: "/terms",
    title: t("legal.terms.title"),
    metaLine: t("legal.terms.meta"),
    effectiveFrom: EFFECTIVE_FROM,
    glance: glance("legal.terms"),
    sections: [
      section({
        number: "01",
        headingKey: "legal.terms.01.heading",
        blocks: [p("legal.terms.01.p1"), p("legal.terms.01.p2")],
      }),
      section({
        number: "02",
        headingKey: "legal.terms.02.heading",
        blocks: [p("legal.terms.02.p1"), p("legal.terms.02.p2")],
      }),
      section({
        number: "03",
        headingKey: "legal.terms.03.heading",
        blocks: [p("legal.terms.03.p1"), p("legal.terms.03.p2"), p("legal.terms.03.p3")],
      }),
      section({
        number: "04",
        headingKey: "legal.terms.04.heading",
        blocks: [
          p("legal.terms.04.p1"),
          p("legal.terms.04.p2"),
          p("legal.terms.04.p3"),
          p("legal.terms.04.p4"),
        ],
      }),
      section({
        number: "05",
        headingKey: "legal.terms.05.heading",
        blocks: [
          p("legal.terms.05.p1"),
          p("legal.terms.05.p2"),
          p("legal.terms.05.p3"),
          p("legal.terms.05.p4"),
        ],
      }),
      section({
        number: "06",
        headingKey: "legal.terms.06.heading",
        blocks: [
          p("legal.terms.06.p1"),
          p("legal.terms.06.p2"),
          p("legal.terms.06.p3"),
          p("legal.terms.06.p4"),
        ],
      }),
      section({
        number: "07",
        headingKey: "legal.terms.07.heading",
        blocks: [p("legal.terms.07.p1"), p("legal.terms.07.p2")],
      }),
      section({
        number: "08",
        headingKey: "legal.terms.08.heading",
        blocks: [
          p("legal.terms.08.p1"),
          p("legal.terms.08.p2"),
          p("legal.terms.08.p3"),
          p("legal.terms.08.p4"),
        ],
      }),
      section({
        number: "09",
        headingKey: "legal.terms.09.heading",
        blocks: [p("legal.terms.09.p1"), p("legal.terms.09.p2"), p("legal.terms.09.p3")],
      }),
      section({
        number: "10",
        headingKey: "legal.terms.10.heading",
        blocks: [p("legal.terms.10.p1")],
      }),
      section({
        number: "11",
        headingKey: "legal.terms.11.heading",
        blocks: [p("legal.terms.11.p1"), p("legal.terms.11.p2"), p("legal.terms.11.p3")],
      }),
      section({
        number: "12",
        headingKey: "legal.terms.12.heading",
        blocks: [p("legal.terms.12.p1"), p("legal.terms.12.p2"), p("legal.terms.12.p3")],
      }),
      section({
        number: "13",
        headingKey: "legal.terms.13.heading",
        blocks: [p("legal.terms.13.p1")],
      }),
      section({
        number: "14",
        headingKey: "legal.terms.14.heading",
        blocks: [p("legal.terms.14.p1"), p("legal.terms.14.p2")],
      }),
      section({
        number: "15",
        headingKey: "legal.terms.15.heading",
        blocks: [p("legal.terms.15.p1"), p("legal.terms.15.p2")],
      }),
      section({
        number: "16",
        headingKey: "legal.terms.16.heading",
        blocks: [p("legal.terms.16.p1")],
      }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 13g · Privacy policy — twelve sections, two tables
// ─────────────────────────────────────────────────────────────────────────────

function purposeTable(): LegalBlock {
  return {
    kind: "table",
    caption: t("legal.privacy.03.caption"),
    columns: [
      { head: t("legal.privacy.03.col.purpose"), width: "15rem" },
      { head: t("legal.privacy.03.col.data") },
    ],
    rows: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      kind: "row" as const,
      cells: [
        t(`legal.privacy.03.r${n}.purpose` as MessageKey),
        t(`legal.privacy.03.r${n}.data` as MessageKey),
      ],
    })),
  };
}

function retentionTable(): LegalBlock {
  return {
    kind: "table",
    caption: t("legal.privacy.07.caption"),
    columns: [
      { head: t("legal.privacy.07.col.what"), width: "11.625rem" },
      { head: t("legal.privacy.07.col.how_long"), width: "11rem" },
      { head: t("legal.privacy.07.col.why") },
    ],
    rows: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      kind: "row" as const,
      cells: [
        t(`legal.privacy.07.r${n}.what` as MessageKey),
        t(`legal.privacy.07.r${n}.how_long` as MessageKey),
        t(`legal.privacy.07.r${n}.why` as MessageKey),
      ],
    })),
  };
}

export function privacyDocument(): LegalDocument {
  return {
    slug: "privacy",
    href: "/privacy",
    title: t("legal.privacy.title"),
    metaLine: t("legal.privacy.meta"),
    effectiveFrom: EFFECTIVE_FROM,
    glance: glance("legal.privacy"),
    sections: [
      section({
        number: "01",
        headingKey: "legal.privacy.01.heading",
        blocks: [p("legal.privacy.01.p1"), p("legal.privacy.01.p2")],
      }),
      section({
        number: "02",
        headingKey: "legal.privacy.02.heading",
        blocks: [
          eyebrow("legal.privacy.02.e1"),
          p("legal.privacy.02.p1"),
          eyebrow("legal.privacy.02.e2"),
          p("legal.privacy.02.p2"),
          eyebrow("legal.privacy.02.e3"),
          p("legal.privacy.02.p3"),
        ],
      }),
      section({
        number: "03",
        headingKey: "legal.privacy.03.heading",
        blocks: [p("legal.privacy.03.p1"), purposeTable()],
      }),
      section({
        number: "04",
        headingKey: "legal.privacy.04.heading",
        blocks: [p("legal.privacy.04.p1"), p("legal.privacy.04.p2"), p("legal.privacy.04.p3")],
      }),
      section({
        number: "05",
        headingKey: "legal.privacy.05.heading",
        blocks: [p("legal.privacy.05.p1"), p("legal.privacy.05.p2"), p("legal.privacy.05.p3")],
      }),
      section({
        number: "06",
        headingKey: "legal.privacy.06.heading",
        blocks: [p("legal.privacy.06.p1")],
      }),
      section({
        number: "07",
        headingKey: "legal.privacy.07.heading",
        blocks: [retentionTable(), p("legal.privacy.07.p1")],
      }),
      section({
        number: "08",
        headingKey: "legal.privacy.08.heading",
        blocks: [p("legal.privacy.08.p1"), p("legal.privacy.08.p2"), p("legal.privacy.08.p3")],
      }),
      section({
        number: "09",
        headingKey: "legal.privacy.09.heading",
        blocks: [p("legal.privacy.09.p1"), p("legal.privacy.09.p2")],
      }),
      section({
        number: "10",
        headingKey: "legal.privacy.10.heading",
        blocks: [p("legal.privacy.10.p1")],
      }),
      section({
        number: "11",
        headingKey: "legal.privacy.11.heading",
        blocks: [p("legal.privacy.11.p1")],
      }),
      section({
        number: "12",
        headingKey: "legal.privacy.12.heading",
        blocks: [p("legal.privacy.12.p1"), p("legal.privacy.12.p2")],
      }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 13h · Cookie policy — five sections and the register
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The register, built from `COOKIE_REGISTER` rather than restated.
 *
 * Nine rows under four bands, in category order. Building it from the data the
 * CI crawl asserts against is the whole point: a cookie added to the code and
 * to the register appears here without anybody remembering to add a row, and a
 * cookie added to neither fails the crawl.
 */
function registerTable(): LegalBlock {
  const rows: LegalTableRow[] = [];

  for (const { category, labelKey } of COOKIE_CATEGORIES) {
    rows.push({ kind: "band", label: t(labelKey) });
    for (const cookie of COOKIE_REGISTER.filter((entry) => entry.category === category)) {
      rows.push({ kind: "row", cells: [cookie.name, t(cookie.purposeKey), t(cookie.lifeKey)] });
    }
  }

  return {
    kind: "table",
    caption: t("legal.cookies.02.caption"),
    columns: [
      { head: t("legal.cookies.02.col.name"), width: "8.25rem", mono: true },
      { head: t("legal.cookies.02.col.purpose") },
      { head: t("legal.cookies.02.col.life"), width: "6rem" },
    ],
    rows,
  };
}

export function cookiesDocument(): LegalDocument {
  return {
    slug: "cookies",
    href: "/cookies",
    title: t("legal.cookies.title"),
    metaLine: t("legal.cookies.meta"),
    effectiveFrom: EFFECTIVE_FROM,
    glance: glance("legal.cookies"),
    sections: [
      section({
        number: "01",
        headingKey: "legal.cookies.01.heading",
        blocks: [p("legal.cookies.01.p1"), p("legal.cookies.01.p2")],
      }),
      section({
        number: "02",
        headingKey: "legal.cookies.02.heading",
        blocks: [registerTable(), p("legal.cookies.02.p1")],
      }),
      section({
        number: "03",
        headingKey: "legal.cookies.03.heading",
        blocks: [p("legal.cookies.03.p1"), p("legal.cookies.03.p2"), p("legal.cookies.03.p3")],
      }),
      section({
        number: "04",
        headingKey: "legal.cookies.04.heading",
        blocks: [p("legal.cookies.04.p1"), p("legal.cookies.04.p2")],
      }),
      section({
        number: "05",
        headingKey: "legal.cookies.05.heading",
        blocks: [p("legal.cookies.05.p1")],
      }),
    ],
  };
}

export const LEGAL_DOCUMENTS = {
  terms: termsDocument,
  privacy: privacyDocument,
  cookies: cookiesDocument,
} as const;

export type LegalDocumentSlug = keyof typeof LEGAL_DOCUMENTS;
