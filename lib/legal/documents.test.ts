import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";
import { CLOSURE_AMENDMENT_FROM, cookiesDocument, privacyDocument, termsDocument } from "./documents";
import type { LegalDocument } from "./documents";
import { COOKIE_REGISTER } from "./cookie-register";
import { LEGAL_PAGES } from "./pages";

/**
 * The counts on these pages are claims, and CLAUDE.md's fourth checkpoint says
 * to check every asserted number against the markup: a completeness header once
 * read "18 OF 22" over a table of sixteen rows. A meta line reading "16 clauses"
 * over fifteen sections is the same defect on a page whose only job is to be
 * true.
 */

const DOCUMENTS: [string, () => LegalDocument, number][] = [
  ["terms", termsDocument, 16],
  ["privacy", privacyDocument, 12],
  ["cookies", cookiesDocument, 5],
];

describe.each(DOCUMENTS)("%s", (_name, build, sections) => {
  it("renders the number of sections its meta line claims", () => {
    expect(build().sections).toHaveLength(sections);
  });

  it("numbers its sections in order, from 01, with no gaps", () => {
    const numbers = build().sections.map((section) => section.number);
    expect(numbers).toEqual(
      Array.from({ length: sections }, (_, i) => String(i + 1).padStart(2, "0")),
    );
  });

  it("has a stable, unique anchor per section", () => {
    const ids = build().sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{2}-[a-z0-9-]+$/);
  });

  it("carries the six glance lines the rail draws, hand-written", () => {
    const doc = build();
    expect(doc.glance).toHaveLength(6);
    // Not generated from the body — 13f §2. A line lifted verbatim out of a
    // clause is the failure mode, and it reads like one.
    const body = doc.sections
      .flatMap((section) => section.blocks)
      .map((block) => (block.kind === "paragraph" ? block.text : ""))
      .join(" ");
    for (const line of doc.glance) expect(body).not.toContain(line);
  });

  it("states the same date in the meta line and the version rail", () => {
    const doc = build();
    expect(doc.metaLine).toContain(formatDate(doc.effectiveFrom));
  });

  it("has an address in the shared page list", () => {
    const doc = build();
    expect(LEGAL_PAGES.map((page) => page.href)).toContain(doc.href);
  });

  it("gives every section content", () => {
    for (const section of build().sections) expect(section.blocks.length).toBeGreaterThan(0);
  });

  it("gives every table a caption and a cell in every column", () => {
    for (const section of build().sections) {
      for (const block of section.blocks) {
        if (block.kind !== "table") continue;
        expect(block.caption, section.id).not.toBe("");
        for (const row of block.rows) {
          if (row.kind === "row") expect(row.cells).toHaveLength(block.columns.length);
        }
      }
    }
  });
});

describe("terms", () => {
  it("keeps the anchors other screens link to", () => {
    /*
       13f §2 and §4. The acceptance checkbox on account creation, claim
       submission and plan subscribe each points at a clause, and support
       replies point at these two most often. Renaming one is renaming a URL
       somebody else wrote down; the section keeps the old id as an alias
       instead, and this list is what notices.
    */
    const ids = new Set(termsDocument().sections.flatMap((s) => [s.id, ...(s.aliases ?? [])]));
    for (const id of [
      "02-accepting-these-terms",
      "04-what-we-publish",
      "05-using-the-directory-as-a-buyer",
      "08-plans-fees-and-vat",
      "12-our-liability",
      "14-changes-to-these-terms",
    ]) {
      expect(ids, id).toContain(id);
    }
  });
});

describe("privacy", () => {
  it("keeps its three sources out of the section nav", () => {
    // 13g §1: §02's sources are mono eyebrows, not subheadings, so the nav
    // lists twelve entries rather than fifteen. The nav is built from sections.
    const collect = privacyDocument().sections.find((section) => section.number === "02");
    expect(collect?.blocks.filter((block) => block.kind === "eyebrow")).toHaveLength(3);
  });

  it("draws both tables as tables", () => {
    const tables = privacyDocument()
      .sections.flatMap((section) => section.blocks)
      .filter((block) => block.kind === "table");
    expect(tables).toHaveLength(2);
    expect(tables.map((table) => table.rows.length)).toEqual([8, 8]);
  });

  it("names in §04 exactly the fields an enquiry hands a supplier", () => {
    /*
       13g §4 makes this section a contract with the enquiry engine, and asks
       for a test whose expected value is the field list — so that adding
       `buyer.phone` to the payload fails a test naming this policy section.
       This is the copy half of that pair: it fails if the promise is edited
       out. The payload half belongs with the payload builder.
    */
    const section = privacyDocument().sections.find((s) => s.number === "04");
    const text = section?.blocks.map((b) => (b.kind === "paragraph" ? b.text : "")).join(" ") ?? "";
    for (const field of ["requirement", "quantity", "location", "timeframe", "first name", "company name"]) {
      expect(text.toLowerCase(), field).toContain(field);
    }
    expect(text).toContain("They do not receive your phone number or your email");
  });
});

describe("cookies", () => {
  it("renders the register as nine rows under four bands", () => {
    const table = cookiesDocument()
      .sections.flatMap((section) => section.blocks)
      .find((block) => block.kind === "table");

    const bands = table?.rows.filter((row) => row.kind === "band") ?? [];
    const rows = table?.rows.filter((row) => row.kind === "row") ?? [];

    expect(bands).toHaveLength(4);
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((row) => row.cells[0])).size).toBe(9);
    for (const row of rows) expect(row.cells[0]).toMatch(/^bl_[a-z_]+$/);
  });

  it("renders every cookie the register holds, and no other", () => {
    const table = cookiesDocument()
      .sections.flatMap((section) => section.blocks)
      .find((block) => block.kind === "table");
    const printed = (table?.rows ?? [])
      .filter((row) => row.kind === "row")
      .map((row) => row.cells[0]);

    expect(printed).toEqual(COOKIE_REGISTER.map((cookie) => cookie.name));
  });
});

describe("board 11i's amendment", () => {
  /*
     Terms §14: a material change is announced on the site before it takes
     effect, and the earlier wording stays on the page with its dates. The
     amendment overturns a promise the Terms made about closure, so both halves
     of that rule are asserted rather than trusted to a rail somebody reads.
  */
  const before = new Date(CLOSURE_AMENDMENT_FROM.getTime() - 1);
  const after = CLOSURE_AMENDMENT_FROM;

  it("announces the change and keeps today's wording until the date", () => {
    const doc = termsDocument(before);
    const clause = doc.sections.find((section) => section.number === "11")!;
    expect(JSON.stringify(clause.blocks)).toContain("stays published, unclaimed");
    expect(doc.pendingChange?.effectiveFrom).toEqual(CLOSURE_AMENDMENT_FROM);
    expect(doc.previousChange).toBeNull();
  });

  it("applies the new wording on the date and keeps the old one as the previous version", () => {
    const doc = termsDocument(after);
    const clause = doc.sections.find((section) => section.number === "11")!;
    expect(JSON.stringify(clause.blocks)).not.toContain("stays published, unclaimed");
    expect(JSON.stringify(clause.blocks)).toContain("never given to another business");
    expect(doc.effectiveFrom).toEqual(CLOSURE_AMENDMENT_FROM);
    expect(doc.previousChange?.items[0]?.before).toContain("stays published, unclaimed");
    expect(doc.pendingChange).toBeNull();
  });

  it("dates the meta line from the wording in force, not from a literal", () => {
    expect(termsDocument(before).metaLine).toContain(formatDate(new Date(Date.UTC(2026, 8, 4))));
    expect(termsDocument(after).metaLine).toContain(formatDate(CLOSURE_AMENDMENT_FROM));
    expect(privacyDocument(after).metaLine).toContain(formatDate(CLOSURE_AMENDMENT_FROM));
  });

  it("gives the announcement at least the fourteen days §14 promises from 15 September", () => {
    // If the account-holder message goes out later than this, the date moves.
    const announced = new Date(Date.UTC(2026, 8, 15));
    const days = (CLOSURE_AMENDMENT_FROM.getTime() - announced.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(14);
  });
});
