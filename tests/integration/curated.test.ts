import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import {
  auditList,
  curatedList,
  DEFAULT_CRITERIA,
  driftQueue,
  liveLists,
  MAX_REPLY_MS,
  MIN_MEMBERS,
  MIN_REVIEWS,
  sweepCuratedLists,
} from "@/lib/seo/curated";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 6b, criterion 4 — and the criterion asks for this test by name.
 *
 *   "A curated list displays its selection criteria and cannot include a
 *    business that fails them; placement cannot be bought into one — asserted
 *    by a test."
 *
 * ## What changed under these tests
 *
 * Membership used to be computed on every read, and this file asserted which
 * candidate was *missing* from the computed result. Board 6b §3 replaced that
 * with a dated snapshot, because the entries are hand-written and cross-
 * reference each other — automated reordering corrupts prose no automated
 * process can rewrite.
 *
 * So the bar moved from the read path to `auditList`, and so did these tests.
 * What is asserted now is that a member who fails cannot be **written**, that
 * the page publishes the snapshot rather than live figures, and that the two
 * things which still act automatically — a lapsed licence, and the SLA — act.
 */

const PREFIX = "curated-test-";
let categoryId: string;
let areaId: string;
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: { startsWith: "Curated Test" } } });
  await prisma.curatedList.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.area.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

interface Candidate {
  name: string;
  tier?: number;
  replyMs?: number | null;
  reviews?: number;
  planId?: string | null;
}

/** A listing that qualifies, minus whatever the caller takes away. */
async function candidate(spec: Candidate): Promise<string> {
  const id = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `Curated ${spec.name} ${id}`,
      displayName: `Curated ${spec.name}`,
      slug: `${PREFIX}${spec.name}-${id}`,
      licenceNumber: `DED-CT${id.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      verificationTier: spec.tier ?? VERIFIED_TIER,
      verifiedAt: (spec.tier ?? VERIFIED_TIER) > 0 ? new Date() : null,
      // Set directly, because this file is testing the list and not the
      // measurement. `tests/integration/*` covers derivation elsewhere.
      responseTimeMedianMs: spec.replyMs === undefined ? MAX_REPLY_MS - 60_000 : spec.replyMs,
      ...(spec.planId ? { planId: spec.planId } : {}),
      locations: {
        create: {
          type: "trade_counter",
          emirate: "dubai",
          areaId,
          addressLine: "Unit 5, Street 9",
          published: true,
        },
      },
    },
    select: { id: true },
  });

  const wanted = spec.reviews ?? MIN_REVIEWS;
  for (let i = 0; i < wanted; i += 1) {
    const buyer = await prisma.user.create({
      data: { id: crypto.randomUUID(), fullName: `Curated Test Buyer ${id}-${i}`, roles: ["buyer"] },
      select: { id: true },
    });
    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `ENQ-CT-${id}-${i}`,
        buyerId: buyer.id,
        requirement: "Ducting.",
        closesAt: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { id: true },
    });
    await prisma.enquiryRecipient.create({
      data: { enquiryId: enquiry.id, businessId: business.id, state: "quoted" },
    });
    await prisma.review.create({
      data: {
        businessId: business.id,
        buyerId: buyer.id,
        enquiryId: enquiry.id,
        overall: 5,
        quotedAccurate: 5,
        onTime: 5,
        asDescribed: 5,
        responsiveness: 5,
        body: "Quoted the same day and delivered on the date they gave.",
        editableUntil: new Date(Date.now() + 14 * 86_400_000),
      },
    });
  }

  return business.id;
}

beforeAll(async () => {
  await removeFixtures();
  categoryId = (
    await prisma.category.create({
      data: { name: "Curated Test Trade", slug: `${PREFIX}trade`, code: "CT", sortOrder: 99 },
      select: { id: true },
    })
  ).id;
  areaId = (
    await prisma.area.create({
      data: { emirate: "dubai", name: "Curated Test Zone", slug: `${PREFIX}zone` },
      select: { id: true },
    })
  ).id;
  listId = (
    await prisma.curatedList.create({
      data: {
        slug: `${PREFIX}list`,
        title: "The best of the test trade",
        // A check constraint refuses a published list with no intro.
        intro: "Three rules, printed above the names rather than behind a sales team.",
        criteria: DEFAULT_CRITERIA.map((c) => ({ key: c.key, kind: c.kind })),
        categoryId,
        areaId,
      },
      select: { id: true },
    })
  ).id;

  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      // One of two seeded ops leads, and always the same one: board 6f
      // needs a second for dual control, and `findFirst` has no defined
      // order without this.
      orderBy: { id: "asc" as const },
      select: { id: true },
    })
  ).id;
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      select: { id: true },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let listId: string;

/** Twelve non-competing recommendations need twelve distinct `BEST FOR:` lines. */
function entry(businessId: string, n: number) {
  return {
    businessId,
    bestFor: `Case ${n}`,
    prose: `A paragraph a person wrote about candidate ${n}, specific enough to be checkable.`,
  };
}

describe("criterion 4 — a business that fails a rule cannot be written to a list", () => {
  it("refuses on each required rule, one at a time, and names which", async () => {
    const good = await Promise.all(
      Array.from({ length: MIN_MEMBERS }, (_, i) => candidate({ name: `ok${i}` })),
    );
    const unverified = await candidate({ name: "unverified", tier: VERIFIED_TIER - 1 });
    const slow = await candidate({ name: "slow", replyMs: MAX_REPLY_MS + 60_000 });
    const unmeasured = await candidate({ name: "unmeasured", replyMs: null });
    const thin = await candidate({ name: "thin", reviews: MIN_REVIEWS - 1 });

    for (const [name, id] of [
      ["verified", unverified],
      ["reply", slow],
      ["reply", unmeasured],
      ["reviews", thin],
    ] as const) {
      const result = await auditList({
        actor: actor(opsLeadId, "staff_ops_lead"),
        listId,
        entries: [...good.map((businessId, i) => entry(businessId, i)), entry(id, 99)],
        reason: `Trying to seat a candidate that fails ${name}.`,
      });
      expect(result, name).toMatchObject({ ok: false, error: "fails_criteria" });
      if (result.ok) continue;
      expect(result.rejected?.[0]?.businessId).toBe(id);
      expect(result.rejected?.[0]?.failures.some((f) => f.key === name)).toBe(true);
    }
  }, 180_000);

  it("does not care what a supplier has bought", async () => {
    /*
       The one that proves the rule. Everything the product sells, and one thing
       it does not: a reply time under four hours. There is no field for that,
       so this listing cannot be seated no matter what it pays.
    */
    const bought = await candidate({
      name: "bought",
      planId: "pro",
      replyMs: MAX_REPLY_MS + 60_000,
    });
    const good = await Promise.all(
      Array.from({ length: MIN_MEMBERS }, (_, i) => candidate({ name: `paid${i}` })),
    );

    const result = await auditList({
      actor: actor(opsLeadId, "staff_ops_lead"),
      listId,
      entries: [...good.map((id, i) => entry(id, i)), entry(bought, 99)],
      reason: "Trying to seat the supplier on the most expensive plan.",
    });
    expect(result).toMatchObject({ ok: false, error: "fails_criteria" });
  }, 180_000);

  it("refuses two entries that are best for the same thing", async () => {
    // Acceptance 16, and the reason for it: the line is what turns a ranked
    // list into recommendations that do not compete with each other.
    const ids = await Promise.all(
      Array.from({ length: MIN_MEMBERS }, (_, i) => candidate({ name: `dupe${i}` })),
    );
    const entries = ids.map((id, i) => entry(id, i));
    entries[1] = { ...entries[1]!, bestFor: entries[0]!.bestFor };

    const result = await auditList({
      actor: actor(opsLeadId, "staff_ops_lead"),
      listId,
      entries,
      reason: "Two entries with one recommendation between them.",
    });
    expect(result).toMatchObject({ ok: false, error: "duplicate_best_for" });
  }, 180_000);

  it("refuses a list below the floor rather than publishing a short one", async () => {
    const ids = await Promise.all(
      Array.from({ length: MIN_MEMBERS - 1 }, (_, i) => candidate({ name: `few${i}` })),
    );
    const result = await auditList({
      actor: actor(opsLeadId, "staff_ops_lead"),
      listId,
      entries: ids.map((id, i) => entry(id, i)),
      reason: "Publishing four.",
    });
    expect(result).toMatchObject({ ok: false, error: "too_few" });
  }, 180_000);

  it("is the only path, and it needs the capability and a reason", async () => {
    const ids = await Promise.all(
      Array.from({ length: MIN_MEMBERS }, (_, i) => candidate({ name: `perm${i}` })),
    );
    await expect(
      auditList({
        actor: actor(moderatorId, "staff_moderator"),
        listId,
        entries: ids.map((id, i) => entry(id, i)),
        reason: "Not mine to do.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 180_000);
});

describe("the page publishes a snapshot, not live figures", () => {
  let members: string[];

  beforeAll(async () => {
    members = await Promise.all(
      Array.from({ length: MIN_MEMBERS }, (_, i) => candidate({ name: `snap${i}` })),
    );
    const result = await auditList({
      actor: actor(opsLeadId, "staff_ops_lead"),
      listId,
      entries: members.map((id, i) => entry(id, i)),
      reason: "The launch audit.",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    await prisma.curatedList.update({
      where: { id: listId },
      data: { publishedAt: new Date() },
    });
  }, 300_000);

  it("writes the criteria it was judged against, and a retained record", async () => {
    const audits = await prisma.curatedListAudit.findMany({ where: { listId } });
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0]?.memberCount).toBe(MIN_MEMBERS);
    // "No one paid to be here" is unfalsifiable without a name on the decision.
    expect(audits[0]?.editorId).toBe(opsLeadId);
  }, 120_000);

  it("acceptance 5 — a live metric change does not alter the page", async () => {
    const before = await curatedList(`${PREFIX}list`);
    const first = before?.members[0];
    expect(first).toBeDefined();
    const shown = first!.responseTimeMedianMs;

    // The supplier gets slower. The page does not move: the figure it prints
    // was measured on the audit date and says so.
    await prisma.business.update({
      where: { id: first!.businessId },
      data: { responseTimeMedianMs: MAX_REPLY_MS + 3_600_000 },
    });

    const after = await curatedList(`${PREFIX}list`);
    expect(after?.members[0]?.responseTimeMedianMs).toBe(shown);
    expect(after?.members).toHaveLength(MIN_MEMBERS);

    /*
       Put it back. The next test re-audits, and a member whose live figure is
       over the criterion cannot be seated — which is `auditList` working, and
       is exactly the failure this line exists to keep out of a test about
       something else.
    */
    await prisma.business.update({
      where: { id: first!.businessId },
      data: { responseTimeMedianMs: shown },
    });
  }, 120_000);

  it("acceptance 6 — the audit date moves on a re-audit and on nothing else", async () => {
    const before = (await curatedList(`${PREFIX}list`))?.auditedAt;
    expect(before).toBeTruthy();

    // A rebuild, a review landing, a sweep: none of them is a re-audit.
    await sweepCuratedLists();
    expect((await curatedList(`${PREFIX}list`))?.auditedAt?.getTime()).toBe(before?.getTime());

    const reaudit = await auditList({
      actor: actor(opsLeadId, "staff_ops_lead"),
      listId,
      entries: members.map((id, i) => entry(id, i)),
      reason: "Re-audited, and this is the only thing that moves the date.",
      now: new Date(before!.getTime() + 86_400_000),
    });
    expect(reaudit.ok, JSON.stringify(reaudit)).toBe(true);
    const after = (await curatedList(`${PREFIX}list`))?.auditedAt;
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());

    // And the previous snapshot is still there. A record overwritten on every
    // re-audit is not evidence, it is the current claim restated.
    expect(await prisma.curatedListAudit.count({ where: { listId } })).toBeGreaterThan(1);
  }, 180_000);

  it("acceptance 7 — a lapsed licence removes the entry in the build", async () => {
    const before = await curatedList(`${PREFIX}list`);
    const doomed = before!.members[1]!;

    await prisma.business.update({
      where: { id: doomed.businessId },
      data: { verificationTier: VERIFIED_TIER - 1 },
    });

    const after = await curatedList(`${PREFIX}list`);
    expect(after!.members.map((m) => m.businessId)).not.toContain(doomed.businessId);
    // The numerals close up rather than leaving a gap where entry 02 was.
    expect(after!.members.map((m) => m.rank)).toEqual(
      after!.members.map((_, i) => i + 1),
    );

    // And the hero owes a removal date, which the sweep writes.
    await sweepCuratedLists();
    expect((await curatedList(`${PREFIX}list`))?.entryRemovedAt).not.toBeNull();

    await prisma.business.update({
      where: { id: doomed.businessId },
      data: { verificationTier: VERIFIED_TIER },
    });
  }, 180_000);

  it("soft drift goes to a queue and changes nothing the reader sees", async () => {
    const before = await curatedList(`${PREFIX}list`);
    const slipping = before!.members[2]!;

    await prisma.business.update({
      where: { id: slipping.businessId },
      data: { responseTimeMedianMs: MAX_REPLY_MS + 2 * 3_600_000 },
    });
    const swept = await sweepCuratedLists();

    expect(swept.drifted.some((row) => row.businessId === slipping.businessId)).toBe(true);
    const queue = await driftQueue();
    expect(queue.some((row) => row.criterion === "reply")).toBe(true);

    // Still on the page, still at the same rank, still printing its snapshot.
    const after = await curatedList(`${PREFIX}list`);
    expect(after!.members.map((m) => m.businessId)).toContain(slipping.businessId);
    expect(after!.members[2]?.responseTimeMedianMs).toBe(slipping.responseTimeMedianMs);
  }, 180_000);

  it("acceptance 8 — past the SLA with drift outstanding, the list unpublishes", async () => {
    // Nothing renders a warning banner: a page saying "some of this may be out
    // of date" is worse than absent.
    await prisma.curatedList.update({
      where: { id: listId },
      data: { reauditDueAt: new Date(Date.now() - 86_400_000) },
    });

    const swept = await sweepCuratedLists();
    expect(swept.unpublished.some((row) => row.slug === `${PREFIX}list`)).toBe(true);
    expect(await curatedList(`${PREFIX}list`)).toBeNull();
    expect((await liveLists()).some((row) => row.slug === `${PREFIX}list`)).toBe(false);
  }, 180_000);
});

describe("acceptance 10 — the panel is the list's own record", () => {
  it("renders whatever criteria the list carries, not a global constant", async () => {
    const ids = await Promise.all(
      Array.from({ length: MIN_MEMBERS }, (_, i) => candidate({ name: `panel${i}` })),
    );
    const other = await prisma.curatedList.create({
      data: {
        slug: `${PREFIX}other`,
        title: "A list with its own rules",
        // A check constraint refuses a published list with no intro, and it is
        // right to: the "why we publish the criteria" card is the page arguing
        // for its own trustworthiness.
        intro: "Two rules rather than three, and both of them printed above the names.",
        // Two required, not three. A record of how *this* list was chosen.
        criteria: [
          { key: "verified", kind: "required" },
          { key: "placement", kind: "never" },
        ],
        categoryId,
        areaId,
        publishedAt: new Date(),
      },
      select: { id: true },
    });

    await auditList({
      actor: actor(opsLeadId, "staff_ops_lead"),
      listId: other.id,
      entries: ids.map((id, i) => entry(id, i)),
      reason: "A list judged on two rules.",
    });

    const view = await curatedList(`${PREFIX}other`);
    expect(view?.criteria.map((c) => c.key)).toEqual(["verified", "placement"]);
    expect(view?.criteria).not.toEqual(DEFAULT_CRITERIA);
  }, 180_000);
});
