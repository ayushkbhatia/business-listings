/**
 * Which private documents are attached to a product? Read-only.
 *
 * `verify_listing.documents_hint` promises the seller that their trade licence
 * and VAT certificate are "never on your public listing and never linked from
 * it". Until this branch, three paths could write a `product_document` row for
 * one anyway — the media library's bulk *attach to product*, the catalogue
 * importer's photo column, and both without a kind check — and the public
 * product page rendered every such row's **name** as a link. The file itself
 * never leaked: `/b/:slug/d/:id` has fenced on `PUBLISHABLE_DOCUMENT_KINDS`
 * since handoff 1, so the link 404s. The name and the link did not.
 *
 * The code fence is now in four places. This answers the fourth question,
 * which no code change can: whether any row already written is one of those.
 *
 * Every statement here is a `SELECT`. It names nothing it would delete and it
 * deletes nothing — the disposition of whatever it finds is a person's, and a
 * lapsed credential is evidence of a past state (board 3e open question 5).
 *
 *   pnpm audit:private-docs
 *
 * Against production, point it at production explicitly rather than editing
 * `.env.local`:
 *
 *   DIRECT_URL="postgresql://…" pnpm audit:private-docs
 */
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/db/generated/client.js";
import { PUBLISHABLE_DOCUMENT_KINDS } from "../lib/verification/credentials.js";

// Same as prisma.config.ts: the Prisma CLI loads .env.local, a bare tsx script
// does not, and the two must read the same connection strings.
loadEnv({ path: [".env.local", ".env"], quiet: true });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Missing DIRECT_URL or DATABASE_URL");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Host only, never the password — this output gets pasted into a PR. */
const where = (() => {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "the configured database";
  }
})();

async function main() {
  console.log(`→ ${where}`);

  const total = await prisma.productDocument.count();
  const offending = await prisma.productDocument.findMany({
    where: { document: { kind: { notIn: [...PUBLISHABLE_DOCUMENT_KINDS] } } },
    select: {
      productId: true,
      document: { select: { id: true, kind: true, displayName: true, filename: true } },
      product: {
        select: {
          name: true,
          status: true,
          business: {
            select: { slug: true, displayName: true, publishedAt: true, suspendedAt: true },
          },
        },
      },
    },
    orderBy: [{ documentId: "asc" }, { productId: "asc" }],
  });

  console.log(`  product_document rows: ${total}`);
  if (offending.length === 0) {
    console.log("  none of them points at a document a public page may not name.");
    return;
  }

  /*
     Grouped by kind first, because the two halves read differently. A
     `trade_licence` or a `vat_certificate` is the promise in the hint; an
     `enquiry_attachment` or a `thread_attachment` is a file somebody sent in
     private, which is the same leak arriving from the other side.
  */
  const byKind = new Map<string, typeof offending>();
  for (const row of offending) {
    const list = byKind.get(row.document.kind) ?? [];
    list.push(row);
    byKind.set(row.document.kind, list);
  }

  console.log(`  ${offending.length} of them do:`);
  for (const [kind, rows] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    const documents = new Set(rows.map((row) => row.document.id)).size;
    const live = rows.filter(
      (row) =>
        row.product.status === "live" &&
        row.product.business?.publishedAt !== null &&
        row.product.business?.suspendedAt === null,
    ).length;
    console.log(
      `    ${kind}: ${rows.length} rows · ${documents} documents · ${live} on a page a buyer can reach`,
    );
  }

  console.log("");
  for (const row of offending) {
    const name = row.document.displayName ?? row.document.filename;
    const seller = row.product.business?.displayName ?? "—";
    console.log(
      `    ${row.document.kind}  ${row.document.id}  "${name}"  →  ${seller} · ${row.product.name} (${row.product.status})`,
    );
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
