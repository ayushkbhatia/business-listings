import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getProductBySlug } from "@/lib/db/queries/business";
import { encodeFileId, mediaLibrary } from "@/lib/media/library";
import { attachToProduct } from "@/lib/media/service";
import { CHECKED_BY_US_KINDS } from "@/lib/verification/credentials";

/**
 * The sentence this file defends, in `lib/i18n/en.ts`:
 *
 *   "Your trade licence and VAT certificate are only ever seen by our team.
 *    They are never on your public listing and never linked from it."
 *
 * It was breakable in four steps, none of which needed anything unusual: the
 * media library listed every `Document` a seller owned, its bulk bar offered
 * *attach to product* on any of them, `attachToProduct` wrote the join row
 * without looking at `kind`, and the public product page rendered every joined
 * document's name as a link. `/b/:slug/d/:id` 404s a trade licence and always
 * has, so the **file** never leaked — but a public page carrying
 * `Trade licence 2027` as a link is the promise broken whatever happens when a
 * buyer clicks it. The seller's licence number, their manager's name and the
 * fact that they hold one are the parts that were never meant to be on a page.
 *
 * Four layers, so each test here is a different one failing on its own.
 */

const PREFIX = "privdoc";

let businessId: string;
let businessSlug: string;
let categoryId: string;
let productId: string;
let productSlug: string;
const made: { documents: string[]; products: string[] } = { documents: [], products: [] };

beforeAll(async () => {
  /*
     A published business with a public product, because two of the four layers
     are only observable through the public read. `getProductBySlug` filters on
     `publishedAt` and `suspendedAt` before it gets anywhere near a document.
  */
  const business = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed", publishedAt: { not: null }, suspendedAt: null },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, primaryCategoryId: true },
  });
  businessId = business.id;
  businessSlug = business.slug;
  categoryId = business.primaryCategoryId!;

  const stamp = `${Date.now().toString(36)}`;
  const product = await prisma.product.create({
    data: {
      businessId,
      categoryId,
      name: `${PREFIX} valve ${stamp}`,
      slug: `${PREFIX}-valve-${stamp}`,
      status: "live",
      availability: "in_stock",
      searchText: `${PREFIX} valve`,
    },
    select: { id: true, slug: true },
  });
  made.products.push(product.id);
  productId = product.id;
  productSlug = product.slug;
});

afterAll(async () => {
  await prisma.productDocument.deleteMany({ where: { productId: { in: made.products } } });
  await prisma.document.deleteMany({ where: { id: { in: made.documents } } });
  await prisma.product.deleteMany({ where: { id: { in: made.products } } });
  await prisma.$disconnect();
});

let seq = 0;

async function document(kind: "trade_licence" | "vat_certificate" | "datasheet" | "enquiry_attachment") {
  seq += 1;
  const row = await prisma.document.create({
    data: {
      businessId,
      kind,
      storagePath: `${businessId}/${kind}/${PREFIX}-${Date.now()}-${seq}.pdf`,
      filename: `${PREFIX}-${kind}-${seq}.pdf`,
      displayName: `${PREFIX} ${kind} ${seq}`,
      bytes: 300_000,
      mimeType: "application/pdf",
    },
    select: { id: true },
  });
  made.documents.push(row.id);
  return row.id;
}

/* ── Layer 1 — the write ─────────────────────────────────────────────────── */

describe("attaching a document to a product", () => {
  it("refuses a trade licence, and names it", async () => {
    const id = await document("trade_licence");
    const result = await attachToProduct(businessId, [encodeFileId("document", id)], productId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_publishable");
      // The seller has to be able to tell which of a selection was refused.
      expect(result.message).toContain(`${PREFIX} trade_licence`);
    }
    expect(await prisma.productDocument.count({ where: { documentId: id } })).toBe(0);
  });

  it("refuses a VAT certificate too", async () => {
    const id = await document("vat_certificate");
    const result = await attachToProduct(businessId, [encodeFileId("document", id)], productId);
    expect(result.ok).toBe(false);
    expect(await prisma.productDocument.count({ where: { documentId: id } })).toBe(0);
  });

  it("refuses a file a buyer sent, which is private from the other side", async () => {
    const id = await document("enquiry_attachment");
    const result = await attachToProduct(businessId, [encodeFileId("document", id)], productId);
    expect(result.ok).toBe(false);
    expect(await prisma.productDocument.count({ where: { documentId: id } })).toBe(0);
  });

  it("refuses the whole selection, not just the licence in it", async () => {
    /*
       The half that is easy to get wrong. Attaching the datasheet and
       silently dropping the licence would report success, and the seller would
       have no reason to look at the one thing they need to know about.
    */
    const licence = await document("trade_licence");
    const datasheet = await document("datasheet");
    const result = await attachToProduct(
      businessId,
      [encodeFileId("document", datasheet), encodeFileId("document", licence)],
      productId,
    );

    expect(result.ok).toBe(false);
    expect(await prisma.productDocument.count({ where: { productId } })).toBe(0);
  });

  it("still attaches a datasheet", async () => {
    const id = await document("datasheet");
    const result = await attachToProduct(businessId, [encodeFileId("document", id)], productId);
    expect(result.ok).toBe(true);
    expect(await prisma.productDocument.count({ where: { documentId: id } })).toBe(1);
    await prisma.productDocument.deleteMany({ where: { documentId: id } });
  });
});

/* ── Layer 2 — the public read ───────────────────────────────────────────── */

describe("the public product page's documents", () => {
  it("does not carry a trade licence, even when a row already links one", async () => {
    /*
       Written straight into the join table, which is the shape of every row
       that predates the refusal above — the importer wrote them, and so did the
       media library's bulk bar.
    */
    const licence = await document("trade_licence");
    const datasheet = await document("datasheet");
    await prisma.productDocument.createMany({
      data: [
        { productId, documentId: licence, sortOrder: 0 },
        { productId, documentId: datasheet, sortOrder: 1 },
      ],
    });

    try {
      const product = await getProductBySlug(businessSlug, productSlug);
      const kinds = (product?.documents ?? []).map((row) => row.document.kind);
      expect(kinds).toEqual(["datasheet"]);
      // Not the name either. The link text was the leak, not the file.
      const names = (product?.documents ?? []).map((row) => row.document.displayName);
      expect(names.join(" ")).not.toContain("trade_licence");
    } finally {
      await prisma.productDocument.deleteMany({ where: { productId } });
    }
  });
});

/* ── Layer 3 — the picker ────────────────────────────────────────────────── */

describe("the media library", () => {
  it("does not list the two kinds the platform holds", async () => {
    const licence = await document("trade_licence");
    const vat = await document("vat_certificate");
    const datasheet = await document("datasheet");

    const library = await mediaLibrary(businessId);
    const ids = library.files.map((file) => file.id);

    expect(ids).not.toContain(encodeFileId("document", licence));
    expect(ids).not.toContain(encodeFileId("document", vat));
    // The library is not emptied of documents — only of those two.
    expect(ids).toContain(encodeFileId("document", datasheet));
  });

  it("keeps the header total and the folder counts in step with what it lists", async () => {
    // Criterion 1 of board 3i: the folder counts sum to the header total. A
    // filter applied to one and not the other is how that stops being true.
    await document("trade_licence");
    const library = await mediaLibrary(businessId);
    const summed = library.folders.reduce((sum, folder) => sum + folder.files, 0);
    expect(summed).toBe(library.total);
  });
});

/* ── The constants themselves ────────────────────────────────────────────── */

describe("the two constants", () => {
  it("names exactly what the promise names", async () => {
    // `verify_listing.documents_hint` says "trade licence and VAT certificate".
    // If a kind is added to one and not the other, this is where it shows.
    expect([...CHECKED_BY_US_KINDS]).toEqual(["trade_licence", "vat_certificate"]);
  });
});
