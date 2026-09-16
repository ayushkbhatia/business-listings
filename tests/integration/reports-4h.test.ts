import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { assignReport, escalateReport, markDuplicate } from "@/lib/reports/decide";
import { applyDetectorRules, readDetectorRules } from "@/lib/reports/detector-settings";
import { DEFAULT_DETECTOR_RULES, DETECTOR_SETTING_KEY } from "@/lib/reports/detector-rules";
import { runReportDetectorsIn } from "@/lib/reports/detectors";
import { fileListingReport } from "@/lib/reports/file";
import { reportOutcomes } from "@/lib/reports/outcomes";
import { loadReportQueue, reportQueueHealth } from "@/lib/reports/queue";
import { reportDetail, resolveReport } from "@/lib/reports/service";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board 4h — the queue, end to end.
 *
 * What is proved here is the four things that would each be a defect a reader
 * of the screen could not see: three reports of one fact are one decision
 * (`B6`), an escalation is not an outcome (`B2`), a detector files once and
 * then stays quiet, and the public can reach this queue at all.
 */

const PREFIX = "reports4h-";

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let financeId: string;
let buyerId: string;
let secondBuyerId: string;
let categoryId: string;
let areaId: string;
let seq = 0;

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
    subject: {
      in: [
        ...ids.map((id) => `Business:${id}`),
        ...reports.map((report) => `SupplierReport:${report.id}`),
      ],
    },
  });
  // A duplicate cascades from the decision it points at; both go with the row.
  await prisma.supplierReport.deleteMany({ where: { subjectBusinessId: { in: ids } } });
  await prisma.location.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  const staff = await prisma.user.findMany({
    where: { roles: { hasSome: ["staff_ops_lead", "staff_moderator", "staff_finance"] } },
    orderBy: { id: "asc" },
    select: { id: true, roles: true },
  });
  const byRole = (role: Role) => staff.find((u) => u.roles.includes(role))!.id;
  opsLeadId = byRole("staff_ops_lead");
  moderatorId = byRole("staff_moderator");
  financeId = byRole("staff_finance");

  const buyers = await prisma.user.findMany({
    where: { roles: { has: "buyer" } },
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  buyerId = buyers[0]!.id;
  secondBuyerId = buyers[1]?.id ?? buyers[0]!.id;

  categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;

  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
  // The thresholds are one row shared by the whole console. Put it back.
  await prisma.platformSetting.deleteMany({ where: { key: DETECTOR_SETTING_KEY } });
});

async function listing(name: string, over: { phone?: string; licenceExpiry?: Date } = {}) {
  seq += 1;
  /*
     Base 36, not a raw millisecond stamp.

     `render()` refuses a param whose value looks like contact details, and a
     display name carrying fifteen consecutive digits looks exactly like a
     telephone number — so a fixture named `Collapse 175873…` made every
     `report_resolved` notification throw inside `safely()`, silently. Short and
     still unique.
  */
  const stamp = `${Date.now().toString(36)}${String(seq).padStart(2, "0")}`;
  return prisma.business.create({
    data: {
      tradeName: `${name} ${stamp}`,
      displayName: `${name} ${stamp}`,
      slug: `${PREFIX}${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: over.licenceExpiry ?? new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Warehouse 3, Street 12",
          published: true,
          ...(over.phone ? { phone: over.phone, phoneVerified: true } : {}),
        },
      },
    },
    select: { id: true, slug: true },
  });
}

async function report(
  businessId: string,
  over: {
    kind?: "wrong_details" | "closed" | "content" | "accepted_quote";
    field?: string | null;
    reporterId?: string | null;
    ago?: number;
  } = {},
) {
  return prisma.supplierReport.create({
    data: {
      subjectBusinessId: businessId,
      reporterId: over.reporterId === undefined ? buyerId : over.reporterId,
      kind: over.kind ?? "wrong_details",
      subjectField: over.field === undefined ? "phone" : over.field,
      detail: "The landline rings a different company.",
      createdAt: new Date(Date.now() - (over.ago ?? 0)),
    },
    select: { id: true },
  });
}

/** Only this suite's rows, whatever else the seed left in the queue. */
async function ourQueue() {
  const view = await loadReportQueue({});
  return view.all.filter((entry) => entry.businessSlug.startsWith(PREFIX));
}

describe("B6 — three reports of one fact are one work item", () => {
  it("collapses them into one row carrying the count", async () => {
    const business = await listing("Collapse");
    await report(business.id, { ago: 3 * 86_400_000 });
    await report(business.id, { ago: 2 * 86_400_000, reporterId: secondBuyerId });
    await report(business.id, { ago: 86_400_000, reporterId: null });

    const rows = (await ourQueue()).filter((entry) => entry.businessId === business.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reports).toBe(3);
    expect(rows[0]!.duplicateIds).toHaveLength(2);
    // The work item is the oldest of the group, which is what the age measures.
    expect(rows[0]!.filedAt.getTime()).toBeLessThan(Date.now() - 2 * 86_400_000);
  });

  it("closes the rest of the group with the one decision, as duplicates", async () => {
    const business = await listing("Decide Group");
    const head = await report(business.id, { ago: 3 * 86_400_000 });
    await report(business.id, { ago: 2 * 86_400_000, reporterId: secondBuyerId });
    await report(business.id, { ago: 86_400_000, reporterId: secondBuyerId });

    const result = await resolveReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: head.id,
      outcome: "seller_corrected",
      reason: "Seller replaced the landline with the one that answers. Checked by calling it.",
    });
    expect(result).toMatchObject({ ok: true, alsoClosed: 2 });

    const rows = await prisma.supplierReport.findMany({
      where: { subjectBusinessId: business.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, outcome: true, duplicateOfId: true, resolvedById: true },
    });
    expect(rows.map((row) => row.outcome)).toEqual([
      "seller_corrected",
      "duplicate",
      "duplicate",
    ]);
    // Each duplicate points at the decision, which is where its reason lives.
    expect(rows.slice(1).every((row) => row.duplicateOfId === head.id)).toBe(true);
    expect(rows.every((row) => row.resolvedById === moderatorId)).toBe(true);
  });

  it("writes back to everybody in the group, not only the row that was opened (Q5)", async () => {
    const business = await listing("Everyone Told");
    const head = await report(business.id, { ago: 2 * 86_400_000, reporterId: buyerId });
    await report(business.id, { ago: 86_400_000, reporterId: secondBuyerId });

    const before = await prisma.notificationDelivery.count({ where: { event: "report_resolved" } });
    await resolveReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: head.id,
      outcome: "seller_corrected",
      reason: "Number corrected on the listing and confirmed by ringing it.",
    });

    /*
       Both reporters, on both channels the buyer matrix routes this to. Three
       people asked and three people are owed the answer — telling only the
       first would make the collapse a thing that costs the other two a reply.
    */
    const after = await prisma.notificationDelivery.findMany({
      where: { event: "report_resolved" },
      select: { recipientUserId: true },
    });
    expect(after.length).toBeGreaterThan(before);
    const told = new Set(after.map((row) => row.recipientUserId));
    expect(told.has(buyerId)).toBe(true);
    expect(told.has(secondBuyerId)).toBe(true);
  });

  it("writes one audit row for one decision, not one per record", async () => {
    const business = await listing("One Decision");
    const head = await report(business.id, { ago: 2 * 86_400_000 });
    await report(business.id, { ago: 86_400_000, reporterId: secondBuyerId });

    await resolveReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: head.id,
      outcome: "no_action",
      reason: "Rang the number twice. It is theirs and it answers.",
    });

    const rows = await prisma.auditEvent.findMany({
      where: { subject: { startsWith: "SupplierReport:" }, action: "report_resolved" },
      select: { subject: true, after: true },
    });
    const ours = rows.filter((row) => row.subject === `SupplierReport:${head.id}`);
    expect(ours).toHaveLength(1);
    expect(ours[0]!.after).toMatchObject({ duplicatesClosed: 1 });
  });

  it("never groups two reports about two different accepted quotes", async () => {
    /*
       The one case where collapsing would close a buyer's complaint on somebody
       else's evidence: two trades, two records, one supplier.
    */
    const business = await listing("Two Quotes");
    await report(business.id, { kind: "accepted_quote", field: "accepted_quote", ago: 86_400_000 });
    await report(business.id, {
      kind: "accepted_quote",
      field: "accepted_quote",
      reporterId: secondBuyerId,
    });

    const rows = (await ourQueue()).filter((entry) => entry.businessId === business.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.reports === 1)).toBe(true);
  });

  it("refuses a duplicate that points across businesses, or at another duplicate", async () => {
    const a = await listing("Dup A");
    const b = await listing("Dup B");
    const first = await report(a.id, { field: "address" });
    const other = await report(b.id, { field: "address" });
    const second = await report(a.id, { field: "photo", kind: "content" });

    await expect(
      markDuplicate({
        actor: actor(moderatorId, "staff_moderator"),
        reportId: second.id,
        duplicateOfId: other.id,
        reason: "Not the same business.",
      }),
    ).resolves.toMatchObject({ ok: false, error: "not_a_duplicate" });

    await expect(
      markDuplicate({
        actor: actor(moderatorId, "staff_moderator"),
        reportId: second.id,
        duplicateOfId: first.id,
        reason: "Same photograph, reported twice under two headings.",
      }),
    ).resolves.toMatchObject({ ok: true });

    // And a chain: pointing at something that is itself a duplicate.
    const third = await report(a.id, { field: "website" });
    await expect(
      markDuplicate({
        actor: actor(moderatorId, "staff_moderator"),
        reportId: third.id,
        duplicateOfId: second.id,
        reason: "Chaining one duplicate onto another.",
      }),
    ).resolves.toMatchObject({ ok: false, error: "not_a_duplicate" });
  });
});

describe("B2 — escalation is not a suspension and not an outcome", () => {
  it("leaves the report open, takes the owner off, and audits the reason", async () => {
    const business = await listing("Escalate");
    const row = await report(business.id, { kind: "content", field: "photo" });

    await assignReport({
      actor: actor(opsLeadId, "staff_ops_lead"),
      ref: `report:${row.id}`,
      assigneeId: moderatorId,
      reason: "Taking the content ones this week.",
    });

    const result = await escalateReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: row.id,
      reason: "Third watermark from this account. The decision is about the account, not the photo.",
    });
    expect(result).toMatchObject({ ok: true });

    const after = await prisma.supplierReport.findUniqueOrThrow({
      where: { id: row.id },
      select: { outcome: true, escalatedAt: true, escalatedById: true, assigneeId: true },
    });
    // Still waiting. Escalation moves who owns the decision and nothing else.
    expect(after.outcome).toBeNull();
    expect(after.escalatedAt).not.toBeNull();
    expect(after.escalatedById).toBe(moderatorId);
    expect(after.assigneeId).toBeNull();

    const audit = await prisma.auditEvent.findMany({
      where: { subject: `SupplierReport:${row.id}` },
      select: { action: true, reason: true },
    });
    expect(audit.map((entry) => entry.action).sort()).toEqual([
      "report_assigned",
      "report_escalated",
    ]);
    expect(audit.every((entry) => entry.reason.length > 4)).toBe(true);
  });

  it("changes nothing about the business", async () => {
    const business = await listing("No Suspension");
    const row = await report(business.id);
    await escalateReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: row.id,
      reason: "Needs an ops lead.",
    });
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { suspendedAt: true, closureRequestedAt: true, publishedAt: true },
    });
    expect(after.suspendedAt).toBeNull();
    expect(after.closureRequestedAt).toBeNull();
    expect(after.publishedAt).not.toBeNull();
  });

  it("refuses a seat that cannot work the queue, on both writes", async () => {
    const business = await listing("Finance Refused");
    const row = await report(business.id);
    await expect(
      escalateReport({
        actor: actor(financeId, "staff_finance"),
        reportId: row.id,
        reason: "Not my queue.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
    await expect(
      assignReport({
        actor: actor(financeId, "staff_finance"),
        ref: `report:${row.id}`,
        assigneeId: moderatorId,
        reason: "Not my queue.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("refuses an owner who cannot work the queue", async () => {
    const business = await listing("Bad Owner");
    const row = await report(business.id);
    await expect(
      assignReport({
        actor: actor(opsLeadId, "staff_ops_lead"),
        ref: `report:${row.id}`,
        assigneeId: financeId,
        reason: "Finance does not work this queue.",
      }),
    ).resolves.toMatchObject({ ok: false, error: "not_staff" });
  });
});

describe("B11 — the detectors", () => {
  it("files one report per business sharing a number, and then stays quiet", async () => {
    const number = `+9714${String(Date.now()).slice(-7)}`;
    const a = await listing("Shared A", { phone: number });
    const b = await listing("Shared B", { phone: number });
    const c = await listing("Shared C", { phone: number });

    const first = await runReportDetectorsIn(prisma, DEFAULT_DETECTOR_RULES, new Date());
    expect(first.sharedPhone.filed).toBeGreaterThanOrEqual(3);

    const ours = await prisma.supplierReport.findMany({
      where: { subjectBusinessId: { in: [a.id, b.id, c.id] }, detector: "shared_phone" },
      select: { subjectBusinessId: true, evidence: true, subjectField: true, reporterId: true },
    });
    expect(ours).toHaveLength(3);
    // The measurement, not a score: the board's `88% CONFIDENCE` has no writer.
    expect(ours.every((row) => row.evidence === "Same number on 3 listings")).toBe(true);
    expect(ours.every((row) => row.subjectField === "phone")).toBe(true);
    expect(ours.every((row) => row.reporterId === null)).toBe(true);

    // A second night files nothing: the findings are still open.
    const second = await runReportDetectorsIn(prisma, DEFAULT_DETECTOR_RULES, new Date());
    const after = await prisma.supplierReport.count({
      where: { subjectBusinessId: { in: [a.id, b.id, c.id] }, detector: "shared_phone" },
    });
    expect(after).toBe(3);
    expect(second.sharedPhone.filed).toBe(0);
  });

  it("stays quiet for the cooling window after a finding is closed", async () => {
    const number = `+9714${String(Date.now() + 1).slice(-7)}`;
    const a = await listing("Cool A", { phone: number });
    await listing("Cool B", { phone: number });
    await listing("Cool C", { phone: number });
    await runReportDetectorsIn(prisma, DEFAULT_DETECTOR_RULES, new Date());

    const finding = await prisma.supplierReport.findFirstOrThrow({
      where: { subjectBusinessId: a.id, detector: "shared_phone" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    await resolveReport({
      actor: actor(moderatorId, "staff_moderator"),
      reportId: finding.id,
      outcome: "no_action",
      reason: "One group, two trading names, one switchboard. Confirmed with the owner.",
    });

    await runReportDetectorsIn(prisma, DEFAULT_DETECTOR_RULES, new Date());
    expect(
      await prisma.supplierReport.count({
        where: { subjectBusinessId: a.id, detector: "shared_phone" },
      }),
    ).toBe(1);
  });

  it("does not report a business that is already being closed", async () => {
    const expired = new Date(Date.now() - 400 * 86_400_000);
    const quiet = await listing("Already Closing", { licenceExpiry: expired });
    /*
       Unpublished with the closure, because `business_closure_unpublishes`
       refuses anything else — which is the constraint that makes the sweep's
       own `closureRequestedAt` filter belt-and-braces rather than the guard.
    */
    await prisma.business.update({
      where: { id: quiet.id },
      data: { closureRequestedAt: new Date(), publishedAt: null },
    });
    const loud = await listing("Lapsed", { licenceExpiry: expired });

    await runReportDetectorsIn(prisma, DEFAULT_DETECTOR_RULES, new Date());
    expect(
      await prisma.supplierReport.count({
        where: { subjectBusinessId: quiet.id, detector: "licence_long_expired" },
      }),
    ).toBe(0);
    const found = await prisma.supplierReport.findFirstOrThrow({
      where: { subjectBusinessId: loud.id, detector: "licence_long_expired" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { kind: true, evidence: true },
    });
    expect(found.kind).toBe("closed");
    expect(found.evidence).toMatch(/^Licence expired \d+ months ago$/);
  });

  it("stores a threshold with an audit row, and refuses one outside its bounds", async () => {
    const applied = await applyDetectorRules({
      actor: actor(opsLeadId, "staff_ops_lead"),
      rules: { ...DEFAULT_DETECTOR_RULES, sharedPhoneListings: 4 },
      reason: "Two trading names on one switchboard is ordinary. Four is not.",
    });
    expect(applied).toMatchObject({ ok: true });
    expect((await readDetectorRules()).sharedPhoneListings).toBe(4);

    const audit = await prisma.auditEvent.findFirst({
      where: { subject: `PlatformSetting:${DETECTOR_SETTING_KEY}` },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { action: true, reason: true },
    });
    expect(audit?.action).toBe("report_detectors_tuned");

    await expect(
      applyDetectorRules({
        actor: actor(opsLeadId, "staff_ops_lead"),
        rules: { ...DEFAULT_DETECTOR_RULES, sharedPhoneListings: 1 },
        reason: "One listing is every listing.",
      }),
    ).resolves.toMatchObject({ ok: false });

    await expect(
      applyDetectorRules({
        actor: actor(moderatorId, "staff_moderator"),
        rules: DEFAULT_DETECTOR_RULES,
        reason: "Not my line to move.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);

    await prisma.platformSetting.deleteMany({ where: { key: DETECTOR_SETTING_KEY } });
    await purgeAuditRows({ subject: `PlatformSetting:${DETECTOR_SETTING_KEY}` });
  });
});

describe("the public can reach this queue", () => {
  it("files a report from a listing, from a signed-in buyer and from nobody", async () => {
    const business = await listing("Public");

    const signedIn = await fileListingReport({
      slug: business.slug,
      kind: "wrong_details",
      field: "phone",
      detail: "Called the number and reached a car rental company in Al Quoz.",
      reporterId: buyerId,
      requester: `test-${Date.now()}-a`,
    });
    expect(signedIn).toMatchObject({ ok: true, willHearBack: true });

    const anonymous = await fileListingReport({
      slug: business.slug,
      kind: "closed",
      field: "address",
      detail: "The unit is empty and the signage has gone. Neighbour says they left in June.",
      reporterId: null,
      requester: `test-${Date.now()}-b`,
    });
    // No account, so no reply — and the form says so at the point of filing.
    expect(anonymous).toMatchObject({ ok: true, willHearBack: false });
  });

  it("refuses a field that does not belong to the kind, and a second open report", async () => {
    const business = await listing("Public Refusals");
    const good = {
      slug: business.slug,
      kind: "content" as const,
      field: "photo",
      detail: "The third photograph carries another supplier's watermark.",
      reporterId: buyerId,
    };
    await expect(
      fileListingReport({ ...good, field: "hours", requester: `test-${Date.now()}-c` }),
    ).resolves.toMatchObject({ ok: false, error: "invalid_field" });
    await expect(
      fileListingReport({ ...good, requester: `test-${Date.now()}-d` }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      fileListingReport({ ...good, requester: `test-${Date.now()}-e` }),
    ).resolves.toMatchObject({ ok: false, error: "already_reported" });
  });

  it("refuses a listing nobody can see", async () => {
    const business = await listing("Unpublished");
    await prisma.business.update({ where: { id: business.id }, data: { publishedAt: null } });
    await expect(
      fileListingReport({
        slug: business.slug,
        kind: "wrong_details",
        field: "phone",
        detail: "The number on the page does not work at all.",
        reporterId: buyerId,
        requester: `test-${Date.now()}-f`,
      }),
    ).resolves.toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("what the console and the rail read", () => {
  it("counts both tables, so the badge and the header cannot disagree", async () => {
    const [health, view] = await Promise.all([reportQueueHealth(), loadReportQueue({})]);
    expect(health.open).toBe(view.total);
    // A dispute is in the queue, which the old count of one table was not.
    expect(view.counts.review_dispute).toBe(
      view.all.filter((entry) => entry.type === "review_dispute").length,
    );
  });

  it("reconciles the header, the chips and the rows off one array", async () => {
    const view = await loadReportQueue({});
    const summed = Object.values(view.counts).reduce((sum, count) => sum + count, 0);
    expect(summed).toBe(view.total);
    expect(view.records).toBeGreaterThanOrEqual(view.total);
  });

  it("reports four outcome buckets and a median over the window", async () => {
    const outcomes = await reportOutcomes();
    const summed =
      outcomes.counts.seller_corrected +
      outcomes.counts.upheld +
      outcomes.counts.no_action +
      outcomes.counts.duplicate;
    expect(summed).toBe(outcomes.decided);
    if (outcomes.decided > 0) {
      expect(outcomes.shares).not.toBeNull();
      const shares = Object.values(outcomes.shares!).reduce((sum, share) => sum + share, 0);
      expect(shares).toBeCloseTo(1, 6);
      expect(outcomes.medianMs).not.toBeNull();
    }
  });

  it("answers for every report kind on the detail route, not only the one with an enquiry", async () => {
    const business = await listing("Detail");
    const row = await report(business.id, { kind: "closed", field: "address" });
    const detail = await reportDetail(row.id);
    expect(detail).not.toBeNull();
    expect(detail!.report.subjectBusiness.slug).toBe(business.slug);
    expect(detail!.priors.onField).toBeGreaterThanOrEqual(1);
  });
});
