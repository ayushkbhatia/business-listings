import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { sweepEscalations } from "@/lib/enquiry/escalation-job";

/**
 * The sentence board 8d put on the setup screen, kept.
 *
 * §8 said to cut "anything unanswered for two hours escalates to you" unless
 * the job existed, and it was right to: the line sits next to a paragraph
 * telling the seller their ranking depends on reply time, so a supplier who
 * relies on it and is never paged loses the enquiry the screen promised to
 * save.
 *
 * The assertions worth having are the ones about **not** sending. A job that
 * escalates everything passes a test that only checks the slow enquiry — so the
 * answered one, the fresh one, the suspended supplier and the second run each
 * get their own case, and each reads the delivery rows rather than the return
 * value alone.
 */

const PREFIX = "escalation-test-";
const EMAIL_DOMAIN = "@escalation.test";

/** Fixed, so nothing here depends on the wall clock. */
const NOW = new Date("2026-06-10T09:00:00.000Z");
const MINUTES = 120;

let categoryId: string;
let businessId: string;
let buyerId: string;
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

/** Minutes before NOW, for an enquiry that has been sitting that long. */
function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

async function addBusiness(name: string, fields: { suspendedAt?: Date } = {}) {
  const id = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `${name} Trading LLC`,
      displayName: name,
      slug: `${PREFIX}${id}`,
      licenceNumber: `DED-ES${id.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date("2030-01-01T00:00:00.000Z"),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      leadEscalationMinutes: MINUTES,
      ...(fields.suspendedAt ? { suspendedAt: fields.suspendedAt } : {}),
    },
    select: { id: true },
  });

  // Somebody for the escalation to reach. `notify` resolves the owner seat.
  await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `${PREFIX}owner-${stamp()}${EMAIL_DOMAIN}`,
      fullName: `Escalation Owner ${stamp()}`,
      roles: ["seller_owner"],
      businessId: business.id,
    },
  });

  /*
     And somewhere for it to go. `notify()` returns an empty array when the
     business has no `NotificationPreference` row — quietly, which is right in
     production and would have made this whole suite pass by sending nothing.

     `in_app` only, and quiet hours off: the fixture clock is 09:00 UTC, which
     is 13:00 in Asia/Dubai, but a suite whose result depended on that would
     break the day somebody changed the fixture time.
  */
  await prisma.notificationPreference.create({
    data: {
      businessId: business.id,
      routing: { enquiry_escalated: ["in_app"] },
      quietHoursEnabled: false,
      escalateAfterMinutes: MINUTES,
    },
  });

  return business.id;
}

/**
 * One enquiry that reached one supplier, aged to order.
 *
 * `createdAt` is set explicitly on both rows — the sweep measures from the
 * recipient row, and a default of "now" would make every fixture fresh.
 */
async function addWaiting(fields: {
  businessId: string;
  minutesAgo: number;
  firstReplyAt?: Date | null;
  state?: "delivered" | "opened" | "quoted";
}) {
  const at = ago(fields.minutesAgo);
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `${PREFIX}${stamp()}`,
      buyerId,
      requirement: "Resilient seated gate valves, flanged PN16, 200 off.",
      closesAt: new Date(NOW.getTime() + 7 * 86_400_000),
      createdAt: at,
    },
    select: { id: true },
  });

  await prisma.enquiryRecipient.create({
    data: {
      enquiryId: enquiry.id,
      businessId: fields.businessId,
      state: fields.state ?? "delivered",
      firstReplyAt: fields.firstReplyAt ?? null,
      createdAt: at,
    },
  });

  return enquiry.id;
}

function deliveriesFor(enquiryId: string) {
  return prisma.notificationDelivery.count({
    where: { event: "enquiry_escalated", enquiryId },
  });
}

async function removeFixtures() {
  /*
     By enquiry id, gathered first. `NotificationDelivery.enquiryId` is a plain
     column with no relation behind it — deliberately, so a delivery row
     outlives whatever it was about — which means there is no `enquiry` to
     filter through and the ids have to be collected before the enquiries go.
  */
  const ours = await prisma.enquiry.findMany({
    where: { ref: { startsWith: PREFIX } },
    select: { id: true },
  });
  await prisma.notificationDelivery.deleteMany({
    where: { enquiryId: { in: ours.map((row) => row.id) } },
  });
  await prisma.enquiryRecipient.deleteMany({
    where: { enquiry: { ref: { startsWith: PREFIX } } },
  });
  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  await prisma.notificationPreference.deleteMany({
    where: { business: { slug: { startsWith: PREFIX } } },
  });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();

  const category = await prisma.category.create({
    data: { slug: `${PREFIX}valves`, code: "ESCV", name: "Escalation test trade" },
  });
  categoryId = category.id;

  businessId = await addBusiness("Escalation Test Alpha");

  const buyer = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `${PREFIX}buyer-${stamp()}${EMAIL_DOMAIN}`,
      fullName: "Escalation Test Buyer",
      roles: ["buyer"],
    },
    select: { id: true },
  });
  buyerId = buyer.id;
});

afterAll(async () => {
  await removeFixtures();
});

describe("what gets escalated", () => {
  it("escalates an enquiry that has sat past the supplier's own threshold", async () => {
    const enquiryId = await addWaiting({ businessId, minutesAgo: MINUTES + 30 });

    /*
       Asserted on this enquiry's own delivery rows, never on `result.escalated`.
       The sweep has no business filter — it cannot, it is a cron — so the
       returned counts include whatever the seeded database was already sitting
       on, and a suite that read them would pass on somebody else's row.
    */
    await sweepEscalations(NOW);
    expect(await deliveriesFor(enquiryId)).toBeGreaterThanOrEqual(1);
  });

  it("sends once and never again, however often the sweep runs", async () => {
    const enquiryId = await addWaiting({ businessId, minutesAgo: MINUTES + 90 });
    await sweepEscalations(NOW);
    const after = await deliveriesFor(enquiryId);
    expect(after).toBeGreaterThanOrEqual(1);

    /*
       `notify()` never reads `NotificationDelivery` before writing, so nothing
       below this job deduplicates. Without the guard here an owner with one
       slow enquiry is paged every hour until they answer — the fastest way to
       make somebody turn notifications off.
    */
    await sweepEscalations(new Date(NOW.getTime() + 60 * 60_000));
    expect(await deliveriesFor(enquiryId)).toBe(after);
  });

  it("reads the supplier's own threshold rather than a constant", async () => {
    const patient = await addBusiness("Escalation Test Patient");
    await prisma.business.update({
      where: { id: patient },
      data: { leadEscalationMinutes: 480 },
    });
    // Past two hours and nowhere near eight. The screen states the supplier's
    // own number, so the job has to use the same one.
    const enquiryId = await addWaiting({ businessId: patient, minutesAgo: 200 });

    await sweepEscalations(NOW);
    expect(await deliveriesFor(enquiryId)).toBe(0);
  });
});

describe("what does not", () => {
  it("leaves an enquiry that has been answered", async () => {
    const enquiryId = await addWaiting({
      businessId,
      minutesAgo: MINUTES + 60,
      firstReplyAt: ago(MINUTES),
    });

    await sweepEscalations(NOW);
    expect(await deliveriesFor(enquiryId)).toBe(0);
  });

  it("leaves an enquiry that has been quoted without a message", async () => {
    // A quote sent with no covering message is still an answer. Escalating it
    // would be the product failing to read its own tables.
    const enquiryId = await addWaiting({
      businessId,
      minutesAgo: MINUTES + 60,
      state: "quoted",
    });

    await sweepEscalations(NOW);
    expect(await deliveriesFor(enquiryId)).toBe(0);
  });

  it("leaves an enquiry that is still inside the threshold", async () => {
    const enquiryId = await addWaiting({ businessId, minutesAgo: MINUTES - 30 });

    await sweepEscalations(NOW);
    expect(await deliveriesFor(enquiryId)).toBe(0);
  });

  it("leaves a suspended supplier alone", async () => {
    /*
       Their listing is off the directory and their enquiries reach nobody. An
       escalation would be the platform chasing a supplier for a reply to a
       conversation it has itself switched off.
    */
    const suspended = await addBusiness("Escalation Test Suspended", {
      suspendedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const enquiryId = await addWaiting({ businessId: suspended, minutesAgo: MINUTES + 300 });

    await sweepEscalations(NOW);
    expect(await deliveriesFor(enquiryId)).toBe(0);
  });

  it("leaves a backlog older than the look-back window", async () => {
    /*
       The floor exists so the first run after deploy is not a broadcast: without
       it, every unanswered enquiry in the history of the directory escalates at
       once, which on a seeded database is hundreds of messages to real owners.
    */
    const enquiryId = await addWaiting({ businessId, minutesAgo: 20 * 24 * 60 });

    await sweepEscalations(NOW);
    expect(await deliveriesFor(enquiryId)).toBe(0);
  });
});
