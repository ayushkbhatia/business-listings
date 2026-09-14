import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor, Role } from "@/lib/auth/roles";
import { PermissionError } from "@/lib/auth/errors";
import { areaMatrix } from "@/lib/content/matrix";
import { syncCrmTasks } from "@/lib/crm/sync";
import { crmBoard } from "@/lib/crm/board";
import { buildCallList, claimTask, logCall, refreshSignals, releaseTask, revealContact } from "@/lib/crm/service";
import { callHistory } from "@/lib/crm/history";
import { consoleOverview } from "@/lib/console/overview";
import type { SignalFacts } from "@/lib/crm/model";

/**
 * Board 12d against a real database — B1, B2, B6, B7, B9, B10 and the states
 * table.
 *
 * Every business here is made by the suite and carries the one signal the test
 * is about, so a seeded row changing cannot move an assertion. The derivation
 * runs over the whole directory each time, which is the point: the suite checks
 * what a real run does to its rows, not what a stub says it would.
 */

const PREFIX = "crm12d-";
const ENQUIRY_PREFIX = "ENQ-CRM12D";
const DAY = 86_400_000;

let opsLead: Actor;
let moderator: Actor;
let finance: Actor;
let categoryId: string;
let areaId: string;
let buyerId: string;
let seq = 0;

async function staff(role: Role): Promise<Actor> {
  const user = await prisma.user.findFirstOrThrow({
    where: { roles: { has: role }, staffDeactivatedAt: null },
    orderBy: { id: "asc" },
    select: { id: true, roles: true },
  });
  return { id: user.id, roles: user.roles };
}

async function listing(name: string, data: { claimStatus?: "claimed" | "unclaimed"; planId?: string | null; phone?: string | null } = {}) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;
  return prisma.business.create({
    data: {
      tradeName: `${name} ${stamp}`,
      displayName: `${name} ${stamp}`,
      slug: `${PREFIX}${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * DAY),
      primaryCategoryId: categoryId,
      claimStatus: data.claimStatus ?? "claimed",
      planId: data.planId === undefined ? "free" : data.planId,
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Unit 7, Street 3",
          published: true,
          phone: data.phone === undefined ? "+97144470088" : data.phone,
        },
      },
    },
    select: { id: true, displayName: true },
  });
}

async function missedAtCap(businessId: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    seq += 1;
    const enquiry = await prisma.enquiry.create({
      data: { ref: `${ENQUIRY_PREFIX}-${Date.now()}${seq}`, buyerId, requirement: "Gate valves, DN100.", closesAt: new Date(Date.now() + 7 * DAY) },
      select: { id: true },
    });
    await prisma.missedEnquiry.create({ data: { enquiryId: enquiry.id, businessId, reason: "at_monthly_cap" } });
  }
}

async function enquiriesTo(businessId: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    seq += 1;
    const enquiry = await prisma.enquiry.create({
      data: { ref: `${ENQUIRY_PREFIX}-${Date.now()}${seq}`, buyerId, requirement: "Butterfly valves.", closesAt: new Date(Date.now() + 7 * DAY) },
      select: { id: true },
    });
    await prisma.enquiryRecipient.create({ data: { enquiryId: enquiry.id, businessId, state: "delivered" } });
  }
}

async function openTask(businessId: string) {
  return prisma.crmTask.findFirst({ where: { businessId, closedAt: null } });
}

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: ENQUIRY_PREFIX } } });
}

beforeAll(async () => {
  opsLead = await staff("staff_ops_lead");
  moderator = await staff("staff_moderator");
  finance = await staff("staff_finance");
  categoryId = (await prisma.category.findFirstOrThrow({ where: { parentId: null }, orderBy: { id: "asc" }, select: { id: true } })).id;
  areaId = (await prisma.area.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } })).id;
  buyerId = (await prisma.user.findFirstOrThrow({ where: { roles: { has: "buyer" } }, orderBy: { id: "asc" }, select: { id: true } })).id;
  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
  // A run's own record; nothing else points at it once the tasks are gone.
  await prisma.crmSyncRun.deleteMany({ where: { triggeredById: { in: [opsLead.id, moderator.id] } } });
});

describe("B1 and B2 — the list derives itself", () => {
  it("opens a task per signal, with the number the call opens with and a score nobody typed", async () => {
    const capped = await listing("Capped Seller");
    await missedAtCap(capped.id, 3);
    const unclaimed = await listing("Unclaimed With Demand", { claimStatus: "unclaimed", planId: null });
    await enquiriesTo(unclaimed.id, 2);

    await syncCrmTasks();

    const cap = await openTask(capped.id);
    expect(cap).toMatchObject({ signal: "cap_reached", signalValue: 3, demandScore: 3, state: "queued" });
    expect((cap!.signalFacts as unknown as SignalFacts).kind).toBe("cap_reached");

    const demand = await openTask(unclaimed.id);
    expect(demand).toMatchObject({ signal: "unclaimed_demand", signalValue: 2, demandScore: 2 });
  }, 120_000);

  it("carries a held page's figures exactly as 6f's matrix states them", async () => {
    await syncCrmTasks();
    const held = await prisma.crmTask.findMany({ where: { closedAt: null, signal: "held_page" }, select: { signalRef: true, signalFacts: true } });
    const matrix = await areaMatrix({ perPage: 100_000 });
    for (const task of held) {
      const facts = task.signalFacts as unknown as Extract<SignalFacts, { kind: "held_page" }>;
      const row = matrix.rows.find((candidate) => `${candidate.areaId}:${candidate.categoryId}` === task.signalRef);
      expect(row, task.signalRef).toBeDefined();
      expect(row!.status).toBe("recruit");
      expect({ listings: facts.listings, verified: facts.verified, need: facts.need }).toEqual({
        listings: row!.listings,
        verified: row!.verified,
        need: row!.need,
      });
    }
  }, 120_000);

  it("keeps one open task per business, by index, whatever tries to add a second", async () => {
    const business = await listing("One Open Task");
    await missedAtCap(business.id, 1);
    await syncCrmTasks();
    const task = await openTask(business.id);
    await expect(
      prisma.crmTask.create({
        data: { businessId: business.id, signal: "zero_result", signalRef: "x", signalValue: 1, demandScore: 1, derivedAt: new Date(), signalFacts: {} },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect((await openTask(business.id))!.id).toBe(task!.id);
  }, 120_000);
});

describe("B7 and the states table — a task leaves when its signal clears", () => {
  it("closes as won with no call attached when the listing is claimed without one", async () => {
    const business = await listing("Claims On Its Own", { claimStatus: "unclaimed", planId: null });
    await enquiriesTo(business.id, 1);
    await syncCrmTasks();
    const task = await openTask(business.id);
    expect(task?.signal).toBe("unclaimed_demand");

    await prisma.business.update({ where: { id: business.id }, data: { claimStatus: "claimed", planId: "free" } });
    await syncCrmTasks();

    const closed = await prisma.crmTask.findUniqueOrThrow({ where: { id: task!.id }, include: { calls: true } });
    expect(closed).toMatchObject({ state: "won", closeReason: "claimed" });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.calls).toHaveLength(0);
  }, 120_000);

  it("closes a held-page call as won when the listing is claimed, though it still derives unverified", async () => {
    await syncCrmTasks();
    const task = await prisma.crmTask.findFirst({
      where: { closedAt: null, signal: "held_page", business: { claimStatus: "unclaimed" } },
      orderBy: [{ id: "asc" }],
      select: { id: true, businessId: true },
    });
    expect(task, "the seed holds a page with an unclaimed listing in it").not.toBeNull();
    if (!task) return;
    try {
      await prisma.business.update({ where: { id: task.businessId }, data: { claimStatus: "claimed" } });
      await syncCrmTasks();
      expect(await prisma.crmTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ state: "won", closeReason: "claimed" });
      // The verify call waits out the quiet fortnight rather than ringing tomorrow.
      expect(await openTask(task.businessId)).toBeNull();
    } finally {
      await prisma.business.update({ where: { id: task.businessId }, data: { claimStatus: "unclaimed" } });
      await prisma.crmTask.deleteMany({ where: { id: task.id } });
    }
  }, 120_000);

  it("clears a task whose demand went away, and says so, rather than deleting it", async () => {
    // Basic, so no other signal can pick the business up once the cap clears:
    // a Free seller in a thin trade would carry over as a zero-result call.
    const business = await listing("Demand Went Away", { planId: "basic" });
    await missedAtCap(business.id, 2);
    await syncCrmTasks();
    const task = await openTask(business.id);

    await prisma.missedEnquiry.deleteMany({ where: { businessId: business.id } });
    await syncCrmTasks();

    expect(await prisma.crmTask.findUniqueOrThrow({ where: { id: task!.id } })).toMatchObject({ state: "cleared", closeReason: "signal_gone" });
  }, 120_000);

  it("takes a save call off the list when the renewal passes", async () => {
    const business = await listing("Renewal Passes", { planId: "basic" });
    await prisma.business.update({ where: { id: business.id }, data: { replyRate: 0.25, replySample: 8 } });
    await prisma.subscription.create({
      data: { businessId: business.id, planId: "basic", status: "active", renewsAt: new Date(Date.now() + 10 * DAY), periodStartedAt: new Date(Date.now() - 20 * DAY) },
    });
    await syncCrmTasks();
    const task = await openTask(business.id);
    expect(task).toMatchObject({ signal: "churn_risk", demandScore: 6 });

    await prisma.subscription.update({ where: { businessId: business.id }, data: { renewsAt: new Date(Date.now() - DAY) } });
    await syncCrmTasks();
    expect(await prisma.crmTask.findUniqueOrThrow({ where: { id: task!.id } })).toMatchObject({ state: "cleared", closeReason: "renewal_passed" });
  }, 120_000);
});

describe("B9 and B10 — the lock, the reveal and the log", () => {
  it("gives a row to one person, reveals the number to them, and logs the reveal", async () => {
    const business = await listing("Locked Row");
    await missedAtCap(business.id, 1);
    await syncCrmTasks();
    const task = (await openTask(business.id))!;

    const revealed = await revealContact(opsLead, task.id);
    expect(revealed).toMatchObject({ ok: true, tel: "+97144470088" });
    expect(await prisma.crmContactReveal.count({ where: { taskId: task.id, staffId: opsLead.id } })).toBe(1);
    expect((await prisma.crmTask.findUniqueOrThrow({ where: { id: task.id } })).assignedToId).toBe(opsLead.id);

    // Two members of staff, one business: the second is told who has it.
    const second = await revealContact(moderator, task.id);
    expect(second).toMatchObject({ ok: false, error: "taken" });
    expect(await logCall(moderator, { taskId: task.id, outcome: "interested" })).toMatchObject({ ok: false, error: "taken" });
    expect(await prisma.crmContactReveal.count({ where: { taskId: task.id, staffId: moderator.id } })).toBe(0);

    expect(await releaseTask(moderator, task.id)).toMatchObject({ ok: false, error: "not_yours" });
    expect(await releaseTask(opsLead, task.id)).toMatchObject({ ok: true });
    expect(await claimTask(moderator, task.id)).toMatchObject({ ok: true });
  }, 120_000);

  it("refuses a reveal where no branch has a number", async () => {
    const business = await listing("No Phone", { phone: null });
    await missedAtCap(business.id, 1);
    await syncCrmTasks();
    expect(await revealContact(opsLead, (await openTask(business.id))!.id)).toMatchObject({ ok: false, error: "no_phone" });
  }, 120_000);

  it("moves the task as the outcome says, records the signal and the script, and closes on a no", async () => {
    const business = await listing("Logged Outcomes");
    await missedAtCap(business.id, 2);
    await syncCrmTasks();
    const task = (await openTask(business.id))!;

    expect(await logCall(opsLead, { taskId: task.id, outcome: "call_back" })).toMatchObject({ ok: false, error: "call_back_needs_date" });
    const later = new Date(Date.now() + 3 * DAY);
    expect(await logCall(opsLead, { taskId: task.id, outcome: "call_back", callBackAt: later, note: "Owner is travelling." })).toMatchObject({ ok: true, state: "callback" });
    expect(await prisma.crmTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ state: "callback", lastOutcome: "call_back" });

    expect(await logCall(opsLead, { taskId: task.id, outcome: "not_interested", note: "Happy on Free." })).toMatchObject({ ok: true, state: "lost" });
    const closed = await prisma.crmTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(closed).toMatchObject({ state: "lost", closeReason: "not_interested", callBackAt: null });
    expect(await logCall(opsLead, { taskId: task.id, outcome: "interested" })).toMatchObject({ ok: false, error: "closed" });

    const history = await callHistory(business.id);
    expect(history.map((call) => call.kind)).toEqual(["not_interested", "call_back"]);
    const logged = await prisma.callOutcome.findFirstOrThrow({ where: { taskId: task.id, kind: "not_interested" } });
    expect(logged).toMatchObject({ signal: "cap_reached", scriptId: "cap_reached.enquiry.v1", staffId: opsLead.id });

    // A no keeps them off the list: the next run does not reopen the business.
    await syncCrmTasks();
    expect(await openTask(business.id)).toBeNull();
  }, 120_000);

  it("takes a held page's unassigned calls onto one list, and only those", async () => {
    await syncCrmTasks();
    const held = await prisma.crmTask.findFirst({ where: { closedAt: null, signal: "held_page", assignedToId: null }, orderBy: [{ id: "asc" }] });
    if (!held) return expect(await prisma.crmTask.count({ where: { closedAt: null, signal: "held_page", assignedToId: null } })).toBe(0);
    const unassigned = await prisma.crmTask.count({ where: { closedAt: null, signal: "held_page", signalRef: held.signalRef, assignedToId: null } });
    expect(await buildCallList(opsLead, held.signalRef)).toEqual({ ok: true, assigned: unassigned });
    expect(await prisma.crmTask.count({ where: { closedAt: null, signalRef: held.signalRef, assignedToId: null } })).toBe(0);
    await prisma.crmTask.updateMany({ where: { signalRef: held.signalRef, assignedToId: opsLead.id }, data: { assignedToId: null, assignedAt: null } });
  }, 120_000);
});

describe("B5, B6 and B10 — the board's counts", () => {
  it("labels assigned-to-me and due apart, and states each rate with its denominator", async () => {
    const business = await listing("Link Then Claim", { claimStatus: "unclaimed", planId: null });
    await enquiriesTo(business.id, 1);
    await syncCrmTasks();
    const task = (await openTask(business.id))!;
    await logCall(opsLead, { taskId: task.id, outcome: "claim_link_sent" });

    const claimant = await prisma.user.findFirstOrThrow({ where: { roles: { has: "buyer" } }, orderBy: { id: "asc" }, select: { id: true } });
    await prisma.claimSubmission.create({
      data: {
        businessId: business.id,
        claimantId: claimant.id,
        // The phone route carries its number; a licence upload would need a document.
        route: "phone_callback",
        phone: "+97144470088",
        status: "claimed",
        decidedAt: new Date(Date.now() + 1000),
        decisionReason: "Licence matches the register.",
      },
    });

    const board = await crmBoard(opsLead, "calls", new Date(Date.now() + 2000));
    expect(board.assignedToMe).toBe(await prisma.crmTask.count({ where: { closedAt: null, assignedToId: opsLead.id } }));
    expect(board.due).toBe(board.rows.filter((row) => row.due).length);
    expect(board.week.linksSent).toBeGreaterThanOrEqual(1);
    expect(board.week.claimedAfterLink).toBeGreaterThanOrEqual(1);
    expect(board.week.claimedAfterLink).toBeLessThanOrEqual(board.week.linksSent);
    // A row held by somebody else is counted, never offered.
    for (const row of board.rows) expect(row.mine || (await prisma.crmTask.findUniqueOrThrow({ where: { id: row.id } })).assignedToId === null).toBe(true);
  }, 120_000);

  it("reconciles the renewal tab with board 4f's at-risk count", async () => {
    await syncCrmTasks();
    const board = await crmBoard(opsLead, "renewal");
    expect(board.renewal.onList).toBe(await prisma.crmTask.count({ where: { closedAt: null, signal: "churn_risk" } }));
    expect(board.renewal.fourF - board.renewal.renewalPassed - board.renewal.onList).toBeGreaterThanOrEqual(0);
    for (const row of board.rows) expect(row.signal).toBe("churn_risk");
  }, 120_000);

  it("gives the console tile the open task count", async () => {
    const jobs = await consoleOverview();
    const metric = jobs.flatMap((job) => job.metrics).find((candidate) => candidate.key === "call_list");
    expect(metric?.count).toBe(await prisma.crmTask.count({ where: { closedAt: null } }));
  }, 120_000);
});

describe("B11 — ops lead and moderator only", () => {
  it("refuses finance at every entry point", async () => {
    const task = await prisma.crmTask.findFirstOrThrow({ where: { closedAt: null }, orderBy: [{ id: "asc" }], select: { id: true } });
    await expect(claimTask(finance, task.id)).rejects.toBeInstanceOf(PermissionError);
    await expect(revealContact(finance, task.id)).rejects.toBeInstanceOf(PermissionError);
    await expect(logCall(finance, { taskId: task.id, outcome: "interested" })).rejects.toBeInstanceOf(PermissionError);
    await expect(refreshSignals(finance)).rejects.toBeInstanceOf(PermissionError);
  }, 60_000);

  it("refuses a second refresh inside five minutes", async () => {
    await syncCrmTasks();
    expect(await refreshSignals(moderator)).toMatchObject({ ok: false, error: "just_refreshed" });
  }, 120_000);
});
