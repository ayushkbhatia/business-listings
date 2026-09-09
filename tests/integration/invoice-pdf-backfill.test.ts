import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { issueInvoice } from "@/lib/billing/invoice";
import { INVOICE_BUCKET, removeObject } from "@/lib/storage";
import { writeInvoicePdf } from "@/lib/billing/issue-pdf";
import { writeMissingInvoicePdfs } from "@/lib/billing/pdf-backfill";

/**
 * The follow-up board 11g left open.
 *
 * 11g made a failed PDF write **recoverable** rather than fatal: the invoice
 * commits, the file is written after, and a failure leaves `pdfPath` null —
 * which the screen reads and states. That was the right shape and it was only
 * half of it. Nothing ever tried again, and nothing said there was anything to
 * try: `putInvoicePdf` warned to a console, which inside a serverless function
 * is a message with no reader. A storage outage during the nightly renewals
 * therefore left that night's invoices undownloadable for good, and the first
 * anybody would hear of it is an accountant asking a seller for a document.
 *
 * What is asserted here holds whether or not object storage is reachable, which
 * is deliberate: CI runs `supabase start` without creating the buckets, so the
 * write genuinely fails there — and a failing write that is *reported* is
 * exactly the behaviour this test exists for.
 */

let businessId = "";
const written: string[] = [];
/** Files whose row no longer names them, so `afterAll` still can. */
const orphaned: string[] = [];

beforeAll(async () => {
  const business = await prisma.business.findFirstOrThrow({
    where: { subscription: { isNot: null } },
    orderBy: { slug: "asc" },
    select: { id: true },
  });
  businessId = business.id;
});

afterAll(async () => {
  /*
     The objects go too, not only the rows.

     Invoice documents live in their own bucket precisely so nothing ever sweeps
     them — a "delete uploaded documents" job must not reach an invoice — which
     means a test that leaves files behind leaves them for good.
  */
  const stored = await prisma.invoice.findMany({
    where: { id: { in: written }, pdfPath: { not: null } },
    select: { pdfPath: true },
  });
  for (const invoice of stored) {
    if (invoice.pdfPath) await removeObject(INVOICE_BUCKET, invoice.pdfPath);
  }
  // Including the one this suite deliberately forgot the path to.
  for (const path of orphaned) await removeObject(INVOICE_BUCKET, path);

  await prisma.invoice.deleteMany({ where: { id: { in: written } } });
  await prisma.$disconnect();
});

async function issue(status: "issued" | "draft" | "void" = "issued") {
  const invoice = await issueInvoice({
    businessId,
    issuedAt: new Date(),
    lines: [{ kind: "subscription", description: "Pro subscription", fils: 89_900 }],
  });
  written.push(invoice.id);
  if (status !== "issued") {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status } });
  }
  return invoice;
}

describe("what the sweep looks at", () => {
  it("finds an issued invoice with no document behind it", async () => {
    const invoice = await issue();
    const result = await writeMissingInvoicePdfs(50);

    expect(result.considered).toBeGreaterThan(0);
    // Every one it looked at was either written or reported. Nothing is
    // attempted and then dropped on the floor, which is the whole defect.
    expect(result.written + result.failed).toBe(result.considered);

    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { pdfPath: true, pdfBytes: true },
    });
    // Written or not, the two columns move together or neither does — the check
    // constraint refuses a path with no size.
    expect(after.pdfPath === null).toBe(after.pdfBytes === null);
  });

  it("never touches a draft or a void one", async () => {
    /*
       A draft has no number a seller should quote and nothing to evidence. A
       void invoice was withdrawn, and a document for it would be a document for
       something that did not happen. Counting either would make `outstanding`
       a number that never reaches zero.
    */
    const draft = await issue("draft");
    const voided = await issue("void");

    await writeMissingInvoicePdfs(50);

    const rows = await prisma.invoice.findMany({
      where: { id: { in: [draft.id, voided.id] } },
      select: { pdfPath: true },
    });
    expect(rows.every((row) => row.pdfPath === null)).toBe(true);
  });

  it("skips one that already has a document", async () => {
    const invoice = await issue();
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfPath: `pretend/${invoice.id}.pdf`, pdfBytes: 1024 },
    });

    const result = await writeMissingInvoicePdfs(50);
    const ids = await prisma.invoice.findMany({
      where: { pdfPath: null, status: { notIn: ["draft", "void"] } },
      select: { id: true },
    });
    expect(ids.map((row) => row.id)).not.toContain(invoice.id);
    expect(result.outstanding).toBe(ids.length);
  });
});

describe("what the sweep reports", () => {
  it("carries the reason back rather than logging it", async () => {
    /*
       The point of the whole change, at the layer it starts from. A failure
       used to be a `console.warn` and a null return, so a run that wrote
       nothing and a run with nothing to write produced the same silence.
    */
    expect(await writeInvoicePdf("no-such-invoice")).toEqual({
      ok: false,
      skipped: false,
      reason: "no such invoice",
    });
  });

  it("reports a refused write instead of counting it as done", async () => {
    /*
       A deterministic failure, whichever way the environment falls.

       With storage reachable, the first pass writes the file and the second is
       refused — `putInvoicePdf` uploads with `upsert: false`, because the one
       document a seller filed with their accountant must not be replaceable.
       With storage absent, as in CI, the first pass fails on the missing
       bucket. Both are failures the sweep has to name.
    */
    const invoice = await issue();
    await writeMissingInvoicePdfs(50);
    // Forget the file without deleting it, which is the shape of the real
    // failure: a write that half-happened.
    const before = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { pdfPath: true },
    });
    if (before.pdfPath) orphaned.push(before.pdfPath);
    await prisma.invoice.updateMany({
      where: { id: invoice.id },
      data: { pdfPath: null, pdfBytes: null },
    });

    const result = await writeMissingInvoicePdfs(50);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.every((reason) => reason.length > 0)).toBe(true);
    // And it is still outstanding, so tomorrow's run finds it again.
    expect(result.outstanding).toBeGreaterThan(0);
  });

  it("counts the whole backlog, not the page it just walked", async () => {
    // `considered - written` says nothing about how much is left once a limit
    // is in play, and a step reporting `written: 50` with forty still missing
    // reads as finished.
    await issue();
    await issue();
    const result = await writeMissingInvoicePdfs(1);

    expect(result.considered).toBe(1);
    expect(result.capped).toBe(true);

    const missing = await prisma.invoice.count({
      where: { pdfPath: null, status: { notIn: ["draft", "void"] } },
    });
    expect(result.outstanding).toBe(missing);
  });

  it("says nothing was capped when it reached the end", async () => {
    const result = await writeMissingInvoicePdfs(500);
    expect(result.capped).toBe(false);
  });
});

describe("a document that cannot be compliant is never frozen", () => {
  /**
   * Board 11g's follow-up audit.
   *
   * `writeInvoicePdf` refused a draft and nothing else, and `pdfPath` is written
   * once and never re-rendered. So an invoice raised before board 11g froze the
   * supplier snapshot — `supplierName` null, which `documentOf` maps to an empty
   * string — was rendered with **no supplier in the head** and then frozen that
   * way, permanently, by a backfill whose whole purpose was to repair the
   * absence of a document.
   */
  it("refuses an invoice with no supplier snapshot, with a reason somebody can read", async () => {
    const invoice = await issue();
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { supplierName: null },
    });

    const result = await writeInvoicePdf(invoice.id);
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toContain("supplier");

    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { pdfPath: true, pdfBytes: true },
    });
    // Nothing written, so the next run can still repair it once the snapshot is
    // there. A frozen bad document could not be.
    expect(after.pdfPath).toBeNull();
    expect(after.pdfBytes).toBeNull();
  });

  it("carries that refusal into the sweep's own report rather than losing it", async () => {
    // The sweep counts it as a failure with its reason, which is what puts it
    // in the daily job's step report. A silent skip would leave an invoice with
    // no document and nobody looking for it.
    const invoice = await issue();
    await prisma.invoice.update({ where: { id: invoice.id }, data: { supplierName: null } });

    const result = await writeMissingInvoicePdfs(50);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.reasons.join(" ")).toContain("supplier");
  });
});
