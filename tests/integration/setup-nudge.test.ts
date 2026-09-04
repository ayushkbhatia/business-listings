import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { sweepSetupNudges, NUDGE_AFTER_HOURS } from "@/lib/setup/nudge-job";
import { unknownPlaceholders } from "@/lib/notify/params";

/**
 * Board 8a's promise, which the hub prints in front of the seller:
 *
 *   "One WhatsApp three days after you went live if anything is still open,
 *    then nothing. We do not chase."
 *
 * Every assertion here is one half of that sentence. The negatives are the
 * interesting ones — a job that nudged everybody would pass a test that only
 * checked the supplier who was owed one — and the second-sweep case is the
 * whole reason the guard exists, because `notify()` reads no delivery row
 * before writing one and nothing else in that layer deduplicates anything.
 *
 * ## Why `NOW` is a date in the past
 *
 * Not tidiness. The sweep reads every published business, and the seed
 * publishes listings two to twenty days before it runs — so against wall-clock
 * time this suite would nudge real seeded suppliers as a side effect and its
 * own numbers would move with how long ago somebody last reseeded. Pinning
 * `NOW` to June puts the whole window in a stretch of the calendar only these
 * fixtures live in, which is the same property the upper bound gives the job in
 * production.
 */

const PREFIX = "setup-nudge-test-";
const OWNER = "Setup Nudge Test Owner";

/** Fixed, so "72 hours ago" is relative to one instant rather than to the clock. */
const NOW = new Date("2026-06-15T08:00:00.000Z");
const HOUR = 3_600_000;

/** Far above anything the seed writes, so `liveTemplates` takes this one. */
const FIXTURE_VERSION = 9001;

/** When this run began. Every delivery row it writes is newer than this. */
const SUITE_START = new Date();

let categoryId: string;
let templateId: string;
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

async function addBusiness(fields: {
  publishedHoursAgo: number;
  suspended?: boolean;
}): Promise<{ id: string; ownerId: string }> {
  const id = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `Setup Nudge Test ${id}`,
      displayName: `Setup Nudge Test ${id}`,
      slug: `${PREFIX}${id}`,
      licenceNumber: `DED-SN${id.slice(-6)}`,
      licenceAuthority: "DED",
      // Current, and far enough out that the licence sweep has no opinion about
      // these fixtures if the two suites ever share a run.
      licenceExpiry: new Date("2028-01-01T00:00:00.000Z"),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(NOW.getTime() - fields.publishedHoursAgo * HOUR),
      suspendedAt: fields.suspended ? new Date(NOW.getTime() - 24 * HOUR) : null,
    },
    select: { id: true },
  });

  const owner = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      fullName: OWNER,
      roles: ["seller_owner"],
      businessId: business.id,
    },
    select: { id: true },
  });

  await prisma.notificationPreference.create({
    data: {
      businessId: business.id,
      // What the seed gives every supplier, and what board 8a promises: the
      // WhatsApp is the message, the in-app row is the record.
      routing: { setup_nudge: ["whatsapp", "in_app"] },
      // Off, so the outcome of a send does not depend on what time of day the
      // suite runs. Quiet hours have their own tests in lib/notify.
      quietHoursEnabled: false,
    },
  });

  return { id: business.id, ownerId: owner.id };
}

/** Photographs, catalogue and a second seat done, so only the visit is left. */
async function finishEverythingButTheVisit(businessId: string): Promise<void> {
  await prisma.media.createMany({
    data: Array.from({ length: 6 }, (_, i) => ({
      kind: "gallery" as const,
      storagePath: `${PREFIX}${businessId}/${i}.jpg`,
      businessId,
    })),
  });
  await prisma.product.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({
      businessId,
      categoryId,
      name: `Setup nudge test product ${i}`,
      slug: `${PREFIX}product-${i}`,
      availability: "made_to_order" as const,
    })),
  });
  await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      fullName: OWNER,
      roles: ["seller_sales"],
      businessId,
    },
  });
}

/** This business's nudge rows, in an order two reads cannot disagree about. */
async function deliveries(businessId: string) {
  const rows = await prisma.notificationDelivery.findMany({
    where: { event: "setup_nudge", businessId },
    select: { channel: true, status: true, reason: true, templateId: true },
  });
  // By channel rather than by `createdAt`: two rows written inside the same
  // millisecond come back in whatever order the planner felt like, and the
  // second-sweep test compares two reads of the same list.
  return rows.sort((a, b) => a.channel.localeCompare(b.channel));
}

async function removeFixtures() {
  const mine = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  // No relation on `NotificationDelivery.businessId` — the log points at a
  // business rather than belonging to one — so nothing cascades. It has to go
  // first and by hand, or the next run finds its own rows and skips everything.
  await prisma.notificationDelivery.deleteMany({
    where: { businessId: { in: mine.map((b) => b.id) } },
  });
  /*
     And the collateral.

     The sweep reads every published business, not only these fixtures, so a
     seeded supplier whose `publishedAt` happens to land in the pinned window
     gets a real nudge row out of this run. Pinning `NOW` makes that rare;
     clearing what this suite wrote makes it harmless, and the timestamp keeps
     the delete off anything that was already there.
  */
  await prisma.notificationDelivery.deleteMany({
    where: { event: "setup_nudge", createdAt: { gte: SUITE_START } },
  });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: OWNER } });
  await prisma.notificationTemplate.deleteMany({
    where: { event: "setup_nudge", version: FIXTURE_VERSION },
  });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();
  const category = await prisma.category.create({
    data: { slug: `${PREFIX}pumps`, code: "SNDG", name: "Setup nudge test trade" },
  });
  categoryId = category.id;

  /*
     A live in-app template of this suite's own.

     The seed carries one, but a suite that only passes against a freshly seeded
     database is a suite that goes quiet when somebody reseeds mid-run — and
     this one has to be able to say the difference between "no template" and
     "not nudged". Version far above anything the seed writes, because
     `liveTemplates` takes the highest.
  */
  const template = await prisma.notificationTemplate.create({
    data: {
      event: "setup_nudge",
      channel: "in_app",
      locale: "en",
      version: FIXTURE_VERSION,
      status: "live",
      body: "Still open on your listing: {taskList}. About {minutes} minutes of work.",
      actionLabel: "Finish setting up",
      actionPath: "/dashboard/setup",
    },
    select: { id: true },
  });
  templateId = template.id;
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("the 72-hour edge", () => {
  it("leaves a listing that went live 71 hours ago alone", async () => {
    /*
       An hour early is not "close enough". The hub tells the seller three days,
       and a reminder that arrives on day two makes a liar of the panel — which
       is the only thing on that screen a seller has to take on trust.
    */
    const early = await addBusiness({ publishedHoursAgo: NUDGE_AFTER_HOURS - 1 });

    await sweepSetupNudges(NOW);

    expect(await deliveries(early.id)).toEqual([]);
  });

  it("nudges one that went live 73 hours ago with tasks still open", async () => {
    const due = await addBusiness({ publishedHoursAgo: NUDGE_AFTER_HOURS + 1 });

    const result = await sweepSetupNudges(NOW);
    expect(result.nudged).toBeGreaterThanOrEqual(1);

    const rows = await deliveries(due.id);
    expect(rows.map((row) => row.channel)).toEqual(["in_app", "whatsapp"]);

    /*
       The in-app one is a real send: the delivery row is the notification, and
       its status proves `render` filled both placeholders — a template asking
       for something `EVENT_PARAMS` does not supply throws `MissingParamError`
       rather than sending, and the emitter would have swallowed that and
       written no row at all.
    */
    const inApp = rows.find((row) => row.channel === "in_app");
    expect(inApp?.status).toBe("sent");
    expect(inApp?.templateId).toBe(templateId);

    /*
       The WhatsApp one is skipped, and that is the honest current state rather
       than a defect: Meta has approved no words yet, so every WhatsApp template
       in the seed is `pending_meta` and `notify` records the gap instead of
       pretending. The row still counts as this business's one nudge — board 8a
       promises one attempt and then nothing, not one delivery and then nothing.
    */
    expect(rows.find((row) => row.channel === "whatsapp")?.status).toBe("skipped");
    expect(rows.find((row) => row.channel === "whatsapp")?.reason).toBe("no_live_template");
  });

  it("leaves the back catalogue alone", async () => {
    /*
       The mistake the upper bound exists to prevent. Without it the first run
       after this deploys reminds every supplier who ever signed up, in one
       batch, about a screen they stopped looking at months ago.
    */
    const old = await addBusiness({ publishedHoursAgo: 30 * 24 });

    await sweepSetupNudges(NOW);

    expect(await deliveries(old.id)).toEqual([]);
  });
});

describe("exactly once, ever", () => {
  it("does not nudge the same business a second time", async () => {
    const due = await addBusiness({ publishedHoursAgo: NUDGE_AFTER_HOURS + 2 });

    await sweepSetupNudges(NOW);
    const afterFirst = await deliveries(due.id);
    expect(afterFirst.length).toBe(2);

    const second = await sweepSetupNudges(NOW);

    // Same rows, and the sweep says why it left it alone rather than silently
    // finding nothing to do.
    expect(await deliveries(due.id)).toEqual(afterFirst);
    expect(second.alreadyNudged).toBeGreaterThanOrEqual(1);
  });
});

describe("what it must not chase", () => {
  it("skips a listing whose only open task is the site visit", async () => {
    /*
       Board 8a's open question 4, answered in the board: suppress it. The visit
       waits on our scheduling, and a reminder about our own backlog is how a
       channel gets muted.
    */
    const visitOnly = await addBusiness({ publishedHoursAgo: NUDGE_AFTER_HOURS + 3 });
    await finishEverythingButTheVisit(visitOnly.id);

    const result = await sweepSetupNudges(NOW);

    expect(await deliveries(visitOnly.id)).toEqual([]);
    expect(result.visitOnly).toBeGreaterThanOrEqual(1);
  });

  it("skips a suspended listing", async () => {
    /*
       A suspended listing is off the directory, so finishing these tasks would
       reach no buyer. Asking somebody to spend twenty-five minutes on a
       catalogue nobody can see is worse than saying nothing.
    */
    const suspended = await addBusiness({
      publishedHoursAgo: NUDGE_AFTER_HOURS + 4,
      suspended: true,
    });

    await sweepSetupNudges(NOW);

    expect(await deliveries(suspended.id)).toEqual([]);
  });
});

describe("the template and the event agree", () => {
  it("asks for nothing the event does not supply", async () => {
    /*
       The authoring-time half of the send-time rule. A placeholder with no
       value throws rather than sends, and the seller never finds out — so every
       seeded `setup_nudge` template is checked against `EVENT_PARAMS` here as
       well as in the admin editor.
    */
    const templates = await prisma.notificationTemplate.findMany({
      where: { event: "setup_nudge" },
      select: { channel: true, body: true, subject: true, actionLabel: true },
    });
    expect(templates.length).toBeGreaterThan(0);

    for (const template of templates) {
      expect(
        unknownPlaceholders("setup_nudge", template.body, template.subject, template.actionLabel),
        `setup_nudge/${template.channel}`,
      ).toEqual([]);
    }
  });
});

describe("the daily run actually performs it", () => {
  it("runs the nudge last, after every step a retry repeats harmlessly", async () => {
    /*
       Ordering asserted on the source, the way `licence-expiry.test.ts` does,
       because the key order handed to `runSteps` is what fixes the sequence.
       `runSteps` reports 500 when any step fails and Vercel retries the whole
       batch — so the one step that hands a message to a carrier goes last,
       where the fewest failures can re-enter it.
    */
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/api/jobs/daily/route.ts", "utf8"),
    );
    expect(source.indexOf("setupNudges:")).toBeGreaterThan(-1);
    expect(source.indexOf("setupNudges:")).toBeGreaterThan(source.indexOf("areaPages:"));
    expect(source.indexOf("setupNudges:")).toBeGreaterThan(source.indexOf("expiredLicences:"));
  });
});
