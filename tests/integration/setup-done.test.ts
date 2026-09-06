import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import {
  markDoneSeen,
  noteCompleted,
  noteFirstHubView,
  readBaseline,
  specFacetCount,
} from "@/lib/setup/baseline";
import { setupCompletion } from "@/lib/setup/complete";

/**
 * Board 8e, below the screen.
 *
 * The page itself is a redirect table and a render; what needs a database is
 * everything it depends on being true. Three things, in order of how badly they
 * fail:
 *
 *   1. **The once-only marker.** §1 says the seller reaches the completion
 *      screen exactly once, and the amber card on it promises exactly that. If
 *      `markDoneSeen` can be flipped twice the promise is false and the screen
 *      is a stale dashboard.
 *   2. **The baseline never moving.** Its whole value is that it holds what was
 *      true *before* the work. A second hub render that overwrote it would
 *      leave the screen comparing the finished state against itself and
 *      printing "up from 100%".
 *   3. **The delta hiding rather than guessing.** §6 is explicit that a total
 *      must not stand in for a comparison.
 */

const PREFIX = "setup-done-test-";
const EMAIL_DOMAIN = "@setup-done.test";

let categoryId: string;
let templateId: string;
let filterableFieldIds: string[] = [];
let plainFieldId: string;
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

async function addBusiness(fields: { strength?: number | null } = {}) {
  const id = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `Setup Done ${id} Trading LLC`,
      displayName: `Setup Done ${id}`,
      slug: `${PREFIX}${id}`,
      licenceNumber: `DED-SD${id.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date("2030-01-01T00:00:00.000Z"),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      ...(fields.strength === undefined ? {} : { profileStrength: fields.strength }),
    },
    select: { id: true },
  });

  await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `${PREFIX}owner-${stamp()}${EMAIL_DOMAIN}`,
      fullName: `Setup Done Owner ${stamp()}`,
      roles: ["seller_owner"],
      businessId: business.id,
    },
  });

  return business.id;
}

/**
 * A live product carrying the given values, keyed by `SpecField.id`.
 *
 * `Prisma.InputJsonValue` rather than `Record<string, unknown>`: the column is
 * Json and `unknown` is wider than what Postgres will take, so the looser type
 * compiles at the call site and fails at the write.
 */
async function addProduct(businessId: string, specValues: Prisma.InputJsonValue) {
  const id = stamp();
  await prisma.product.create({
    data: {
      businessId,
      categoryId,
      name: `Setup done product ${id}`,
      slug: `${PREFIX}product-${id}`,
      availability: "made_to_order",
      status: "live",
      specValues,
    },
  });
}

async function useTemplate(businessId: string) {
  await prisma.sellerTemplate.create({
    data: {
      businessId,
      platformTemplateId: templateId,
      name: "Setup done sheet",
      slug: `setup-done-${businessId.slice(0, 8)}`,
    },
  });
}

async function removeFixtures() {
  await prisma.product.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  /*
     Invitations before the people who sent them. `TeamInvite.invitedById` is
     ON DELETE RESTRICT — deliberately, so a sent invitation always names a real
     sender — which means the owner cannot go while one of theirs is standing.
  */
  await prisma.teamInvite.deleteMany({
    where: { business: { slug: { startsWith: PREFIX } } },
  });
  await prisma.sellerTemplate.deleteMany({
    where: { business: { slug: { startsWith: PREFIX } } },
  });
  await prisma.setupBaseline.deleteMany({
    where: { business: { slug: { startsWith: PREFIX } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  // By the categories it serves, not by slug: `SpecTemplate` has no slug, and
  // this suite owns its category outright.
  await prisma.specField.deleteMany({
    where: { template: { categories: { some: { category: { slug: { startsWith: PREFIX } } } } } },
  });
  await prisma.specTemplate.deleteMany({
    where: { categories: { some: { category: { slug: { startsWith: PREFIX } } } } },
  });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();

  const category = await prisma.category.create({
    data: { slug: `${PREFIX}valves`, code: "SDNE", name: "Setup done trade" },
  });
  categoryId = category.id;

  const template = await prisma.specTemplate.create({
    data: {
      name: "Setup done sheet",
      categories: { create: { categoryId } },
      status: "live",
      fields: {
        create: [
          { key: "dn", label: "Nominal diameter", type: "number", isFilterable: true, sortOrder: 1 },
          { key: "ends", label: "End connection", type: "text", isFilterable: true, sortOrder: 2 },
          { key: "approvals", label: "Approvals", type: "text", isFilterable: true, sortOrder: 3 },
          { key: "notes", label: "Notes", type: "text", isFilterable: false, sortOrder: 4 },
        ],
      },
    },
    select: { id: true, fields: { select: { id: true, key: true, isFilterable: true } } },
  });
  templateId = template.id;
  filterableFieldIds = template.fields.filter((f) => f.isFilterable).map((f) => f.id);
  plainFieldId = template.fields.find((f) => !f.isFilterable)!.id;
});

afterAll(async () => {
  await removeFixtures();
});

describe("the once-only marker", () => {
  it("is flipped by exactly one caller, however many arrive together", async () => {
    /*
       The rule the amber card on the screen promises. Two tabs opening the
       completion screen at the same moment must produce one first view, not
       two — `markDoneSeen` filters on `doneSeenAt: null` and reads the row
       count back, so the database decides rather than the application.
    */
    const businessId = await addBusiness();
    await noteFirstHubView(businessId, 62);

    const results = await Promise.all([
      markDoneSeen(businessId),
      markDoneSeen(businessId),
      markDoneSeen(businessId),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await readBaseline(businessId))?.doneSeenAt).not.toBeNull();
  });

  it("stays flipped, so a later visit is never a first view", async () => {
    const businessId = await addBusiness();
    await noteFirstHubView(businessId, 40);

    expect(await markDoneSeen(businessId)).toBe(true);
    expect(await markDoneSeen(businessId)).toBe(false);
  });

  it("does nothing at all without a baseline row", async () => {
    // A listing that never opened the hub. Nothing to mark, and no row invented
    // to mark it on — the screen's precondition would have sent them away long
    // before this is reached.
    const businessId = await addBusiness();
    expect(await markDoneSeen(businessId)).toBe(false);
    expect(await readBaseline(businessId)).toBeNull();
  });
});

describe("the baseline holds what was true before", () => {
  it("records the score and the facet count on the first hub view", async () => {
    const businessId = await addBusiness({ strength: 62 });
    await useTemplate(businessId);
    await addProduct(businessId, { [filterableFieldIds[0]!]: "DN100" });

    await noteFirstHubView(businessId, 62);

    const row = await readBaseline(businessId);
    expect(row?.baselineScore).toBe(62);
    expect(row?.baselineFacets).toBe(1);
  });

  it("does not move on a second view, however much has changed since", async () => {
    /*
       The failure this prevents is the screen comparing the finished state
       against itself and printing "up from 100%". An upsert that updated would
       do exactly that, which is why the write is an insert that does nothing on
       conflict.
    */
    const businessId = await addBusiness({ strength: 30 });
    await noteFirstHubView(businessId, 30);
    await noteFirstHubView(businessId, 100);

    expect((await readBaseline(businessId))?.baselineScore).toBe(30);
  });

  it("stamps completion once, and the first stamp wins", async () => {
    const businessId = await addBusiness();
    await noteFirstHubView(businessId, 50);

    const early = new Date("2026-06-01T09:00:00.000Z");
    await noteCompleted(businessId, early);
    await noteCompleted(businessId, new Date("2026-06-02T09:00:00.000Z"));

    expect((await readBaseline(businessId))?.completedAt).toEqual(early);
  });
});

describe("what counts as a spec filter", () => {
  it("counts distinct field-and-value pairs, not products", async () => {
    // Ten products all sized DN100 are one filter a buyer can find you by.
    const businessId = await addBusiness();
    await useTemplate(businessId);
    await addProduct(businessId, { [filterableFieldIds[0]!]: "DN100" });
    await addProduct(businessId, { [filterableFieldIds[0]!]: "DN100" });

    expect(await specFacetCount(businessId)).toBe(1);
  });

  it("counts each member of a multi-select separately", async () => {
    /*
       A product certified to both UL and FM is findable under either, so it is
       two filters. Folding them into one compound token — which the first draft
       of `facetTokens` did — would undercount it and disagree with the search
       page that lists them apart.
    */
    const businessId = await addBusiness();
    await useTemplate(businessId);
    await addProduct(businessId, { [filterableFieldIds[2]!]: ["UL", "FM"] });

    expect(await specFacetCount(businessId)).toBe(2);
  });

  it("folds case and spacing, because a buyer typing either reaches one shelf", async () => {
    const businessId = await addBusiness();
    await useTemplate(businessId);
    await addProduct(businessId, { [filterableFieldIds[1]!]: "Grooved" });
    await addProduct(businessId, { [filterableFieldIds[1]!]: " grooved " });

    expect(await specFacetCount(businessId)).toBe(1);
  });

  it("ignores fields nobody can filter on, and values nobody filled in", async () => {
    const businessId = await addBusiness();
    await useTemplate(businessId);
    await addProduct(businessId, {
      [plainFieldId]: "A note the buyer cannot filter by",
      [filterableFieldIds[0]!]: "",
      [filterableFieldIds[1]!]: null,
    });

    expect(await specFacetCount(businessId)).toBe(0);
  });

  it("ignores drafts, which have no page to be found on", async () => {
    const businessId = await addBusiness();
    await useTemplate(businessId);
    await prisma.product.create({
      data: {
        businessId,
        categoryId,
        name: "Setup done draft",
        slug: `${PREFIX}product-draft-${stamp()}`,
        availability: "made_to_order",
        status: "draft",
        specValues: { [filterableFieldIds[0]!]: "DN200" },
      },
    });

    expect(await specFacetCount(businessId)).toBe(0);
  });

  it("is zero, not an error, for a supplier with no spec sheet at all", async () => {
    const businessId = await addBusiness();
    expect(await specFacetCount(businessId)).toBe(0);
  });
});

describe("what the screen is handed", () => {
  /*
     The score the hub computed on the same request, handed down rather than
     read from `Business.profileStrength`. The column is a cache that
     `strength-job.ts` refreshes on a schedule, so a seller who finishes the
     last task and lands here a second later would be shown a figure that
     predates their work — which is exactly what the first browser run of this
     screen did: "60%" under "Up from 70% this morning".
  */
  const LIVE = 100;

  it("counts seats, never invitations — the trap §2 names", async () => {
    /*
       Board 8d ticks its task when an invitation *goes*; the score's team
       component wants somebody actually seated. A seller who invited two people
       and had neither accept is at three ticks and not at a hundred, so a line
       counting invitations would contradict the meter three lines above it.
    */
    const businessId = await addBusiness();
    const invitedById = (await ownerOf(businessId)) as string;
    await prisma.teamInvite.createMany({
      data: [1, 2].map((n) => ({
        businessId,
        email: `${PREFIX}invited-${stamp()}-${n}${EMAIL_DOMAIN}`,
        roles: ["seller_sales"] as const,
        invitedById,
        token: `${PREFIX}${stamp()}-${n}`,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      })),
    });

    const completion = await setupCompletion(businessId, LIVE);
    const team = completion?.ticks.find((tick) => tick.key === "team");
    // One owner seated. Two invitations outstanding, counted by nothing here.
    expect(team?.count).toBe(1);
  });

  it("hides the filter gain rather than printing a total", async () => {
    // No baseline at all — a seller who reached the tasks without the hub.
    const businessId = await addBusiness({ strength: 100 });
    await useTemplate(businessId);
    await addProduct(businessId, { [filterableFieldIds[0]!]: "DN100" });

    expect((await setupCompletion(businessId, LIVE))?.specFilterGain).toBeNull();
  });

  it("hides the gain when nothing was gained", async () => {
    /*
       §5: never "0 spec filters". A seller told they gained nothing has been
       shown a sentence whose whole grammar promises they gained something.
    */
    const businessId = await addBusiness({ strength: 100 });
    await useTemplate(businessId);
    await addProduct(businessId, { [filterableFieldIds[0]!]: "DN100" });
    await noteFirstHubView(businessId, 100);

    expect((await setupCompletion(businessId, LIVE))?.specFilterGain).toBeNull();
  });

  it("reports the gain when the catalogue actually grew", async () => {
    const businessId = await addBusiness({ strength: 100 });
    await useTemplate(businessId);
    await noteFirstHubView(businessId, 40);

    await addProduct(businessId, { [filterableFieldIds[0]!]: "DN100" });
    await addProduct(businessId, { [filterableFieldIds[1]!]: "Grooved" });

    expect((await setupCompletion(businessId, LIVE))?.specFilterGain).toBe(2);
  });

  it("drops the rise when no baseline was stored", async () => {
    const businessId = await addBusiness();
    const completion = await setupCompletion(businessId, LIVE);
    expect(completion?.baselineScore).toBeNull();
    expect(completion?.fullScore).toBe(true);
  });

  it("refuses to call 96 a hundred", async () => {
    /*
       §5's fifth row: a seat removed after completing leaves three ticks over a
       score short of full. The screen shows the real number and drops the
       "every setup task complete" clause — it does not round up.
    */
    const businessId = await addBusiness();
    await noteFirstHubView(businessId, 62);

    const completion = await setupCompletion(businessId, 96);
    expect(completion?.score).toBe(96);
    expect(completion?.fullScore).toBe(false);
    expect(completion?.baselineScore).toBe(62);
  });

  it("drops the rise rather than printing a fall as one", async () => {
    /*
       The defect the first browser run of this screen showed: "60%" under "Up
       from 70% this morning". The two figures came from two places — the hub
       computed live, the screen read the cached column — and the sentence
       promises a rise whichever way the numbers went.

       One source now, and the clause is dropped whenever the score has not
       actually risen above the baseline. Equal drops too: "up from 70%" over
       70% is an empty sentence rather than a false one, and there is no room
       for either here.
    */
    const businessId = await addBusiness();
    await noteFirstHubView(businessId, 70);

    expect((await setupCompletion(businessId, 60))?.baselineScore).toBeNull();
    expect((await setupCompletion(businessId, 70))?.baselineScore).toBeNull();
    expect((await setupCompletion(businessId, 100))?.baselineScore).toBe(70);
  });

  it("reads the six ranking factors from the live config, heaviest first", async () => {
    const businessId = await addBusiness();
    const factors = (await setupCompletion(businessId, LIVE))?.factors ?? [];

    expect(factors).toHaveLength(6);
    const weights = factors.map((factor) => factor.weight);
    expect([...weights]).toEqual([...weights].sort((a, b) => b - a));

    // §4: mark only what changed, and never relevance.
    expect(factors.filter((f) => f.moved).map((f) => f.key).sort()).toEqual([
      "specCompleteness",
      "verificationTier",
    ]);
    expect(factors.find((f) => f.key === "relevance")?.moved).toBe(false);
    expect(factors.filter((f) => f.open).map((f) => f.key)).toEqual(["responseTime"]);
  });

  it("reports the hours the funnel is measured in", async () => {
    const businessId = await addBusiness({ strength: 100 });
    await noteFirstHubView(businessId, 50);
    await prisma.setupBaseline.update({
      where: { businessId },
      data: { firstSeenAt: new Date("2026-06-01T09:00:00.000Z") },
    });
    await noteCompleted(businessId, new Date("2026-06-01T14:30:00.000Z"));

    // Floored: five and a half hours is five, because §7 groups these.
    expect((await setupCompletion(businessId, LIVE))?.hoursToComplete).toBe(5);
  });
});

async function ownerOf(businessId: string): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { businessId, roles: { has: "seller_owner" } },
    select: { id: true },
  });
  return owner?.id ?? null;
}
