import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor, Role } from "@/lib/auth/roles";
import { fileListingReport } from "@/lib/reports/file";
import { reportFormData } from "@/lib/reports/form";
import { loadReportQueue } from "@/lib/reports/queue";
import { isReference } from "@/lib/reports/reference";
import { reportDetail, resolveReport } from "@/lib/reports/service";
import { reportStatus } from "@/lib/reports/status";
import { fieldsFor, kindsFor, reportSubject } from "@/lib/reports/subject";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board 13c — *Report a listing*, end to end, from the form's write to the
 * queue's flag to the one message an address buys.
 *
 * What is proved here is what the export's two corrections asked the modal to
 * capture, and what each capture is then for:
 *
 *   - the value, read from the listing and never from the form, and grouped
 *     across listings (`B1`, `B2`);
 *   - the licence record's answer on every report (`B3`);
 *   - a reference, and an address used once (`B4`, `B5`);
 *   - one source is one signal, and a listing has a ceiling (`B8`);
 *   - the trade it should be (`B9`), and a report changes nothing public (`B11`).
 */

const PREFIX = "reports13c-";
const DAY = 86_400_000;

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let moderatorId: string;
let buyerId: string;
let categoryId: string;
let otherCategoryId: string;
let areaId: string;
let seq = 0;

/** A requester digest nobody else in the suite uses. */
function requester(label: string): string {
  seq += 1;
  return `13c-${label}-${Date.now().toString(36)}-${seq}`;
}

async function removeFixtures() {
  const ours = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = ours.map((row) => row.id);
  if (ids.length === 0) return;
  const reports = await prisma.supplierReport.findMany({
    where: { subjectBusinessId: { in: ids } },
    select: { id: true },
  });
  await purgeAuditRows({
    subject: { in: reports.map((report) => `SupplierReport:${report.id}`) },
  });
  await prisma.rateLimitHit.deleteMany({
    where: { bucket: "listing_report_subject", identifier: { in: ids } },
  });
  await prisma.supplierReport.deleteMany({ where: { subjectBusinessId: { in: ids } } });
  await prisma.media.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.location.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
  buyerId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" } },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
  const categories = await prisma.category.findMany({
    where: { parentId: { not: null }, showInIndex: true },
    orderBy: [{ id: "asc" }],
    take: 2,
    select: { id: true },
  });
  categoryId = categories[0]!.id;
  otherCategoryId = categories[1]!.id;
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;
  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
});

async function listing(
  name: string,
  over: { phone?: string; licenceExpiry?: Date; hours?: object; photo?: boolean; unclaimed?: boolean } = {},
) {
  seq += 1;
  const stamp = `${Date.now().toString(36)}${String(seq).padStart(2, "0")}`;
  const business = await prisma.business.create({
    data: {
      tradeName: `${name} ${stamp}`,
      displayName: `${name} ${stamp}`,
      slug: `${PREFIX}${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      licenceNumber: `CN-${stamp.slice(-7)}`,
      licenceAuthority: "DED",
      licenceExpiry: over.licenceExpiry ?? new Date(Date.now() + 300 * DAY),
      primaryCategoryId: categoryId,
      claimStatus: over.unclaimed ? "unclaimed" : "claimed",
      publishedAt: new Date(),
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Shop 4, Naif Road",
          published: true,
          ...(over.hours ? { hours: over.hours } : {}),
          ...(over.phone ? { phone: over.phone, phoneVerified: true } : {}),
        },
      },
      ...(over.photo
        ? { media: { create: { kind: "gallery", storagePath: `test/${stamp}.jpg`, filename: "unit.jpg" } } }
        : {}),
    },
    select: { id: true, slug: true, updatedAt: true },
  });
  return business;
}

describe("B1, B2 — the field, the value, and what it should say", () => {
  it("reads the value from the listing, normalised, and keeps the correction apart from it", async () => {
    const business = await listing("Value", { phone: "+971 4 227 8890" });
    const result = await fileListingReport({
      slug: business.slug,
      kind: "wrong_details",
      field: "phone",
      detail: null,
      correction: "04 227 9901",
      reporterId: null,
      requester: requester("value"),
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;

    const row = await prisma.supplierReport.findUniqueOrThrow({
      where: { id: result.reportId },
      select: { subjectValueKey: true, subjectValue: true, suggestedValue: true, reporterKey: true },
    });
    expect(row.subjectValueKey).toBe("42278890");
    expect(row.subjectValue).toBe("+971 4 227 8890");
    // What they typed is a claim beside the value, never the key it groups on.
    expect(row.suggestedValue).toBe("04 227 9901");
    expect(row.reporterKey).not.toBeNull();
  });

  it("drops a correction on a field that does not take one, and refuses one too long to be a value", async () => {
    const business = await listing("Corrections", { photo: true });
    const photo = await fileListingReport({
      slug: business.slug,
      kind: "content",
      field: "photo",
      detail: "Another supplier's watermark, bottom right.",
      correction: "a different photograph",
      reporterId: null,
      requester: requester("photo"),
    });
    expect(photo).toMatchObject({ ok: true });
    if (photo.ok) {
      const row = await prisma.supplierReport.findUniqueOrThrow({
        where: { id: photo.reportId },
        select: { suggestedValue: true, subjectValueKey: true },
      });
      expect(row).toEqual({ suggestedValue: null, subjectValueKey: null });
    }

    await expect(
      fileListingReport({
        slug: business.slug,
        kind: "wrong_details",
        field: "name",
        detail: null,
        correction: "x".repeat(161),
        reporterId: null,
        requester: requester("long"),
      }),
    ).resolves.toMatchObject({ ok: false, error: "correction_too_long" });
  });

  it("offers only what the listing shows, and fills the field in where there is one choice", async () => {
    const bare = await listing("Bare");
    const subject = (await reportSubject(bare.slug))!;
    // No telephone, no hours, no photograph, no description, no website.
    expect(fieldsFor(subject, "wrong_details")).toEqual(["address", "name"]);
    expect(kindsFor(subject)).not.toContain("content");
    expect(fieldsFor(subject, "closed")).toEqual(["licence"]);

    const closed = await fileListingReport({
      slug: bare.slug,
      kind: "closed",
      field: null,
      detail: null,
      reporterId: null,
      requester: requester("closed"),
    });
    expect(closed).toMatchObject({ ok: true });

    // A field that does not belong is refused, never swapped for one that does.
    await expect(
      fileListingReport({
        slug: bare.slug,
        kind: "closed",
        field: "phone",
        detail: null,
        reporterId: null,
        requester: requester("swap"),
      }),
    ).resolves.toMatchObject({ ok: false, error: "invalid_field" });

    // A telephone the listing does not publish is not a thing to report.
    await expect(
      fileListingReport({
        slug: bare.slug,
        kind: "wrong_details",
        field: "phone",
        detail: null,
        reporterId: null,
        requester: requester("nophone"),
      }),
    ).resolves.toMatchObject({ ok: false, error: "invalid_field" });

    // An unclaimed page prints the licence record and nothing else, so a
    // number the import holds is not a number anybody read off this listing.
    const unclaimed = await listing("Unclaimed", {
      unclaimed: true,
      phone: "04 229 1100",
      hours: { sat: [["08:00", "18:00"]] },
      photo: true,
    });
    const unclaimedSubject = (await reportSubject(unclaimed.slug))!;
    expect(fieldsFor(unclaimedSubject, "wrong_details")).toEqual(["address", "name"]);
    expect(kindsFor(unclaimedSubject)).not.toContain("content");

    const form = await reportFormData(subject, false);
    expect(form.reasons.map((reason) => reason.value)).toEqual([
      "closed",
      "wrong_details",
      "wrong_trade",
      "claim_dispute",
    ]);
    // The claim door files nothing, so it offers no field.
    expect(form.reasons.at(-1)!.fields).toEqual([]);
    expect(form.claimHref).toMatch(/^\/onboarding\/claim\?q=/);
  });
});

describe("B2, B8 — three sources about one value flag it, and one source is one", () => {
  it("counts distinct sources across every listing carrying the value", async () => {
    const number = "+971 4 330 7788";
    const a = await listing("Shared A", { phone: number });
    const b = await listing("Shared B", { phone: "04 330 7788" });

    const first = await fileListingReport({
      slug: a.slug,
      kind: "wrong_details",
      field: "phone",
      detail: null,
      reporterId: null,
      requester: requester("s1"),
    });
    expect(first).toMatchObject({ ok: true });

    const second = await fileListingReport({
      slug: b.slug,
      kind: "wrong_details",
      field: "phone",
      detail: null,
      reporterId: null,
      requester: requester("s2"),
    });
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) return;
    // Written the same way twice — one number to the key.
    const written = await prisma.supplierReport.findUniqueOrThrow({
      where: { id: second.reportId },
      select: { evidence: true },
    });
    expect(written.evidence).toMatch(/^Same number on 2 listings/);

    let ours = (await loadReportQueue({})).all.filter((entry) => entry.businessSlug.startsWith(PREFIX));
    const beforeFlag = ours.find((entry) => entry.businessId === a.id)!;
    expect(beforeFlag.corroboration).toEqual({ sources: 2, listings: 2 });
    expect(beforeFlag.flagged).toBe(false);

    // A signed-in buyer is a third source.
    await fileListingReport({
      slug: a.slug,
      kind: "wrong_details",
      field: "phone",
      detail: null,
      reporterId: buyerId,
      requester: requester("s3"),
    });

    ours = (await loadReportQueue({})).all.filter((entry) => entry.businessSlug.startsWith(PREFIX));
    for (const id of [a.id, b.id]) {
      const entry = ours.find((row) => row.businessId === id)!;
      expect(entry.corroboration).toEqual({ sources: 3, listings: 2 });
      expect(entry.flagged).toBe(true);
    }
    const flagged = await loadReportQueue({ flagged: true });
    expect(flagged.rows.some((entry) => entry.businessId === a.id)).toBe(true);
  });

  it("refuses the same source twice about one field, and takes a different one", async () => {
    const business = await listing("Once", { phone: "050 998 1122" });
    const source = requester("once");
    const input = {
      slug: business.slug,
      kind: "wrong_details" as const,
      field: "phone",
      detail: null,
      reporterId: null,
    };
    await expect(fileListingReport({ ...input, requester: source })).resolves.toMatchObject({ ok: true });
    await expect(fileListingReport({ ...input, requester: source })).resolves.toMatchObject({
      ok: false,
      error: "already_reported",
    });
    await expect(fileListingReport({ ...input, requester: requester("twice") })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("closes the listing's door after twelve in an hour, whoever is asking", async () => {
    const business = await listing("Ceiling", { photo: true });
    const fields = ["name", "address"] as const;
    const kinds = [
      { kind: "wrong_details", field: "name" },
      { kind: "wrong_details", field: "address" },
      { kind: "closed", field: "licence" },
      { kind: "wrong_trade", field: "category" },
      { kind: "content", field: "photo" },
    ] as const;
    let filed = 0;
    for (let index = 0; index < 12; index += 1) {
      const pick = kinds[index % kinds.length]!;
      const result = await fileListingReport({
        slug: business.slug,
        kind: pick.kind,
        field: pick.field,
        detail: null,
        reporterId: null,
        requester: requester(`ceiling-${index}`),
      });
      if (result.ok) filed += 1;
    }
    expect(filed).toBe(12);
    await expect(
      fileListingReport({
        slug: business.slug,
        kind: "wrong_details",
        field: fields[0],
        detail: null,
        reporterId: null,
        requester: requester("thirteenth"),
      }),
    ).resolves.toMatchObject({ ok: false, error: "listing_rate_limited" });
  });
});

describe("B3 — every report carries the licence record's answer", () => {
  it("says a lapsed licence lapsed, and a good one is good", async () => {
    const lapsed = await listing("Lapsed", { licenceExpiry: new Date(Date.now() - 425 * DAY) });
    const good = await listing("Good");
    const [one, two] = await Promise.all([
      fileListingReport({
        slug: lapsed.slug,
        kind: "closed",
        field: null,
        detail: "Shutters down.",
        reporterId: null,
        requester: requester("lapsed"),
      }),
      fileListingReport({
        slug: good.slug,
        kind: "wrong_details",
        // The name, which is this fixture's alone. Every fixture here shares one
        // street address, and the spread would rightly lead the line.
        field: "name",
        detail: null,
        reporterId: null,
        requester: requester("good"),
      }),
    ]);
    const rows = await prisma.supplierReport.findMany({
      where: { id: { in: [one, two].flatMap((r) => (r.ok ? [r.reportId] : [])) } },
      orderBy: [{ id: "asc" }],
      select: { subjectBusinessId: true, evidence: true, subjectField: true, subjectValueKey: true },
    });
    const byBusiness = new Map(rows.map((row) => [row.subjectBusinessId, row]));
    expect(byBusiness.get(lapsed.id)).toMatchObject({
      evidence: "Licence expired 14 months ago",
      subjectField: "licence",
    });
    expect(byBusiness.get(lapsed.id)!.subjectValueKey).toMatch(/^CN/);
    expect(byBusiness.get(good.id)!.evidence).toMatch(/^Licence valid to /);
  });
});

describe("B9 — the trade it should be", () => {
  it("keeps a suggested trade on a trade report, and refuses the one it is already in", async () => {
    const business = await listing("Trade");
    const kept = await fileListingReport({
      slug: business.slug,
      kind: "wrong_trade",
      field: "category",
      detail: null,
      suggestedCategoryId: otherCategoryId,
      reporterId: null,
      requester: requester("trade"),
    });
    expect(kept).toMatchObject({ ok: true });
    if (kept.ok) {
      const row = await prisma.supplierReport.findUniqueOrThrow({
        where: { id: kept.reportId },
        select: { suggestedCategoryId: true },
      });
      expect(row.suggestedCategoryId).toBe(otherCategoryId);
    }

    await expect(
      fileListingReport({
        slug: business.slug,
        kind: "wrong_trade",
        field: "category",
        detail: null,
        suggestedCategoryId: categoryId,
        reporterId: null,
        requester: requester("same-trade"),
      }),
    ).resolves.toMatchObject({ ok: false, error: "invalid_category" });

    // Anywhere else it is ignored, and the database would refuse it anyway.
    const other = await fileListingReport({
      slug: business.slug,
      kind: "wrong_details",
      field: "name",
      detail: null,
      suggestedCategoryId: otherCategoryId,
      reporterId: null,
      requester: requester("stray"),
    });
    expect(other).toMatchObject({ ok: true });
    if (other.ok) {
      const row = await prisma.supplierReport.findUniqueOrThrow({
        where: { id: other.reportId },
        select: { suggestedCategoryId: true },
      });
      expect(row.suggestedCategoryId).toBeNull();
    }
  });
});

describe("B4, B5 — a reference, and an address used once", () => {
  it("gives every report a reference, and a signed-out reporter a way back", async () => {
    const business = await listing("Reply", { phone: "04 221 0099" });
    const anonymous = await fileListingReport({
      slug: business.slug,
      kind: "wrong_details",
      field: "phone",
      detail: null,
      reporterEmail: "  Someone@Example.AE ",
      reporterId: null,
      requester: requester("reply"),
    });
    expect(anonymous).toMatchObject({ ok: true, willHearBack: true, replyTo: "email" });
    if (!anonymous.ok) return;
    expect(isReference(anonymous.reference)).toBe(true);

    const stored = await prisma.supplierReport.findUniqueOrThrow({
      where: { id: anonymous.reportId },
      select: { reporterEmail: true },
    });
    expect(stored.reporterEmail).toBe("someone@example.ae");

    // Signed in, the account is the way back and no address is kept.
    const signedIn = await fileListingReport({
      slug: business.slug,
      kind: "wrong_details",
      field: "address",
      detail: null,
      reporterEmail: "kept@example.ae",
      reporterId: buyerId,
      requester: requester("account"),
    });
    expect(signedIn).toMatchObject({ ok: true, replyTo: "account" });
    if (signedIn.ok) {
      const row = await prisma.supplierReport.findUniqueOrThrow({
        where: { id: signedIn.reportId },
        select: { reporterEmail: true },
      });
      expect(row.reporterEmail).toBeNull();
    }

    await expect(
      fileListingReport({
        slug: business.slug,
        kind: "wrong_details",
        field: "name",
        detail: null,
        reporterEmail: "not an address",
        reporterId: null,
        requester: requester("bad-email"),
      }),
    ).resolves.toMatchObject({ ok: false, error: "invalid_email" });

    // Nobody to tell is said plainly, not implied.
    const silent = await fileListingReport({
      slug: business.slug,
      kind: "wrong_details",
      field: "name",
      detail: null,
      reporterId: null,
      requester: requester("silent"),
    });
    expect(silent).toMatchObject({ ok: true, willHearBack: false, replyTo: null });
  });

  it("never hands a moderator the address, and says only that there is one", async () => {
    const business = await listing("Private Address", { phone: "04 221 7711" });
    const filed = await fileListingReport({
      slug: business.slug,
      kind: "wrong_details",
      field: "phone",
      detail: null,
      reporterEmail: "private@example.ae",
      reporterId: null,
      requester: requester("private"),
    });
    if (!filed.ok) throw new Error("fixture did not file");
    const detail = (await reportDetail(filed.reportId))!;
    expect(detail.replyTo).toBe("email");
    expect(JSON.stringify(detail)).not.toContain("private@example.ae");
    expect(detail.report.reporterKey).toBeNull();
  });

  it("writes to the address once when decided, then forgets it, and the reference reads the outcome", async () => {
    const business = await listing("Decided", { phone: "04 221 5566" });
    const filed = await fileListingReport({
      slug: business.slug,
      kind: "wrong_details",
      field: "phone",
      detail: null,
      reporterEmail: "once@example.ae",
      reporterId: null,
      requester: requester("decided"),
    });
    if (!filed.ok) throw new Error("fixture did not file");

    const open = await reportStatus(filed.reference);
    expect(open).toMatchObject({ outcome: null, decidedAt: null, businessSlug: business.slug });
    expect(open!.slaDays).toBe(5);

    const since = new Date();
    await resolveReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: filed.reportId,
      outcome: "seller_corrected",
      reason: "Number corrected on the listing and confirmed by ringing it.",
    });

    const row = await prisma.supplierReport.findUniqueOrThrow({
      where: { id: filed.reportId },
      select: { reporterEmail: true, reporterEmailedAt: true, reporterKey: true },
    });
    expect(row.reporterEmail).toBeNull();
    // The digest counted an open report; a decided one keeps none.
    expect(row.reporterKey).toBeNull();
    // Gone, and on record as used — not read later as never given.
    expect(row.reporterEmailedAt).not.toBeNull();
    expect((await reportDetail(filed.reportId))!.replyTo).toBe("emailed");

    const deliveries = await prisma.notificationDelivery.findMany({
      where: { event: "report_resolved", channel: "email", recipientUserId: null, createdAt: { gte: since } },
      select: { status: true },
    });
    expect(deliveries.length).toBeGreaterThanOrEqual(1);

    const decided = await reportStatus(filed.reference);
    expect(decided).toMatchObject({ outcome: "seller_corrected" });
    expect(decided!.decidedAt).not.toBeNull();

    expect(await reportStatus("RP-00000000")).toBeNull();
    expect(await reportStatus("not a reference")).toBeNull();
  });
});

describe("B11 — a report never changes the listing", () => {
  it("leaves the business row as it was", async () => {
    const business = await listing("Untouched", { phone: "04 221 3344" });
    await fileListingReport({
      slug: business.slug,
      kind: "wrong_details",
      field: "phone",
      detail: "Rings a car rental company.",
      reporterId: null,
      requester: requester("untouched"),
    });
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { updatedAt: true },
    });
    expect(after.updatedAt.getTime()).toBe(business.updatedAt.getTime());
  });

  it("takes no report about a listing nobody can see", async () => {
    const business = await listing("Suspended");
    await prisma.business.update({ where: { id: business.id }, data: { suspendedAt: new Date() } });
    await expect(
      fileListingReport({
        slug: business.slug,
        kind: "closed",
        field: null,
        detail: null,
        reporterId: null,
        requester: requester("suspended"),
      }),
    ).resolves.toMatchObject({ ok: false, error: "not_found" });
  });
});
